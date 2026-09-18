'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/**
 * Chamar o paciente para a triagem.
 *
 * Ate 17/09 a triagem era chamada pelo quadro de Filas e salas, onde as
 * salas de triagem apareciam junto com as de exame. Quando elas sairam
 * dali -- para o paciente parar de ir e voltar entre as duas telas --
 * a tela de Triagem ficou sem nenhum botao de chamar.
 *
 * "Aba triagem, nao tem a opcao de clicar para chamar o paciente"
 *                                              -- Isabella, 18/09
 *
 * A chamada vai para a TV da sala de espera, no mesmo destino da
 * recepcao: quem espera para ser triado esta sentado ali.
 */
export async function chamarParaTriagem(
  attendanceId: string,
  salaId?: string | null,
): Promise<ActionResult<{ sala: string }>> {
  try {
    const ctx = await assertPermission('triagem.preencher');
    const supabase = await createClient();

    const [{ data: atendimento }, { data: senha }] = await Promise.all([
      supabase
        .from('attendances')
        .select('id, stage_code, priority, patients(full_name, social_name)')
        .eq('id', attendanceId)
        .eq('tenant_id', ctx.tenant.id)
        .maybeSingle<{
          id: string;
          stage_code: string;
          priority: string;
          patients: { full_name: string; social_name: string | null } | null;
        }>(),
      supabase
        .from('queue_tickets')
        .select('code')
        .eq('attendance_id', attendanceId)
        .maybeSingle<{ code: string }>(),
    ]);

    if (!atendimento) return fail('Atendimento não encontrado.');
    if (!['aguardando_triagem', 'em_triagem'].includes(atendimento.stage_code)) {
      return fail('Este paciente não está aguardando triagem.');
    }

    // A sala é escolhida na tela; sem escolha, a primeira sala de triagem.
    let sala: { id: string; name: string } | null = null;
    if (salaId) {
      const { data } = await supabase
        .from('rooms')
        .select('id, name')
        .eq('id', salaId)
        .eq('tenant_id', ctx.tenant.id)
        .eq('kind', 'triagem')
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle<{ id: string; name: string }>();
      sala = data;
    } else {
      const { data } = await supabase
        .from('rooms')
        .select('id, name')
        .eq('tenant_id', ctx.tenant.id)
        .eq('kind', 'triagem')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order')
        .limit(1)
        .maybeSingle<{ id: string; name: string }>();
      sala = data;
    }

    if (!sala) return fail('Nenhuma sala de triagem cadastrada.');

    const nome = atendimento.patients?.social_name ?? atendimento.patients?.full_name ?? null;

    // A TV é o que faz o paciente levantar da cadeira: se a chamada não
    // aparecer, o resto não adianta. Por isso ela vem antes.
    if (senha?.code) {
      await supabase.from('tv_calls').insert({
        tenant_id: ctx.tenant.id,
        ticket_code: senha.code,
        // O painel anuncia o nome; a lista mostra só o primeiro.
        patient_label: nome,
        room_name: sala.name,
        destination: 'triagem',
        priority: atendimento.priority ?? 'normal',
      });
    }

    await supabase
      .from('attendances')
      .update({
        stage_code: 'em_triagem',
        current_room_id: sala.id,
        in_service: true,
        updated_by: ctx.userId,
      })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);

    await supabase
      .from('rooms')
      .update({ status: 'ocupada', current_attendance_id: attendanceId })
      .eq('id', sala.id)
      .eq('tenant_id', ctx.tenant.id);

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: `Chamado para a triagem em ${sala.name}`,
    });

    revalidatePath('/triagem');
    revalidatePath('/painel');
    return ok({ sala: sala.name }, `Chamado para ${sala.name}.`);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Repete a chamada na TV, sem mexer na etapa.
 *
 * O paciente que estava no banheiro perde a chamada e ninguem quer
 * desfazer a etapa so para anunciar de novo.
 */
export async function repetirChamadaDaTriagem(
  attendanceId: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('triagem.preencher');
    const supabase = await createClient();

    const [{ data: atendimento }, { data: senha }] = await Promise.all([
      supabase
        .from('attendances')
        .select('priority, current_room_id, patients(full_name, social_name), rooms:current_room_id(name)')
        .eq('id', attendanceId)
        .eq('tenant_id', ctx.tenant.id)
        .maybeSingle<{
          priority: string;
          current_room_id: string | null;
          patients: { full_name: string; social_name: string | null } | null;
          rooms: { name: string } | null;
        }>(),
      supabase
        .from('queue_tickets')
        .select('code')
        .eq('attendance_id', attendanceId)
        .maybeSingle<{ code: string }>(),
    ]);

    if (!atendimento || !senha?.code) return fail('Senha não encontrada.');

    await supabase.from('tv_calls').insert({
      tenant_id: ctx.tenant.id,
      ticket_code: senha.code,
      patient_label: atendimento.patients?.social_name ?? atendimento.patients?.full_name ?? null,
      room_name: atendimento.rooms?.name ?? 'Triagem',
      destination: 'triagem',
      priority: atendimento.priority ?? 'normal',
    });

    revalidatePath('/painel');
    return ok(undefined, 'Chamada repetida.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
