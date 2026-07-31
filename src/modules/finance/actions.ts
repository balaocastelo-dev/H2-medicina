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

const chargeSchema = z.object({
  description: z.string().trim().min(2, 'Informe a descricao'),
  amount: z.coerce.number().min(0.01, 'Informe um valor valido'),
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
      return fail('Verifique os dados da cobranca.', z.flattenError(parsed.error).fieldErrors);
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
          'Cobranca criada. Configure a chave Pix em Configuracoes para gerar o QR Code.',
        );
      }
      const txid = buildTxid('CB', data.id.replace(/-/g, '').slice(0, 20));
      const payload = buildPixPayload({
        key: pixSettings.chave_pix,
        merchantName: pixSettings.beneficiario ?? ctx.tenant.trade_name,
        merchantCity: pixSettings.cidade ?? 'SAO PAULO',
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
        merchant_city: pixSettings.cidade ?? 'SAO PAULO',
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
    return ok(data, 'Cobranca criada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function confirmPayment(paymentId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('payments')
      .update({ status: 'pago', paid_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenant.id)
      .select('*')
      .single<Payment>();
    if (error) return fail(toFriendlyError(error));

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
      .select('*')
      .single<Payment>();
    if (error) return fail(toFriendlyError(error));

    await supabase.from('payment_transactions').insert({
      tenant_id: ctx.tenant.id,
      payment_id: paymentId,
      event: 'estorno',
      status: 'estornado',
      amount: data.net_amount,
      performed_by: ctx.userId,
      is_manual: true,
    });

    await audit(ctx, {
      action: 'refund',
      entity: 'payments',
      entityId: paymentId,
      description: `Estorno: ${reason}`,
    });

    revalidatePath('/financeiro');
    return ok(undefined, 'Pagamento estornado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function cancelPayment(paymentId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();
    const { error } = await supabase
      .from('payments')
      .update({
        status: 'cancelado',
        cancelled_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'payments',
      entityId: paymentId,
      description: 'Cobranca cancelada',
    });
    revalidatePath('/financeiro');
    return ok(undefined, 'Cobranca cancelada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
