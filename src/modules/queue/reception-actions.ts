'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import QRCode from 'qrcode';
import { buildPixPayload, buildTxid } from '@/lib/pix';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/** Inicia o atendimento na recepcao. */
export async function startReception(attendanceId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('recepcao.operar');
    const supabase = await createClient();
    const { error } = await supabase
      .from('attendances')
      .update({
        stage_code: 'na_recepcao',
        reception_started_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: 'Atendimento iniciado na recepção',
    });
    revalidatePath('/recepcao');
    return ok(undefined, 'Atendimento iniciado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Conclui a recepcao: encaminha para triagem ou direto para as filas de exame.
 * Tambem confirma os exames selecionados e a prioridade.
 */
export async function finishReception(input: {
  attendanceId: string;
  needsTriage: boolean;
  priority: 'normal' | 'prioritario' | 'encaixe';
  examTypeIds: string[];
  notes?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('recepcao.operar');
    const supabase = await createClient();

    const { data: attendance } = await supabase
      .from('attendances')
      .select('id, patient_id, appointment_id')
      .eq('id', input.attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string; appointment_id: string | null }>();
    if (!attendance) return fail('Atendimento não encontrado.');

    // Sincroniza a lista de exames com o que foi confirmado na recepcao
    const { data: existing } = await supabase
      .from('patient_exams')
      .select('id, exam_type_id, status')
      .eq('attendance_id', input.attendanceId)
      .returns<{ id: string; exam_type_id: string; status: string }[]>();

    const existingIds = new Set((existing ?? []).map((e) => e.exam_type_id));
    const toAdd = input.examTypeIds.filter((id) => !existingIds.has(id));
    const toRemove = (existing ?? []).filter(
      (e) => !input.examTypeIds.includes(e.exam_type_id) && e.status === 'pendente',
    );

    if (toAdd.length > 0) {
      const { data: types } = await supabase
        .from('exam_types')
        .select('id, default_room_id, sort_order')
        .in('id', toAdd)
        .returns<{ id: string; default_room_id: string | null; sort_order: number }[]>();

      await supabase.from('patient_exams').insert(
        (types ?? []).map((t) => ({
          tenant_id: ctx.tenant.id,
          attendance_id: input.attendanceId,
          patient_id: attendance.patient_id,
          appointment_id: attendance.appointment_id,
          exam_type_id: t.id,
          room_id: t.default_room_id,
          sort_order: t.sort_order,
          priority: input.priority,
          status: 'pendente' as const,
          created_by: ctx.userId,
        })),
      );
    }

    if (toRemove.length > 0) {
      await supabase
        .from('patient_exams')
        .delete()
        .in(
          'id',
          toRemove.map((e) => e.id),
        );
    }

    // Atualiza a prioridade sem mexer em quem ja tinha posicao na fila.
    await supabase
      .from('patient_exams')
      .update({ priority: input.priority })
      .eq('attendance_id', input.attendanceId)
      .eq('status', 'pendente');

    await supabase
      .from('patient_exams')
      .update({ queued_at: new Date().toISOString() })
      .eq('attendance_id', input.attendanceId)
      .eq('status', 'pendente')
      .is('queued_at', null);

    // Sem exame nenhum, mandar para a fila deixaria o paciente parado: nao ha
    // exame para concluir e nada dispara a etapa seguinte. Vai direto ao medico.
    const semExames = input.examTypeIds.length === 0;
    const proximaEtapa = input.needsTriage
      ? 'aguardando_triagem'
      : semExames
        ? 'aguardando_medico'
        : 'aguardando_exames';

    const { error } = await supabase
      .from('attendances')
      .update({
        stage_code: proximaEtapa,
        needs_triage: input.needsTriage,
        priority: input.priority,
        reception_finished_at: new Date().toISOString(),
        notes: input.notes ?? null,
        updated_by: ctx.userId,
      })
      .eq('id', input.attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: input.attendanceId,
      patientId: attendance.patient_id,
      description: input.needsTriage ? 'Encaminhado para triagem' : 'Encaminhado para exames',
    });

    revalidatePath('/recepcao');
    revalidatePath('/crm');
    revalidatePath('/filas');
    return ok(undefined, 'Recepção concluída.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

// =====================================================================
// Cobranca na recepcao
// =====================================================================

export interface DadosRecebedor {
  razaoSocial: string;
  cnpj: string | null;
  endereco: string | null;
  cidade: string | null;
}

export interface CobrancaRecepcao {
  paymentId: string;
  valor: number;
  itens: { nome: string; valor: number }[];
  payload: string;
  qrcode: string | null;
  recebedor: DadosRecebedor;
  jaPago: boolean;
}

/**
 * Gera a cobranca dos exames confirmados na recepcao.
 *
 * O valor e sempre recalculado no servidor a partir da tabela de precos —
 * o que vem do navegador e apenas quais exames foram marcados.
 */
export async function gerarCobrancaRecepcao(
  attendanceId: string,
  examTypeIds: string[],
): Promise<ActionResult<CobrancaRecepcao>> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    const { data: atendimento } = await supabase
      .from('attendances')
      .select('id, patient_id, company_id, patients(full_name)')
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        patient_id: string;
        company_id: string | null;
        patients: { full_name: string } | null;
      }>();
    if (!atendimento) return fail('Atendimento nao encontrado.');

    if (examTypeIds.length === 0) return fail('Selecione ao menos um exame para cobrar.');

    const { data: tipos } = await supabase
      .from('exam_types')
      .select('id, name, price')
      .eq('tenant_id', ctx.tenant.id)
      .in('id', examTypeIds)
      .returns<{ id: string; name: string; price: number | null }[]>();

    const itens = (tipos ?? []).map((t) => ({ nome: t.name, valor: Number(t.price ?? 0) }));
    const valor = itens.reduce((s, i) => s + i.valor, 0);
    if (valor <= 0) {
      return fail('Os exames selecionados nao possuem preco cadastrado.');
    }

    const empresa = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
    const contato = (ctx.settings.contato ?? {}) as Record<string, string | null>;
    const pagamento = (ctx.settings.pagamento ?? {}) as Record<string, string | null>;

    const recebedor: DadosRecebedor = {
      razaoSocial: empresa.razao_social ?? ctx.tenant.legal_name,
      cnpj: empresa.cnpj ?? null,
      endereco:
        [contato.logradouro, contato.numero, contato.bairro].filter(Boolean).join(', ') || null,
      cidade: [contato.cidade, contato.estado].filter(Boolean).join('/') || null,
    };

    // Reaproveita uma cobranca pendente do mesmo atendimento, em vez de
    // empilhar lancamentos a cada clique.
    const { data: existente } = await supabase
      .from('payments')
      .select('id, status, net_amount, pix_charges(payload, qrcode_data_url)')
      .eq('attendance_id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .in('status', ['pendente', 'pago'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        status: string;
        net_amount: number;
        pix_charges: { payload: string; qrcode_data_url: string | null }[];
      }>();

    if (existente && Number(existente.net_amount) === valor) {
      return ok({
        paymentId: existente.id,
        valor,
        itens,
        payload: existente.pix_charges?.[0]?.payload ?? '',
        qrcode: existente.pix_charges?.[0]?.qrcode_data_url ?? null,
        recebedor,
        jaPago: existente.status === 'pago',
      });
    }

    // Valor mudou: cancela a anterior para nao deixar duas cobrancas abertas.
    if (existente && existente.status === 'pendente') {
      await supabase
        .from('payments')
        .update({ status: 'cancelado', cancelled_at: new Date().toISOString() })
        .eq('id', existente.id);
    }

    const descricao = `Exames: ${itens.map((i) => i.nome).join(', ')}`;

    const { data: cobranca, error } = await supabase
      .from('payments')
      .insert({
        tenant_id: ctx.tenant.id,
        attendance_id: attendanceId,
        patient_id: atendimento.patient_id,
        company_id: atendimento.company_id,
        description: descricao.slice(0, 240),
        amount: valor,
        method: 'pix',
        status: 'pendente',
        provider: 'pix_manual',
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('id, net_amount')
      .single<{ id: string; net_amount: number }>();
    if (error) return fail(toFriendlyError(error));

    await supabase.from('payment_transactions').insert({
      tenant_id: ctx.tenant.id,
      payment_id: cobranca.id,
      event: 'criada',
      status: 'pendente',
      amount: cobranca.net_amount,
      performed_by: ctx.userId,
    });

    if (!pagamento.chave_pix) {
      return ok(
        {
          paymentId: cobranca.id,
          valor,
          itens,
          payload: '',
          qrcode: null,
          recebedor,
          jaPago: false,
        },
        'Cobranca criada. Configure a chave Pix para gerar o QR Code.',
      );
    }

    const txid = buildTxid('AT', cobranca.id.replace(/-/g, '').slice(0, 20));
    const payload = buildPixPayload({
      key: pagamento.chave_pix,
      merchantName: pagamento.beneficiario ?? recebedor.razaoSocial,
      merchantCity: pagamento.cidade ?? contato.cidade ?? 'SAO PAULO',
      amount: Number(cobranca.net_amount),
      txid,
      description: atendimento.patients?.full_name ?? undefined,
    });
    const qrcode = await QRCode.toDataURL(payload, { margin: 1, width: 320 });

    await supabase.from('pix_charges').insert({
      tenant_id: ctx.tenant.id,
      payment_id: cobranca.id,
      pix_key: pagamento.chave_pix,
      key_kind: pagamento.tipo_chave ?? 'cnpj',
      merchant_name: pagamento.beneficiario ?? recebedor.razaoSocial,
      merchant_city: pagamento.cidade ?? 'SAO PAULO',
      txid,
      amount: cobranca.net_amount,
      payload,
      qrcode_data_url: qrcode,
      confirmation_mode: 'manual',
    });

    await audit(ctx, {
      action: 'create',
      entity: 'payments',
      entityId: cobranca.id,
      patientId: atendimento.patient_id,
      description: `Cobranca de recepcao gerada (${itens.length} exame(s))`,
    });

    revalidatePath('/recepcao');
    revalidatePath('/financeiro');

    return ok({
      paymentId: cobranca.id,
      valor,
      itens,
      payload,
      qrcode,
      recebedor,
      jaPago: false,
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Confirma o recebimento do Pix na propria recepcao. */
export async function confirmarPagamentoRecepcao(
  paymentId: string,
  attendanceId: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('payments')
      .update({ status: 'pago', paid_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenant.id)
      .select('id, net_amount, patient_id')
      .single<{ id: string; net_amount: number; patient_id: string | null }>();
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
    await supabase
      .from('attendances')
      .update({ payment_status: 'pago' })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);

    await audit(ctx, {
      action: 'update',
      entity: 'payments',
      entityId: paymentId,
      patientId: data.patient_id,
      description: 'Pagamento confirmado na recepcao',
    });

    revalidatePath('/recepcao');
    revalidatePath('/financeiro');
    return ok(undefined, 'Pagamento confirmado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
