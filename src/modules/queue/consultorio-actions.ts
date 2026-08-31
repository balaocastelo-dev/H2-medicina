'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { destinoDaSala } from './tv-destino';
import { proximoDaFilaDoMedico } from './fila-do-medico';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

interface NaFilaDoMedico {
  id: string;
  patient_id: string;
  priority: string;
  checkin_at: string;
  patients: { full_name: string; social_name: string | null } | null;
  queue_tickets: { id: string; code: string }[];
}

/**
 * Chama o proximo paciente para um consultorio.
 *
 * Tres pedidos da recepcao caem aqui, e sao o mesmo problema:
 *
 *   "tem pacientes que nao estao passando pela fila e indo direto para o
 *    modulo medico, mesmo que so ira passar pelo medico, deve ir para a
 *    fila para chamada"
 *   "Ao chamar o cliente na fila do medico nao precisa tem o botao de
 *    iniciar e encerrar o atendimento, somente abrir a ficha do cliente na
 *    aba modulo medico automaticamente"
 *   "a fila de cliente para o medico deve ir para todas as salas de medicos
 *    e ir atualizando conforme cada sala chama"
 *
 * A causa era estrutural: `call_next_for_room` so enxerga quem tem exame
 * pendente. Estado, SISPER e ingresso vao direto para `aguardando_medico`
 * sem exame nenhum, entao o botao de chamar nunca achava esses pacientes —
 * eles apareciam na lista do medico sem nunca terem sido chamados.
 *
 * Aqui a fila do medico e uma fila de pacientes, e nao de exames. Quem tem
 * exame clinico pendente continua sendo chamado pela RPC de sempre.
 */
export async function chamarProximoNoConsultorio(
  roomId: string,
): Promise<ActionResult<{ attendanceId: string | null; senha: string | null }>> {
  try {
    const ctx = await assertPermission('medico.atender');
    const supabase = await createClient();

    const { data: sala } = await supabase
      .from('rooms')
      .select('id, name, kind')
      .eq('id', roomId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; name: string; kind: string }>();
    if (!sala) return fail('Sala não encontrada.');

    // 1. Quem já terminou os exames e espera só o médico.
    const { data: espera } = await supabase
      .from('attendances')
      .select(
        'id, patient_id, priority, checkin_at, patients(full_name, social_name), queue_tickets(id, code)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .eq('stage_code', 'aguardando_medico')
      .eq('in_service', false)
      .is('finished_at', null)
      .is('cancelled_at', null)
      .is('deleted_at', null)
      .returns<NaFilaDoMedico[]>();

    const proximo = proximoDaFilaDoMedico(espera ?? []);

    // 2. Sem ninguém esperando, tenta a fila de exames: é o caso do
    //    particular, que tem o exame clínico marcado pela recepção.
    if (!proximo) {
      const { data, error } = await supabase.rpc('call_next_for_room', {
        p_tenant: ctx.tenant.id,
        p_room: roomId,
      });
      if (error) return fail(toFriendlyError(error));

      const retorno = data as {
        found: boolean;
        exam?: { attendance_id: string };
        ticket?: { code: string } | null;
      };
      if (!retorno.found) {
        return ok({ attendanceId: null, senha: null }, 'Ninguém aguardando o médico.');
      }

      revalidatePath('/medico');
      revalidatePath('/painel');
      return ok(
        { attendanceId: retorno.exam?.attendance_id ?? null, senha: retorno.ticket?.code ?? null },
        `Senha ${retorno.ticket?.code ?? ''} chamada em ${sala.name}.`,
      );
    }

    const senha = proximo.queue_tickets[0] ?? null;
    const nome = proximo.patients?.social_name ?? proximo.patients?.full_name ?? null;

    // Tres salas dividem a mesma fila, entao duas podem clicar em "chamar" no
    // mesmo instante. A condicao `in_service = false` faz o segundo update nao
    // pegar linha nenhuma — e e isso que diferencia quem levou o paciente.
    const { data: tomado, error } = await supabase
      .from('attendances')
      .update({
        stage_code: 'em_consulta',
        in_service: true,
        current_room_id: roomId,
        consultation_started_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', proximo.id)
      .eq('tenant_id', ctx.tenant.id)
      .eq('in_service', false)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) return fail(toFriendlyError(error));

    if (!tomado) {
      return fail('Outro consultório chamou este paciente agora. Clique em chamar de novo.');
    }

    await supabase
      .from('rooms')
      .update({ status: 'ocupada', current_attendance_id: proximo.id })
      .eq('id', roomId)
      .eq('tenant_id', ctx.tenant.id);

    await supabase.from('queue_events').insert({
      tenant_id: ctx.tenant.id,
      ticket_id: senha?.id ?? null,
      attendance_id: proximo.id,
      room_id: roomId,
      event: 'chamada',
      destination: destinoDaSala(sala.kind),
      called_by: ctx.userId,
      is_manual: true,
    });

    await supabase.from('tv_calls').insert({
      tenant_id: ctx.tenant.id,
      ticket_code: senha?.code ?? '---',
      patient_label: nome,
      room_name: sala.name,
      destination: destinoDaSala(sala.kind),
      priority: proximo.priority,
    });

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: proximo.id,
      patientId: proximo.patient_id,
      description: `Chamado para ${sala.name}`,
    });

    revalidatePath('/medico');
    revalidatePath('/filas');
    revalidatePath('/painel');
    return ok(
      { attendanceId: proximo.id, senha: senha?.code ?? null },
      `Senha ${senha?.code ?? ''} chamada em ${sala.name}.`,
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Devolve o paciente para a fila do medico e libera a sala.
 * Usado quando ninguem atende a chamada.
 */
export async function devolverParaFilaDoMedico(
  attendanceId: string,
  roomId: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('medico.atender');
    const supabase = await createClient();

    const { error } = await supabase
      .from('attendances')
      .update({
        stage_code: 'aguardando_medico',
        in_service: false,
        current_room_id: null,
        consultation_started_at: null,
        updated_by: ctx.userId,
      })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await liberarSala(roomId, ctx.tenant.id);

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: 'Devolvido à fila do médico',
    });

    revalidatePath('/medico');
    return ok(undefined, 'Paciente devolvido à fila.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Marca a sala como livre.
 *
 * Fica exportada porque o fim da consulta tambem precisa: sem isso a sala
 * seguia "ocupada" com o paciente que ja saiu, e o botao de chamar sumia.
 */
export async function liberarSala(roomId: string, tenantId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('rooms')
    .update({ status: 'disponivel', current_attendance_id: null })
    .eq('id', roomId)
    .eq('tenant_id', tenantId);
}
