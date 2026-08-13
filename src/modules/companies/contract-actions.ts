'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildDocumentPdf } from '@/modules/documents/pdf';
import { marcaDoTenant } from '@/modules/documents/brand';
import { paragrafosDoContrato, type ItemDoContrato } from './contract-template';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

const itemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  kind: z.enum(['exame', 'servico']).default('exame'),
  name: z.string().trim().min(1, 'Informe o nome do item'),
  exam_type_id: z.string().uuid().nullable().optional(),
  quantity_included: z.coerce.number().int().min(0).default(0),
  unit_price: z.coerce.number().min(0).nullable().optional(),
  extra_price: z.coerce.number().min(0).nullable().optional(),
});

const contratoSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  company_id: z.string().uuid('Selecione a empresa'),
  name: z.string().trim().min(3, 'Informe o nome do contrato'),
  code: z.string().trim().optional().nullable(),
  kind: z.string().default('pcmso'),
  status: z.enum(['rascunho', 'ativo', 'suspenso', 'encerrado', 'cancelado']).default('ativo'),
  starts_on: z.string().optional().nullable(),
  ends_on: z.string().optional().nullable(),
  signed_on: z.string().optional().nullable(),
  pcmso_valid_until: z.string().optional().nullable(),
  employees_count: z.coerce.number().int().min(0).nullable().optional(),
  monthly_amount: z.coerce.number().min(0).nullable().optional(),
  amount: z.coerce.number().min(0).nullable().optional(),
  billing_day: z.coerce.number().int().min(1).max(28).nullable().optional(),
  readjustment_index: z.string().optional().nullable(),
  auto_renew: z.boolean().default(true),
  esocial_enabled: z.boolean().default(false),
  coordinator_name: z.string().optional().nullable(),
  coordinator_crm: z.string().optional().nullable(),
  schedule_email: z.string().optional().nullable(),
  billing_email: z.string().optional().nullable(),
  technical_hour_rate: z.coerce.number().min(0).nullable().optional(),
  late_fee_percent: z.coerce.number().min(0).nullable().optional(),
  late_interest_percent: z.coerce.number().min(0).nullable().optional(),
  credits_total: z.coerce.number().int().min(0).nullable().optional(),
  notes: z.string().optional().nullable(),
  itens: z.array(itemSchema).default([]),
});

export type ContratoInput = z.input<typeof contratoSchema>;

function limpar<T extends Record<string, unknown>>(objeto: T): T {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    saida[chave] = valor === '' ? null : valor;
  }
  return saida as T;
}

/**
 * Cria ou atualiza o contrato da empresa, junto com seus itens.
 *
 * Os itens sao substituidos por inteiro a cada gravacao: e mais simples de
 * acompanhar do que casar linha a linha, e a lista e curta o bastante para
 * isso nao pesar.
 */
export async function salvarContrato(input: ContratoInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const parsed = contratoSchema.safeParse(input);
    if (!parsed.success) {
      const achatado = z.flattenError(parsed.error);
      return fail(
        Object.values(achatado.fieldErrors).flat()[0] ?? 'Verifique os dados do contrato.',
        achatado.fieldErrors as Record<string, string[]>,
      );
    }

    const { itens, id, ...contrato } = parsed.data;
    const supabase = await createClient();

    const payload = limpar({
      ...contrato,
      tenant_id: ctx.tenant.id,
      updated_by: ctx.userId,
    });

    let contratoId = id ?? null;

    if (contratoId) {
      const { error } = await supabase
        .from('company_contracts')
        .update(payload)
        .eq('id', contratoId)
        .eq('tenant_id', ctx.tenant.id);
      if (error) return fail(toFriendlyError(error));
    } else {
      const { data, error } = await supabase
        .from('company_contracts')
        .insert({ ...payload, created_by: ctx.userId })
        .select('id')
        .single<{ id: string }>();
      if (error || !data) return fail(toFriendlyError(error));
      contratoId = data.id;
    }

    await supabase
      .from('company_contract_items')
      .delete()
      .eq('contract_id', contratoId)
      .eq('tenant_id', ctx.tenant.id);

    if (itens.length > 0) {
      const { error } = await supabase.from('company_contract_items').insert(
        itens.map((item, indice) => ({
          tenant_id: ctx.tenant.id,
          contract_id: contratoId,
          exam_type_id: item.exam_type_id ?? null,
          kind: item.kind,
          name: item.name,
          quantity_included: item.quantity_included,
          unit_price: item.unit_price ?? null,
          extra_price: item.extra_price ?? null,
          sort_order: indice,
          created_by: ctx.userId,
        })),
      );
      if (error) return fail(toFriendlyError(error));
    }

    await audit(ctx, {
      action: id ? 'update' : 'create',
      entity: 'company_contracts',
      entityId: contratoId,
      description: `Contrato ${id ? 'atualizado' : 'criado'}: ${contrato.name}`,
    });

    revalidatePath('/empresas/contratos');
    revalidatePath(`/empresas/${contrato.company_id}`);
    return ok({ id: contratoId }, id ? 'Contrato atualizado.' : 'Contrato criado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}


interface ContratoCompleto {
  id: string;
  name: string;
  company_id: string;
  starts_on: string | null;
  ends_on: string | null;
  employees_count: number | null;
  monthly_amount: number | null;
  amount: number | null;
  billing_day: number | null;
  readjustment_index: string | null;
  auto_renew: boolean;
  esocial_enabled: boolean;
  coordinator_name: string | null;
  coordinator_crm: string | null;
  schedule_email: string | null;
  billing_email: string | null;
  technical_hour_rate: number | null;
  late_fee_percent: number | null;
  late_interest_percent: number | null;
  companies: {
    legal_name: string;
    trade_name: string | null;
    document: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    responsible_name: string | null;
  } | null;
  company_contract_items: ItemDoContrato[];
}

/** Gera o contrato preenchido em PDF e arquiva no atendimento da empresa. */
export async function gerarContratoPdf(
  contractId: string,
): Promise<ActionResult<{ documentId: string }>> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const supabase = await createClient();

    const { data: contrato } = await supabase
      .from('company_contracts')
      .select(
        'id, name, company_id, starts_on, ends_on, employees_count, monthly_amount, amount, billing_day, readjustment_index, auto_renew, esocial_enabled, coordinator_name, coordinator_crm, schedule_email, billing_email, technical_hour_rate, late_fee_percent, late_interest_percent, companies(legal_name, trade_name, document, street, number, district, city, state, responsible_name), company_contract_items(kind, name, quantity_included, unit_price, extra_price)',
      )
      .eq('id', contractId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<ContratoCompleto>();

    if (!contrato) return fail('Contrato não encontrado.');

    const empresaConf = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
    const contatoConf = (ctx.settings.contato ?? {}) as Record<string, string | null>;
    const responsavel = (ctx.settings.responsavel_tecnico ?? {}) as Record<string, string | null>;

    const contratante = contrato.companies;
    const enderecoContratante = [
      contratante?.street,
      contratante?.number,
      contratante?.district,
      contratante?.city,
      contratante?.state,
    ]
      .filter(Boolean)
      .join(', ');

    const paragraphs = paragrafosDoContrato({
      contratanteRazaoSocial: contratante?.legal_name ?? '',
      contratanteCnpj: contratante?.document ?? null,
      contratanteEndereco: enderecoContratante || null,
      contratanteResponsavel: contratante?.responsible_name ?? null,

      contratadaRazaoSocial: empresaConf.razao_social ?? ctx.tenant.legal_name,
      contratadaCnpj: empresaConf.cnpj ?? null,
      contratadaEndereco:
        [contatoConf.logradouro, contatoConf.numero, contatoConf.bairro, contatoConf.cidade]
          .filter(Boolean)
          .join(', ') || null,
      contratadaRepresentante: empresaConf.representante ?? null,

      coordenadorNome: contrato.coordinator_name ?? responsavel.nome ?? null,
      coordenadorCrm:
        contrato.coordinator_crm ??
        [responsavel.conselho, responsavel.numero, responsavel.uf].filter(Boolean).join(' ') ??
        null,

      numeroFuncionarios: contrato.employees_count,
      valorMensal: contrato.monthly_amount,
      valorTotal: contrato.amount,
      diaVencimento: contrato.billing_day,
      indiceReajuste: contrato.readjustment_index,
      multaAtraso: contrato.late_fee_percent,
      jurosAtraso: contrato.late_interest_percent,
      horaTecnica: contrato.technical_hour_rate,

      vigenciaInicio: contrato.starts_on,
      vigenciaFim: contrato.ends_on,
      renovacaoAutomatica: contrato.auto_renew,
      esocialAtivo: contrato.esocial_enabled,

      emailAgendamento: contrato.schedule_email,
      emailFinanceiro: contrato.billing_email,

      itens: contrato.company_contract_items ?? [],
      cidade: contatoConf.cidade ?? null,
      dataEmissao: new Date(),
    });

    const verificationCode = randomBytes(5).toString('hex').toUpperCase();

    const pdfBytes = await buildDocumentPdf({
      brand: await marcaDoTenant(ctx),
      title: contrato.name,
      subtitle: contratante?.trade_name ?? contratante?.legal_name ?? undefined,
      sections: [],
      paragraphs,
      signatureBlocks: [
        {
          caption: 'CONTRATANTE',
          name: contratante?.legal_name ?? null,
          lines: [contratante?.document ? `CNPJ ${contratante.document}` : 'CNPJ ______________'],
        },
        {
          caption: 'CONTRATADA',
          name: empresaConf.razao_social ?? ctx.tenant.legal_name,
          lines: [empresaConf.cnpj ? `CNPJ ${empresaConf.cnpj}` : 'CNPJ ______________'],
        },
      ],
      verificationCode,
    });

    const path = `${ctx.tenant.id}/contratos/${contractId}/contrato-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clinical-documents')
      .upload(path, new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (uploadError) return fail(`Falha ao salvar o contrato: ${uploadError.message}`);

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenant.id,
        kind: 'contrato_empresa',
        title: contrato.name,
        company_id: contrato.company_id,
        bucket: 'clinical-documents',
        file_path: path,
        size_bytes: pdfBytes.byteLength,
        verification_code: verificationCode,
        generated_by: ctx.userId,
      })
      .select('id')
      .single<{ id: string }>();
    if (error) return fail(toFriendlyError(error));

    await supabase
      .from('company_contracts')
      .update({ document_path: path, document_bucket: 'clinical-documents' })
      .eq('id', contractId)
      .eq('tenant_id', ctx.tenant.id);

    await audit(ctx, {
      action: 'create',
      entity: 'documents',
      entityId: doc.id,
      description: `Contrato gerado em PDF: ${contrato.name}`,
    });

    revalidatePath('/empresas/contratos');
    return ok({ documentId: doc.id }, 'Contrato gerado em PDF.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Marca o contrato como encerrado sem apagar o histórico. */
export async function encerrarContrato(
  contractId: string,
  motivo: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const supabase = await createClient();

    const { error } = await supabase
      .from('company_contracts')
      .update({
        status: 'encerrado',
        cancelled_at: new Date().toISOString(),
        cancel_reason: motivo || null,
        updated_by: ctx.userId,
      })
      .eq('id', contractId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'company_contracts',
      entityId: contractId,
      description: `Contrato encerrado: ${motivo || 'sem motivo informado'}`,
    });

    revalidatePath('/empresas/contratos');
    return ok(undefined, 'Contrato encerrado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
