'use server';

import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildPixPayload, buildTxid } from '@/lib/pix';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { sincronizarAgendamento } from '@/modules/queue/sync-appointment';
import { emitirDocumentosDeSaida } from '@/modules/documents/actions';

/**
 * Etapa de pagamento, entre a consulta e a emissão dos documentos.
 *
 * A regra do negócio é simples: documento só sai depois que a conta fecha.
 * Por isso a liberação para documentos vive aqui, e não na tela de documentos.
 */

export interface PixGerado {
  paymentId: string;
  valor: number;
  payload: string;
  qrcode: string | null;
}

/** Gera (ou recupera) o Pix de uma cobrança pendente do atendimento. */
export async function gerarPixDoAtendimento(
  attendanceId: string,
): Promise<ActionResult<PixGerado>> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    const { data: cobranca } = await supabase
      .from('payments')
      .select('id, net_amount, description, pix_charges(payload, qrcode_data_url)')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .eq('status', 'pendente')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        net_amount: number;
        description: string | null;
        pix_charges: { payload: string; qrcode_data_url: string | null }[];
      }>();

    if (!cobranca) return fail('Não há cobrança pendente para este atendimento.');

    const existente = cobranca.pix_charges?.[0];
    if (existente?.payload) {
      return ok({
        paymentId: cobranca.id,
        valor: Number(cobranca.net_amount),
        payload: existente.payload,
        qrcode: existente.qrcode_data_url,
      });
    }

    const conf = (ctx.settings.pagamento ?? {}) as Record<string, string | null>;
    if (!conf.chave_pix) {
      return fail('Chave Pix não configurada. Cadastre em Configurações → Pagamento e Pix.');
    }

    const txid = buildTxid('AT', cobranca.id.replace(/-/g, '').slice(0, 20));
    const payload = buildPixPayload({
      key: conf.chave_pix,
      merchantName: conf.beneficiario ?? ctx.tenant.trade_name,
      merchantCity: conf.cidade ?? 'SAO PAULO',
      amount: Number(cobranca.net_amount),
      txid,
      description: cobranca.description ?? undefined,
    });
    const qrcode = await QRCode.toDataURL(payload, { margin: 1, width: 320 });

    await supabase.from('pix_charges').insert({
      tenant_id: ctx.tenant.id,
      payment_id: cobranca.id,
      pix_key: conf.chave_pix,
      key_kind: conf.tipo_chave ?? 'cnpj',
      merchant_name: conf.beneficiario ?? ctx.tenant.trade_name,
      merchant_city: conf.cidade ?? 'SAO PAULO',
      txid,
      amount: cobranca.net_amount,
      payload,
      qrcode_data_url: qrcode,
      confirmation_mode: 'manual',
    });

    revalidatePath('/pagamentos');
    return ok({
      paymentId: cobranca.id,
      valor: Number(cobranca.net_amount),
      payload,
      qrcode,
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Confirma todos os pagamentos pendentes do atendimento. */
export async function quitarAtendimento(attendanceId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();
    const agora = new Date().toISOString();

    const { data: pendentes } = await supabase
      .from('payments')
      .select('id, net_amount')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .eq('status', 'pendente')
      .returns<{ id: string; net_amount: number }[]>();

    for (const p of pendentes ?? []) {
      await supabase
        .from('payments')
        .update({ status: 'pago', paid_at: agora, updated_by: ctx.userId })
        .eq('id', p.id);
      await supabase.from('payment_transactions').insert({
        tenant_id: ctx.tenant.id,
        payment_id: p.id,
        event: 'confirmada',
        status: 'pago',
        amount: p.net_amount,
        performed_by: ctx.userId,
        is_manual: true,
      });
      await supabase
        .from('pix_charges')
        .update({ confirmed_at: agora, confirmed_by: ctx.userId })
        .eq('payment_id', p.id);
    }

    await supabase
      .from('attendances')
      .update({ payment_status: 'pago', updated_by: ctx.userId })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: `Pagamento quitado (${(pendentes ?? []).length} cobrança(s))`,
    });

    revalidatePath('/pagamentos');
    revalidatePath('/financeiro');
    return ok(undefined, 'Pagamento confirmado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Libera o atendimento para a emissão dos documentos.
 *
 * Recusa enquanto houver valor em aberto — é a trava que garante que nenhum
 * documento saia sem a conta fechada. Cortesia e faturamento empresarial
 * passam porque a cobrança correspondente já nasce quitada ou é da empresa.
 */
export async function liberarDocumentos(attendanceId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    const { data: abertos } = await supabase
      .from('payments')
      .select('id, net_amount, method')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .in('status', ['pendente', 'em_analise'])
      .returns<{ id: string; net_amount: number; method: string }[]>();

    const emAberto = (abertos ?? []).filter((p) => p.method !== 'faturamento');
    if (emAberto.length > 0) {
      const total = emAberto.reduce((s, p) => s + Number(p.net_amount), 0);
      return fail(
        `Ainda há R$ ${total.toFixed(2).replace('.', ',')} em aberto. Confirme o pagamento antes de liberar os documentos.`,
      );
    }

    const { error } = await supabase
      .from('attendances')
      .update({ stage_code: 'aguardando_documentos', updated_by: ctx.userId })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await sincronizarAgendamento(ctx.tenant.id, attendanceId);

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: 'Liberado para emissão de documentos',
    });

    revalidatePath('/pagamentos');
    revalidatePath('/documentos');
    revalidatePath('/crm');
    return ok(undefined, 'Liberado para documentos.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Encerra o atendimento após a entrega dos documentos.
 *
 * Antes de fechar, garante o kit de saída — comprovante de comparecimento,
 * recibo e comprovante de agendamento. A clínica pediu que saia para todos,
 * e depender da memória de quem está no balcão não estava funcionando.
 */
export async function encerrarAtendimento(attendanceId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();
    const agora = new Date().toISOString();

    const kit = await emitirDocumentosDeSaida(attendanceId);

    const { error } = await supabase
      .from('attendances')
      .update({
        stage_code: 'finalizado',
        finished_at: agora,
        exit_at: agora,
        in_service: false,
        current_room_id: null,
        updated_by: ctx.userId,
      })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await sincronizarAgendamento(ctx.tenant.id, attendanceId);

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: 'Atendimento encerrado',
    });

    revalidatePath('/documentos');
    revalidatePath('/crm');
    return ok(
      undefined,
      kit.ok
        ? `Atendimento encerrado. ${kit.message ?? ''}`.trim()
        : `Atendimento encerrado, mas os documentos de saída falharam: ${kit.error}`,
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
