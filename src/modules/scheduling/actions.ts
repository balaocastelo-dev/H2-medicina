'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { MOTIVO_NAO_PODE_EXCLUIR, podeExcluirDaLista } from './regras-lista';
import { appointmentSchema } from '@/lib/validators';
import { horarioLocalParaISO } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { Appointment } from '@/types/entities';

export async function createAppointment(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Appointment>> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const parsed = appointmentSchema.safeParse({
      patient_id: formData.get('patient_id'),
      company_id: formData.get('company_id') || null,
      scheduled_at: formData.get('scheduled_at'),
      duration_minutes: formData.get('duration_minutes') ?? 30,
      attendance_kind: formData.get('attendance_kind') ?? 'admissional',
      priority: formData.get('priority') ?? 'normal',
      professional_id: formData.get('professional_id') || null,
      exam_type_ids: formData.getAll('exam_type_ids').map(String),
      notes: formData.get('notes') ?? '',
    });
    if (!parsed.success) {
      return fail('Verifique os dados do agendamento.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { exam_type_ids, ...appointment } = parsed.data;

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        ...appointment,
        // O horario digitado e horario da clinica, nao do servidor.
        scheduled_at: horarioLocalParaISO(appointment.scheduled_at),
        tenant_id: ctx.tenant.id,
        origin: 'manual',
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('*')
      .single<Appointment>();

    if (error) return fail(toFriendlyError(error));

    if (exam_type_ids.length > 0) {
      await supabase.from('appointment_exams').insert(
        exam_type_ids.map((examId) => ({
          tenant_id: ctx.tenant.id,
          appointment_id: data.id,
          exam_type_id: examId,
          origin: 'manual' as const,
        })),
      );
    }

    await audit(ctx, {
      action: 'create',
      entity: 'appointments',
      entityId: data.id,
      patientId: data.patient_id,
      description: 'Agendamento criado',
      next: data,
    });

    revalidatePath('/agenda');
    return ok(data, 'Agendamento criado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Salva a edicao de um agendamento.
 *
 * Trocar so a data cai em `rescheduleAppointment`, que guarda o vinculo com
 * o horario antigo. Aqui e a correcao do resto: paciente errado, empresa
 * que faltou, tipo de atendimento trocado. E a lista chega importada de
 * fora, entao corrigir e rotina, nao excecao.
 */
export async function updateAppointment(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Appointment>> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const id = String(formData.get('id') ?? '');
    if (!z.string().uuid().safeParse(id).success) return fail('Agendamento inválido.');

    const parsed = appointmentSchema.safeParse({
      patient_id: formData.get('patient_id'),
      company_id: formData.get('company_id') || null,
      scheduled_at: formData.get('scheduled_at'),
      duration_minutes: formData.get('duration_minutes') ?? 30,
      attendance_kind: formData.get('attendance_kind') ?? 'admissional',
      priority: formData.get('priority') ?? 'normal',
      professional_id: formData.get('professional_id') || null,
      exam_type_ids: formData.getAll('exam_type_ids').map(String),
      notes: formData.get('notes') ?? '',
    });
    if (!parsed.success) {
      return fail('Verifique os dados do agendamento.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { data: original } = await supabase
      .from('appointments')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; status: string }>();
    if (!original) return fail('Agendamento não encontrado.');

    if (['em_atendimento', 'realizado'].includes(original.status)) {
      return fail('Este atendimento já começou. Não dá para editar o agendamento.');
    }

    const { exam_type_ids, ...campos } = parsed.data;

    const { data, error } = await supabase
      .from('appointments')
      .update({
        ...campos,
        scheduled_at: horarioLocalParaISO(campos.scheduled_at),
        updated_by: ctx.userId,
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .select('*')
      .single<Appointment>();
    if (error) return fail(toFriendlyError(error));

    // Exames viram a lista nova por inteiro: marcar e desmarcar na tela
    // precisa refletir aqui sem sobrar o que foi tirado.
    await supabase.from('appointment_exams').delete().eq('appointment_id', id);
    if (exam_type_ids.length > 0) {
      await supabase.from('appointment_exams').insert(
        exam_type_ids.map((examId) => ({
          tenant_id: ctx.tenant.id,
          appointment_id: id,
          exam_type_id: examId,
          origin: 'manual' as const,
        })),
      );
    }

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: id,
      patientId: data.patient_id,
      description: 'Agendamento editado',
      previous: original,
      next: data,
    });

    revalidatePath('/agenda');
    revalidatePath('/agenda/proximo-dia');
    return ok(data, 'Agendamento atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function changeAppointmentStatus(
  id: string,
  status: 'confirmado' | 'cancelado' | 'ausente' | 'agendado',
  reason?: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();
    const patch: Record<string, unknown> = { status, updated_by: ctx.userId };
    if (status === 'confirmado') patch.confirmed_at = new Date().toISOString();
    if (status === 'cancelado') {
      patch.cancelled_at = new Date().toISOString();
      patch.cancel_reason = reason ?? null;
    }

    const { error } = await supabase
      .from('appointments')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: id,
      description: `Status alterado para ${status}`,
      next: patch,
    });
    revalidatePath('/agenda');
    revalidatePath('/agenda/proximo-dia');
    return ok(undefined, 'Status atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function rescheduleAppointment(
  id: string,
  newDateTime: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();

    const { data: original } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<Appointment>();
    if (!original) return fail('Agendamento não encontrado.');

    const { data: created, error } = await supabase
      .from('appointments')
      .insert({
        tenant_id: ctx.tenant.id,
        patient_id: original.patient_id,
        company_id: original.company_id,
        order_id: original.order_id,
        scheduled_at: horarioLocalParaISO(newDateTime),
        duration_minutes: original.duration_minutes,
        attendance_kind: original.attendance_kind,
        priority: original.priority,
        professional_id: original.professional_id,
        origin: original.origin,
        rescheduled_from: original.id,
        notes: original.notes,
        created_by: ctx.userId,
      })
      .select('id')
      .single<{ id: string }>();
    if (error) return fail(toFriendlyError(error));

    await supabase
      .from('appointment_exams')
      .select('exam_type_id')
      .eq('appointment_id', id)
      .returns<{ exam_type_id: string }[]>()
      .then(async ({ data }) => {
        if (data?.length) {
          await supabase.from('appointment_exams').insert(
            data.map((e) => ({
              tenant_id: ctx.tenant.id,
              appointment_id: created.id,
              exam_type_id: e.exam_type_id,
              origin: 'manual' as const,
            })),
          );
        }
      });

    await supabase
      .from('appointments')
      .update({ status: 'remarcado', updated_by: ctx.userId })
      .eq('id', id);

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: id,
      description: `Remarcado para ${newDateTime}`,
    });
    revalidatePath('/agenda');
    revalidatePath('/agenda/proximo-dia');
    return ok(undefined, 'Agendamento remarcado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Tira o agendamento da lista.
 *
 * E exclusao logica: a linha continua no banco com a data de remocao, para
 * a auditoria conseguir responder quem tirou quem da agenda. Lista importada
 * errada acontece, e desfazer nao pode significar perder o rastro.
 */
export async function excluirAgendamento(id: string, motivo?: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();

    const { data: original } = await supabase
      .from('appointments')
      .select('id, status, scheduled_at, patient_id')
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; status: string; scheduled_at: string; patient_id: string }>();
    if (!original) return fail('Agendamento não encontrado.');

    if (!podeExcluirDaLista(original.status)) return fail(MOTIVO_NAO_PODE_EXCLUIR);

    const { error } = await supabase
      .from('appointments')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'cancelado',
        cancelled_at: new Date().toISOString(),
        cancel_reason: motivo ?? 'Removido da lista',
        updated_by: ctx.userId,
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'delete',
      entity: 'appointments',
      entityId: id,
      patientId: original.patient_id,
      description: motivo ? `Removido da agenda: ${motivo}` : 'Removido da agenda',
      previous: original,
    });

    revalidatePath('/agenda');
    revalidatePath('/agenda/proximo-dia');
    revalidatePath('/crm');
    return ok(undefined, 'Agendamento removido da lista.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
