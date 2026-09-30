'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildPixPayload, buildTxid } from '@/lib/pix';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { Payment } from '@/types/entities';
import { cancelarRepasseDoAtendimento } from './repasse-actions';

const chargeSchema = z.object({
  description: z.string().trim().min(2, 'Informe a descrição'),
  amount: z.coerce.number().min(0.01, 'Informe um valor válido'),
  discount: z.coerce.number().min(0).default(0),
  method: z.enum([
    'pix',
    'cartao',
    'dinheiro',
    'link',
    'faturamento',
    'manual',
    'cortesia',
    'cupom',
  ]),
  attendance_id: z.string().uuid().nullable().optional(),
  patient_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export async function createCharge(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Payment>> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const raw = Object.fromEntries(formData.entries());
    const parsed = chargeSchema.safeParse({
      ...raw,
      attendance_id: raw.attendance_id || null,
      patient_id: raw.patient_id || null,
      company_id: raw.company_id || null,
      order_id: raw.order_id || null,
      due_date: raw.due_date || null,
    });
    if (!parsed.success) {
      return fail('Verifique os dados da cobrança.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const isFree = parsed.data.method === 'cortesia';

    const { data, error } = await supabase
      .from('payments')
      .insert({
        ...parsed.data,
        tenant_id: ctx.tenant.id,
        status: isFree ? 'pago' : 'pendente',
        paid_at: isFree ? new Date().toISOString() : null,
        provider: parsed.data.method === 'pix' ? 'pix_manual' : 'manual',
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('*')
      .single<Payment>();
    if (error) return fail(toFriendlyError(error));

    await supabase.from('payment_transactions').insert({
      tenant_id: ctx.tenant.id,
      payment_id: data.id,
      event: 'criada',
      status: data.status,
      amount: data.net_amount,
      performed_by: ctx.userId,
    });

    // Cobranca Pix: gera BR Code com a chave configurada no painel
    if (parsed.data.method === 'pix') {
      const pixSettings = (ctx.settings.pagamento ?? {}) as {
        chave_pix?: string;
        tipo_chave?: string;
        beneficiario?: string;
        cidade?: string;
      };
      if (!pixSettings.chave_pix) {
        return ok(
          data,
          'Cobrança criada. Configure a chave Pix em Configurações para gerar o QR Code.',
        );
      }
      const txid = buildTxid('CB', data.id.replace(/-/g, '').slice(0, 20));
      const payload = buildPixPayload({
        key: pixSettings.chave_pix,
        merchantName: pixSettings.beneficiario ?? ctx.tenant.trade_name,
        merchantCity: pixSettings.cidade ?? 'São PAULO',
        amount: Number(data.net_amount),
        txid,
        description: parsed.data.description,
      });
      const qrcode = await QRCode.toDataURL(payload, { margin: 1, width: 320 });

      await supabase.from('pix_charges').insert({
        tenant_id: ctx.tenant.id,
        payment_id: data.id,
        pix_key: pixSettings.chave_pix,
        key_kind: pixSettings.tipo_chave ?? 'aleatoria',
        merchant_name: pixSettings.beneficiario ?? ctx.tenant.trade_name,
        merchant_city: pixSettings.cidade ?? 'São PAULO',
        txid,
        amount: data.net_amount,
        payload,
        qrcode_data_url: qrcode,
        confirmation_mode: 'manual',
      });
    }

    await audit(ctx, {
      action: 'create',
      entity: 'payments',
      entityId: data.id,
      patientId: parsed.data.patient_id ?? null,
      description: `Cobranca criada (${parsed.data.method})`,
      next: data,
    });

    revalidatePath('/financeiro');
    return ok(data, 'Cobrança criada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function confirmPayment(paymentId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    // `status` na condicao: confirmar e para cobranca em aberto.
    //
    // Sem isso, dois cliques rapidos (ou dois operadores) gravavam DUAS
    // linhas 'confirmada' em `payment_transactions` para a mesma cobranca, e
    // o livro passava a mostrar a receita em dobro. `quitarAtendimento` e
    // `cancelPayment` ja faziam essa guarda; estas duas ficaram de fora.
    const { data, error } = await supabase
      .from('payments')
      .update({ status: 'pago', paid_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenant.id)
      .in('status', ['pendente', 'em_analise'])
      .select('*')
      .maybeSingle<Payment>();
    if (error) return fail(toFriendlyError(error));
    if (!data) {
      return fail('Esta cobrança não está em aberto — verifique se o pagamento já foi confirmado.');
    }

    await supabase.from('payment_transactions').insert({
      tenant_id: ctx.tenant.id,
      payment_id: paymentId,
      event: 'confirmada',
      status: 'pago',
      amount: data.net_amount,
      performed_by: ctx.userId,
      is_manual: true,
    });

    await supabase
      .from('pix_charges')
      .update({ confirmed_at: new Date().toISOString(), confirmed_by: ctx.userId })
      .eq('payment_id', paymentId);

    if (data.attendance_id) {
      await supabase
        .from('attendances')
        .update({ payment_status: 'pago' })
        .eq('id', data.attendance_id);
    }

    await audit(ctx, {
      action: 'update',
      entity: 'payments',
      entityId: paymentId,
      description: 'Pagamento confirmado manualmente',
    });

    revalidatePath('/financeiro');
    return ok(undefined, 'Pagamento confirmado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function refundPayment(paymentId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.estornar');
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('payments')
      .update({
        status: 'estornado',
        refunded_at: new Date().toISOString(),
        refund_reason: reason,
        updated_by: ctx.userId,
      })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenant.id)
      // So se estorna o que foi pago, e so uma vez: o duplo clique gravava
      // dois estornos e rodava `desfazerAtendimento` duas vezes.
      .eq('status', 'pago')
      .select('*')
      .maybeSingle<Payment>();
    if (error) return fail(toFriendlyError(error));
    if (!data) {
      return fail('Só é possível estornar cobrança paga — verifique se ela já foi estornada.');
    }

    await supabase.from('payment_transactions').insert({
      tenant_id: ctx.tenant.id,
      payment_id: paymentId,
      event: 'estorno',
      status: 'estornado',
      amount: data.net_amount,
      performed_by: ctx.userId,
      is_manual: true,
    });

    // O estorno tem de descer ate o atendimento, senao ele fica "pago" para
    // sempre e a proxima liberacao de documento passa sem cobranca nenhuma.
    // E o repasse do medico tem de cair junto: devolver o dinheiro ao
    // paciente e continuar devendo o repasse e prejuizo por estorno.
    const consequencias = await desfazerAtendimento(
      ctx,
      data.attendance_id,
      `Cobranca estornada: ${reason}`,
    );

    await audit(ctx, {
      action: 'refund',
      entity: 'payments',
      entityId: paymentId,
      description: `Estorno: ${reason}`,
    });

    revalidatePath('/financeiro');
    return ok(undefined, `Pagamento estornado.${consequencias}`);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function cancelPayment(paymentId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    // Cancelar e para cobranca que nunca foi paga. Cobranca paga se ESTORNA,
    // que devolve dinheiro e deixa lancamento no livro.
    //
    // A tela so mostrava o botao para pendente, mas a acao e chamavel direta:
    // sem esta condicao, cancelar uma cobranca paga tirava a receita do
    // caixa sem nenhum registro de que o dinheiro tinha entrado.
    //
    // E `.select()` porque, com RLS forcado, UPDATE barrado afeta zero
    // linhas em silencio — a tela dizia "Cobranca cancelada" sobre nada.
    const { data: cancelada, error } = await supabase
      .from('payments')
      .update({
        status: 'cancelado',
        cancelled_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenant.id)
      .in('status', ['pendente', 'em_analise', 'falhou'])
      .select('id, net_amount, attendance_id')
      .maybeSingle<{ id: string; net_amount: number; attendance_id: string | null }>();
    if (error) return fail(toFriendlyError(error));
    if (!cancelada) {
      return fail(
        'Só é possível cancelar cobrança em aberto. Cobrança já paga precisa ser estornada.',
      );
    }

    // Cancelamento tambem entra no livro. Criar, confirmar e estornar
    // gravavam `payment_transactions`; so o cancelamento nao, e por isso uma
    // cobranca podia desaparecer da receita sem deixar linha nenhuma.
    await supabase.from('payment_transactions').insert({
      tenant_id: ctx.tenant.id,
      payment_id: paymentId,
      event: 'cancelamento',
      status: 'cancelado',
      amount: cancelada.net_amount,
      performed_by: ctx.userId,
      is_manual: true,
    });

    const consequencias = await desfazerAtendimento(
      ctx,
      cancelada.attendance_id,
      'Cobranca cancelada',
    );

    await audit(ctx, {
      action: 'update',
      entity: 'payments',
      entityId: paymentId,
      description: 'Cobrança cancelada',
    });
    revalidatePath('/financeiro');
    return ok(undefined, `Cobrança cancelada.${consequencias}`);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Desfaz o que a cobranca havia liberado no atendimento.
 *
 * Chamada por estorno e por cancelamento. Faz duas coisas que faltavam:
 *
 * 1. Devolve `attendances.payment_status` a "pendente" quando nao sobrou
 *    cobranca paga. Sem isso o atendimento ficava "pago" para sempre e a
 *    trava de liberacao de documentos deixava passar.
 * 2. Cancela o repasse do medico daquele atendimento.
 *
 * Devolve um pedaco de frase para juntar a mensagem de sucesso: quem
 * estorna precisa saber que o repasse caiu — e precisa saber quando NAO
 * caiu, porque ja estava pago.
 */
async function desfazerAtendimento(
  ctx: Awaited<ReturnType<typeof assertPermission>>,
  attendanceId: string | null,
  motivo: string,
): Promise<string> {
  if (!attendanceId) return '';
  const supabase = await createClient();

  // Um atendimento pode ter mais de uma cobranca. Se ainda houver uma paga,
  // ele continua pago.
  const { data: aindaPagas } = await supabase
    .from('payments')
    .select('id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('attendance_id', attendanceId)
    .eq('status', 'pago')
    .is('deleted_at', null)
    .limit(1)
    .returns<{ id: string }[]>();

  if ((aindaPagas?.length ?? 0) === 0) {
    await supabase
      .from('attendances')
      .update({ payment_status: 'pendente' })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);
  }

  const { cancelados, jaPagos } = await cancelarRepasseDoAtendimento(ctx, attendanceId, motivo);

  const partes: string[] = [];
  if (cancelados > 0) partes.push(`Repasse do médico cancelado (${cancelados}).`);
  if (jaPagos > 0) {
    partes.push(
      `Atenção: ${jaPagos} repasse(s) deste atendimento já foram pagos ao médico e não foram desfeitos.`,
    );
  }
  return partes.length > 0 ? ` ${partes.join(' ')}` : '';
}
