'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { onlyDigits } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { Priority, QueueTicket } from '@/types/entities';

export interface TotemLookupResult {
  appointmentId: string | null;
  patientId: string;
  patientName: string;
  birthDate: string | null;
  companyName: string | null;
  scheduledAt: string | null;
  exams: string[];
}

/** Busca o agendamento do dia pelo CPF (usado no totem). */
export async function lookupForCheckin(cpfRaw: string): Promise<ActionResult<TotemLookupResult[]>> {
  try {
    const ctx = await assertPermission('totem.operar');
    const cpf = onlyDigits(cpfRaw);
    if (cpf.length !== 11) return fail('Informe os 11 digitos do CPF.');

    const supabase = await createClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data: patients } = await supabase
      .from('patients')
      .select('id, full_name, birth_date')
      .eq('tenant_id', ctx.tenant.id)
      .eq('cpf', cpf)
      .is('deleted_at', null)
      .returns<{ id: string; full_name: string; birth_date: string | null }[]>();

    if (!patients || patients.length === 0) {
      return fail('CPF nao localizado. Procure a recepcao.');
    }

    const results: TotemLookupResult[] = [];
    for (const p of patients) {
      const { data: appointments } = await supabase
        .from('appointments')
        .select(
          'id, scheduled_at, status, companies(trade_name, legal_name), appointment_exams(exam_types(name))',
        )
        .eq('tenant_id', ctx.tenant.id)
        .eq('patient_id', p.id)
        .eq('scheduled_date', today)
        .not('status', 'in', '("cancelado","remarcado")')
        .is('deleted_at', null)
        .returns<
          {
            id: string;
            scheduled_at: string;
            status: string;
            companies: { trade_name: string | null; legal_name: string } | null;
            appointment_exams: { exam_types: { name: string } | null }[];
          }[]
        >();

      if (appointments && appointments.length > 0) {
        for (const a of appointments) {
          results.push({
            appointmentId: a.id,
            patientId: p.id,
            patientName: p.full_name,
            birthDate: p.birth_date,
            companyName: a.companies?.trade_name ?? a.companies?.legal_name ?? null,
            scheduledAt: a.scheduled_at,
            exams: a.appointment_exams.map((e) => e.exam_types?.name).filter(Boolean) as string[],
          });
        }
      } else {
        results.push({
          appointmentId: null,
          patientId: p.id,
          patientName: p.full_name,
          birthDate: p.birth_date,
          companyName: null,
          scheduledAt: null,
          exams: [],
        });
      }
    }

    return ok(results);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export interface CheckinResult {
  attendanceId: string;
  ticket: QueueTicket | null;
  alreadyCheckedIn: boolean;
}

/** Executa o check-in via RPC (cria atendimento, senha e fila de exames). */
export async function performCheckin(input: {
  appointmentId: string | null;
  patientId: string;
  priority: Priority;
  totemCode?: string;
}): Promise<ActionResult<CheckinResult>> {
  try {
    const ctx = await assertPermission('totem.operar');
    const supabase = await createClient();

    let totemId: string | null = null;
    if (input.totemCode) {
      const { data } = await supabase
        .from('totems')
        .select('id')
        .eq('tenant_id', ctx.tenant.id)
        .eq('code', input.totemCode)
        .maybeSingle<{ id: string }>();
      totemId = data?.id ?? null;
    }

    const { data, error } = await supabase.rpc('checkin_patient', {
      p_tenant: ctx.tenant.id,
      p_appointment: input.appointmentId,
      p_patient: input.patientId,
      p_priority: input.priority,
      p_totem: totemId,
      p_device: null,
    });

    if (error) return fail(toFriendlyError(error));

    const payload = data as {
      attendance_id: string;
      ticket: QueueTicket | null;
      already_checked_in: boolean;
    };

    await audit(ctx, {
      action: 'create',
      entity: 'attendances',
      entityId: payload.attendance_id,
      patientId: input.patientId,
      description: `Check-in realizado (senha ${payload.ticket?.code ?? '—'})`,
      origin: 'totem',
    });

    revalidatePath('/crm');
    revalidatePath('/recepcao');
    revalidatePath('/painel');

    return ok({
      attendanceId: payload.attendance_id,
      ticket: payload.ticket,
      alreadyCheckedIn: payload.already_checked_in,
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Chama o proximo paciente elegivel para uma sala. */
export async function callNextForRoom(roomId: string): Promise<ActionResult<{ found: boolean }>> {
  try {
    const ctx = await assertPermission('filas.operar');
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('call_next_for_room', {
      p_tenant: ctx.tenant.id,
      p_room: roomId,
    });
    if (error) return fail(toFriendlyError(error));
    const payload = data as { found: boolean };
    if (!payload.found) return ok({ found: false }, 'Nenhum paciente elegivel na fila desta sala.');

    await audit(ctx, {
      action: 'update',
      entity: 'rooms',
      entityId: roomId,
      description: 'Chamada do proximo paciente',
    });
    revalidatePath('/filas');
    return ok({ found: true }, 'Paciente chamado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function recallTicket(attendanceId: string, roomId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('filas.operar');
    const supabase = await createClient();

    const [{ data: ticket }, { data: room }, { data: attendance }] = await Promise.all([
      supabase
        .from('queue_tickets')
        .select('id, code')
        .eq('attendance_id', attendanceId)
        .maybeSingle<{ id: string; code: string }>(),
      supabase.from('rooms').select('name').eq('id', roomId).maybeSingle<{ name: string }>(),
      supabase
        .from('attendances')
        .select('patient_id, priority')
        .eq('id', attendanceId)
        .maybeSingle<{ patient_id: string; priority: Priority }>(),
    ]);

    await supabase.from('queue_events').insert({
      tenant_id: ctx.tenant.id,
      ticket_id: ticket?.id ?? null,
      attendance_id: attendanceId,
      room_id: roomId,
      event: 'rechamada',
      destination: 'sala',
      called_by: ctx.userId,
      is_manual: true,
    });

    await supabase.from('tv_calls').insert({
      tenant_id: ctx.tenant.id,
      ticket_code: ticket?.code ?? '---',
      room_name: room?.name ?? null,
      destination: 'sala',
      priority: attendance?.priority ?? 'normal',
      is_recall: true,
    });

    await supabase
      .from('patient_exams')
      .update({ recalled_count: 1 })
      .eq('attendance_id', attendanceId)
      .eq('status', 'chamado');

    revalidatePath('/filas');
    return ok(undefined, 'Senha rechamada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Inicia, conclui ou marca exame como nao realizado. */
export async function updateExamStatus(
  examId: string,
  status: 'em_andamento' | 'concluido' | 'nao_realizado' | 'pendente',
  reason?: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission(status === 'concluido' ? 'exames.concluir' : 'filas.operar');
    const supabase = await createClient();

    const patch: Record<string, unknown> = { status, updated_by: ctx.userId };
    if (status === 'em_andamento') patch.started_at = new Date().toISOString();
    if (status === 'concluido' || status === 'nao_realizado') {
      patch.finished_at = new Date().toISOString();
    }
    if (status === 'nao_realizado') patch.not_performed_reason = reason ?? null;
    if (status === 'pendente') {
      patch.called_at = null;
      patch.started_at = null;
      patch.room_id = null;
    }

    const { data, error } = await supabase
      .from('patient_exams')
      .update(patch)
      .eq('id', examId)
      .eq('tenant_id', ctx.tenant.id)
      .select('id, attendance_id, patient_id, room_id')
      .single<{ id: string; attendance_id: string; patient_id: string; room_id: string | null }>();

    if (error) return fail(toFriendlyError(error));

    if (data.room_id && (status === 'concluido' || status === 'nao_realizado')) {
      await supabase
        .from('rooms')
        .update({ status: 'disponivel', current_attendance_id: null })
        .eq('id', data.room_id);
    }

    await supabase.from('queue_events').insert({
      tenant_id: ctx.tenant.id,
      attendance_id: data.attendance_id,
      room_id: data.room_id,
      exam_id: examId,
      event:
        status === 'em_andamento' ? 'iniciada' : status === 'concluido' ? 'concluida' : 'cancelada',
      called_by: ctx.userId,
      is_manual: true,
    });

    await audit(ctx, {
      action: 'update',
      entity: 'patient_exams',
      entityId: examId,
      patientId: data.patient_id,
      description: `Exame marcado como ${status}`,
    });

    revalidatePath('/filas');
    revalidatePath('/crm');
    return ok(undefined, 'Exame atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Move o cartao no CRM (drag and drop) — exige permissao especifica. */
export async function moveAttendanceStage(
  attendanceId: string,
  stage: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('crm.mover_manual');
    const supabase = await createClient();
    const { error } = await supabase.rpc('move_attendance_stage', {
      p_attendance: attendanceId,
      p_stage: stage,
      p_reason: reason ?? null,
    });
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: `Movido manualmente para ${stage}`,
    });
    revalidatePath('/crm');
    return ok(undefined, 'Paciente movido.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
