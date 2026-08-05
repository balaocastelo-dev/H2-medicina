'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { onlyDigits, startOfTodayISO, todayISO } from '@/lib/format';
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
    const today = todayISO();

    const { data: patients } = await supabase
      .from('patients')
      .select('id, full_name, birth_date')
      .eq('tenant_id', ctx.tenant.id)
      .eq('cpf', cpf)
      .is('deleted_at', null)
      .returns<{ id: string; full_name: string; birth_date: string | null }[]>();

    if (!patients || patients.length === 0) {
      return fail('CPF não localizado. Procure a recepção.');
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

    // A RPC reaproveita atendimento aberto do dia. Um paciente marcado como
    // ausente, ou que ja passou da recepcao, tem atendimento "aberto" e
    // receberia de volta a senha antiga, sem entrar na fila de novo.
    // Encerramos esse atendimento antes, para o check-in comecar limpo.
    const { data: pendura } = await supabase
      .from('attendances')
      .select('id, stage_code, absent_at')
      .eq('tenant_id', ctx.tenant.id)
      .eq('patient_id', input.patientId)
      .is('finished_at', null)
      .is('cancelled_at', null)
      .is('deleted_at', null)
      .gte('checkin_at', startOfTodayISO())
      .order('checkin_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; stage_code: string; absent_at: string | null }>();

    if (pendura && (pendura.absent_at || pendura.stage_code === 'ausente')) {
      await supabase
        .from('attendances')
        .update({
          finished_at: new Date().toISOString(),
          stage_code: 'ausente',
          notes: 'Encerrado automaticamente: paciente retornou ao totem',
        })
        .eq('id', pendura.id);
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

    // Guarda contra dois operadores clicando junto: se a sala ja tem alguem
    // chamado ou em atendimento, nao chama outro por cima.
    const { data: ocupada } = await supabase
      .from('patient_exams')
      .select('id')
      .eq('tenant_id', ctx.tenant.id)
      .eq('room_id', roomId)
      .in('status', ['chamado', 'em_andamento'])
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (ocupada) {
      return ok({ found: false }, 'Esta sala já está com um paciente. Conclua antes de chamar o próximo.');
    }

    const { data, error } = await supabase.rpc('call_next_for_room', {
      p_tenant: ctx.tenant.id,
      p_room: roomId,
    });
    if (error) return fail(toFriendlyError(error));
    const payload = data as { found: boolean };
    if (!payload.found) return ok({ found: false }, await explicarFilaVazia(ctx.tenant.id, roomId));

    // A RPC grava a chamada com o primeiro nome. O painel anuncia o nome
    // completo, entao o rotulo e completado aqui, logo apos a chamada.
    await ajustarRotuloDaChamada(ctx.tenant.id, roomId);

    await audit(ctx, {
      action: 'update',
      entity: 'rooms',
      entityId: roomId,
      description: 'Chamada do próximo paciente',
    });
    revalidatePath('/filas');
    revalidatePath('/painel');
    return ok({ found: true }, 'Paciente chamado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Etapas que encerram o atendimento. */
const ETAPAS_TERMINAIS = new Set(['finalizado', 'cancelado', 'ausente']);

/** Etapas em que o paciente esta efetivamente dentro de uma sala. */
const ETAPAS_EM_SERVICO = new Set(['na_recepcao', 'em_triagem', 'em_exames', 'em_consulta']);

/**
 * Desfaz as marcas de encerramento ao trazer o paciente de volta.
 *
 * Mover para 'finalizado', 'cancelado' ou 'ausente' grava a data
 * correspondente. Voltar o cartao mudava so a etapa e deixava a data para
 * tras: o atendimento ficava, por exemplo, em 'aguardando recepcao' com
 * finished_at preenchido — e sumia de todas as telas, que filtram por
 * atendimento em aberto.
 */
async function limparEstadoTerminal(
  tenantId: string,
  attendanceId: string,
  stage: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    const patch: Record<string, unknown> = {};

    if (!ETAPAS_TERMINAIS.has(stage)) {
      patch.finished_at = null;
      patch.cancelled_at = null;
      patch.absent_at = null;
      patch.cancel_reason = null;
    }

    // Fora de sala, o paciente nao pode continuar marcado como em atendimento,
    // senao a fila o considera ocupado e nunca o chama.
    if (!ETAPAS_EM_SERVICO.has(stage)) {
      patch.in_service = false;
      patch.current_room_id = null;
    }

    // Exame que ficou 'chamado' apos o cartao sair da etapa de exames trava o
    // paciente: a fila nunca mais o chama e ele nao aparece em tela nenhuma.
    if (!ETAPAS_EM_SERVICO.has(stage)) {
      const { data: presos } = await supabase
        .from('patient_exams')
        .select('id, room_id')
        .eq('tenant_id', tenantId)
        .eq('attendance_id', attendanceId)
        .in('status', ['chamado', 'em_andamento'])
        .returns<{ id: string; room_id: string | null }[]>();

      for (const exame of presos ?? []) {
        await supabase
          .from('patient_exams')
          .update({ status: 'pendente', called_at: null, started_at: null, room_id: null })
          .eq('id', exame.id);
        if (exame.room_id) {
          await supabase
            .from('rooms')
            .update({ status: 'disponivel', current_attendance_id: null })
            .eq('id', exame.room_id)
            .eq('tenant_id', tenantId);
        }
      }

      // Sala que ainda aponte para este atendimento tambem e liberada.
      await supabase
        .from('rooms')
        .update({ status: 'disponivel', current_attendance_id: null })
        .eq('tenant_id', tenantId)
        .eq('current_attendance_id', attendanceId);
    }

    if (Object.keys(patch).length === 0) return;

    await supabase
      .from('attendances')
      .update(patch)
      .eq('id', attendanceId)
      .eq('tenant_id', tenantId);
  } catch (error) {
    console.error('[crm] falha ao normalizar o atendimento apos mover:', error);
  }
}

/**
 * Explica por que a fila da sala nao tem ninguem.
 *
 * "Nenhum paciente elegivel" sozinho confunde: o operador ve gente na clinica
 * e nao entende o motivo. Aqui olhamos onde os pacientes realmente estao.
 */
async function explicarFilaVazia(tenantId: string, roomId: string): Promise<string> {
  try {
    const supabase = await createClient();

    const [{ data: sala }, { data: emServico }, { data: naRecepcao }, { data: naTriagem }] =
      await Promise.all([
        supabase.from('rooms').select('name').eq('id', roomId).maybeSingle<{ name: string }>(),
        supabase
          .from('patient_exams')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('status', ['chamado', 'em_andamento'])
          .eq('room_id', roomId)
          .returns<{ id: string }[]>(),
        supabase
          .from('attendances')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('stage_code', ['aguardando_recepcao', 'na_recepcao'])
          .is('finished_at', null)
          .is('deleted_at', null)
          .returns<{ id: string }[]>(),
        supabase
          .from('attendances')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('stage_code', ['aguardando_triagem', 'em_triagem'])
          .is('finished_at', null)
          .is('deleted_at', null)
          .returns<{ id: string }[]>(),
      ]);

    const nome = sala?.name ?? 'esta sala';

    if ((emServico ?? []).length > 0) {
      return `${nome} já está com um paciente em atendimento. Conclua antes de chamar o próximo.`;
    }
    if ((naRecepcao ?? []).length > 0) {
      const n = (naRecepcao ?? []).length;
      return `Ninguém liberado para exames ainda. Há ${n} paciente(s) na recepção — libere na tela Recepção para eles entrarem nas filas.`;
    }
    if ((naTriagem ?? []).length > 0) {
      return `Os pacientes ainda estão na triagem. Conclua a triagem para liberá-los aos exames.`;
    }

    // Caso silencioso: alguem adiantou o cartao no CRM e deixou exames por
    // fazer. O exame existe, mas o paciente nao esta em etapa de fila.
    const { data: presos } = await supabase
      .from('patient_exams')
      .select('id, attendances!inner(stage_code)')
      .eq('tenant_id', tenantId)
      .in('status', ['pendente', 'em_fila'])
      .not('attendances.stage_code', 'in', '("aguardando_exames","em_exames","finalizado","cancelado","ausente")')
      .returns<{ id: string }[]>();

    if ((presos ?? []).length > 0) {
      return `Há exames pendentes, mas os pacientes foram movidos para outra etapa. Use "Devolver às filas" no aviso acima.`;
    }

    return `Não há ninguém aguardando exames em ${nome} no momento.`;
  } catch {
    return 'Nenhum paciente elegível na fila desta sala.';
  }
}

/**
 * Completa o rotulo da ultima chamada com o nome do paciente.
 *
 * Fica fora da RPC porque o texto anunciado e decisao de apresentacao, nao de
 * regra de negocio — e assim muda sem exigir migration no banco.
 */
async function ajustarRotuloDaChamada(tenantId: string, roomId: string): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: sala } = await supabase
      .from('rooms')
      .select('current_attendance_id')
      .eq('id', roomId)
      .maybeSingle<{ current_attendance_id: string | null }>();
    if (!sala?.current_attendance_id) return;

    const { data: atendimento } = await supabase
      .from('attendances')
      .select('patients(full_name, social_name)')
      .eq('id', sala.current_attendance_id)
      .maybeSingle<{ patients: { full_name: string; social_name: string | null } | null }>();

    const nome = atendimento?.patients?.social_name ?? atendimento?.patients?.full_name;
    if (!nome) return;

    // Buscar "a chamada mais recente do tenant" anunciava o nome errado quando
    // duas salas chamavam quase junto. A senha identifica a chamada certa.
    const { data: senha } = await supabase
      .from('queue_tickets')
      .select('code')
      .eq('attendance_id', sala.current_attendance_id)
      .maybeSingle<{ code: string }>();

    let consulta = supabase
      .from('tv_calls')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('called_at', { ascending: false })
      .limit(1);
    if (senha?.code) consulta = consulta.eq('ticket_code', senha.code);

    const { data: chamada } = await consulta.maybeSingle<{ id: string }>();
    if (!chamada) return;

    await supabase.from('tv_calls').update({ patient_label: nome }).eq('id', chamada.id);
  } catch (error) {
    // Rotulo e cosmetico: se falhar, a chamada ja aconteceu.
    console.error('[fila] não consegui completar o rotulo da chamada:', error);
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

    const { data: paciente } = await supabase
      .from('patients')
      .select('full_name, social_name')
      .eq('id', attendance?.patient_id ?? '')
      .maybeSingle<{ full_name: string; social_name: string | null }>();

    await supabase.from('tv_calls').insert({
      tenant_id: ctx.tenant.id,
      ticket_code: ticket?.code ?? '---',
      patient_label: paciente?.social_name ?? paciente?.full_name ?? null,
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

    // A sala precisa ser lida ANTES do update: devolver a fila zera room_id,
    // e sem isso nao havia como saber qual sala liberar.
    const { data: antes } = await supabase
      .from('patient_exams')
      .select('room_id')
      .eq('id', examId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ room_id: string | null }>();

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

    // Sai de atendimento por qualquer motivo -> a sala volta a ficar livre.
    const salaParaLiberar = antes?.room_id ?? data.room_id;
    if (salaParaLiberar && status !== 'em_andamento') {
      await supabase
        .from('rooms')
        .update({ status: 'disponivel', current_attendance_id: null })
        .eq('id', salaParaLiberar)
        .eq('tenant_id', ctx.tenant.id);
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

    await limparEstadoTerminal(ctx.tenant.id, attendanceId, stage);

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
