'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/**
 * Decisao da recepcao sobre os pedidos vindos do site.
 *
 * O pedido chega reservando o horario, mas sem valer como agendamento
 * firme. Aqui ele vira um dos dois: confirmado, e entao ocupa a agenda de
 * verdade; ou recusado, e o horario volta a aparecer no site.
 */

export async function confirmarPedidoOnline(appointmentId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();

    const { data: pedido } = await supabase
      .from('appointments')
      .select('id, patient_id, requester_name, scheduled_at, confirmed_at, rejected_at')
      .eq('id', appointmentId)
      .eq('tenant_id', ctx.tenant.id)
      .eq('requested_online', true)
      .maybeSingle<{
        id: string;
        patient_id: string;
        requester_name: string | null;
        scheduled_at: string;
        confirmed_at: string | null;
        rejected_at: string | null;
      }>();

    if (!pedido) return fail('Pedido não encontrado.');
    if (pedido.confirmed_at) return fail('Este pedido já está confirmado.');
    if (pedido.rejected_at) return fail('Este pedido já foi recusado.');

    const { error } = await supabase
      .from('appointments')
      .update({
        status: 'confirmado',
        confirmed_at: new Date().toISOString(),
        confirmed_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .eq('id', appointmentId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: appointmentId,
      patientId: pedido.patient_id,
      description: `Agendamento pelo site confirmado: ${pedido.requester_name ?? 'paciente'}`,
    });

    revalidatePath('/agenda');
    return ok(undefined, 'Agendamento confirmado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Recusa o pedido e devolve o horario a agenda publica.
 *
 * Cancela em vez de apagar: o registro do que foi pedido e recusado vale
 * quando a pessoa liga perguntando o que aconteceu.
 */
export async function recusarPedidoOnline(
  appointmentId: string,
  motivo: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();

    const { data: pedido } = await supabase
      .from('appointments')
      .select('id, patient_id, requester_name, confirmed_at')
      .eq('id', appointmentId)
      .eq('tenant_id', ctx.tenant.id)
      .eq('requested_online', true)
      .maybeSingle<{
        id: string;
        patient_id: string;
        requester_name: string | null;
        confirmed_at: string | null;
      }>();

    if (!pedido) return fail('Pedido não encontrado.');
    if (pedido.confirmed_at) {
      return fail('Este pedido já foi confirmado. Use o cancelamento da agenda.');
    }

    const agora = new Date().toISOString();
    const { error } = await supabase
      .from('appointments')
      .update({
        status: 'cancelado',
        rejected_at: agora,
        reject_reason: motivo.trim().slice(0, 300) || null,
        cancelled_at: agora,
        cancel_reason: 'Pedido do site recusado pela recepção',
        updated_by: ctx.userId,
      })
      .eq('id', appointmentId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: appointmentId,
      patientId: pedido.patient_id,
      description: `Agendamento pelo site recusado: ${motivo || 'sem motivo informado'}`,
    });

    revalidatePath('/agenda');
    return ok(undefined, 'Pedido recusado. O horário voltou a ficar livre no site.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
