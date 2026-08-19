'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import type { SessionContext } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { CATALOGO_PADRAO, competenciaDe } from './repasse';

const REVALIDAR = ['/financeiro', '/financeiro/repasse', '/financeiro/contas', '/financeiro/calendario'];
const revalidarFinanceiro = () => REVALIDAR.forEach((p) => revalidatePath(p));

// ---------------------------------------------------------------------
// Catalogo de procedimentos
// ---------------------------------------------------------------------

const procedimentoSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2, 'Informe o codigo')
    .regex(/^[a-z0-9_]+$/, 'Use apenas letras minusculas, numeros e underline'),
  name: z.string().trim().min(2, 'Informe o nome'),
  default_fee: z.coerce.number().min(0, 'Valor invalido'),
  sort_order: z.coerce.number().int().min(0).default(0),
  is_active: z.coerce.boolean().default(true),
});

export async function salvarProcedimento(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const raw = Object.fromEntries(formData.entries());
    const parsed = procedimentoSchema.safeParse({
      ...raw,
      id: raw.id || undefined,
      is_active: raw.is_active === 'nao' ? false : true,
    });
    if (!parsed.success) {
      return fail('Verifique os dados do procedimento.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { id, ...campos } = parsed.data;

    const { error } = id
      ? await supabase.from('procedure_types').update(campos).eq('id', id).eq('tenant_id', ctx.tenant.id)
      : await supabase.from('procedure_types').insert({ ...campos, tenant_id: ctx.tenant.id });
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: id ? 'update' : 'create',
      entity: 'procedure_types',
      entityId: id ?? null,
      description: `Procedimento ${campos.name}`,
    });
    revalidarFinanceiro();
    return ok(undefined, 'Procedimento salvo.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

/** Repoe a tabela informada pela clinica, sem sobrescrever o que ja existe. */
export async function restaurarCatalogo(): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const supabase = await createClient();

    const { data: existentes } = await supabase
      .from('procedure_types')
      .select('code')
      .eq('tenant_id', ctx.tenant.id);
    const jaTem = new Set((existentes ?? []).map((p) => p.code));
    const faltando = CATALOGO_PADRAO.filter((p) => !jaTem.has(p.code));

    if (faltando.length === 0) return ok(undefined, 'O catalogo ja esta completo.');

    const { error } = await supabase
      .from('procedure_types')
      .insert(faltando.map((p) => ({ ...p, tenant_id: ctx.tenant.id })));
    if (error) return fail(toFriendlyError(error));

    revalidarFinanceiro();
    return ok(undefined, `${faltando.length} procedimento(s) adicionado(s).`);
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

// ---------------------------------------------------------------------
// Valor por medico (cadastro do medico)
// ---------------------------------------------------------------------

export async function salvarValoresDoMedico(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('usuarios.administrar');
    const profileId = String(formData.get('profile_id') ?? '');
    if (!z.string().uuid().safeParse(profileId).success) return fail('Medico invalido.');

    const supabase = await createClient();
    const { data: procedimentos } = await supabase
      .from('procedure_types')
      .select('id, code')
      .eq('tenant_id', ctx.tenant.id);

    // Campo vazio significa "usa o valor padrao" — a linha e removida.
    const paraGravar: Record<string, unknown>[] = [];
    const paraApagar: string[] = [];

    for (const p of procedimentos ?? []) {
      const bruto = formData.get(`fee_${p.code}`);
      if (bruto === null) continue;
      const texto = String(bruto).trim().replace(',', '.');
      if (texto === '') {
        paraApagar.push(p.id);
        continue;
      }
      const valor = Number(texto);
      if (!Number.isFinite(valor) || valor < 0) {
        return fail(`Valor invalido em ${p.code}.`);
      }
      paraGravar.push({
        tenant_id: ctx.tenant.id,
        profile_id: profileId,
        procedure_type_id: p.id,
        fee: valor,
        created_by: ctx.userId,
      });
    }

    if (paraApagar.length > 0) {
      await supabase
        .from('medical_fees')
        .delete()
        .eq('profile_id', profileId)
        .in('procedure_type_id', paraApagar);
    }

    if (paraGravar.length > 0) {
      const { error } = await supabase
        .from('medical_fees')
        .upsert(paraGravar, { onConflict: 'profile_id,procedure_type_id' });
      if (error) return fail(toFriendlyError(error));
    }

    await audit(ctx, {
      action: 'update',
      entity: 'medical_fees',
      entityId: profileId,
      description: 'Valores de repasse do medico',
    });
    revalidatePath('/usuarios');
    revalidarFinanceiro();
    return ok(undefined, 'Valores do medico salvos.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

// ---------------------------------------------------------------------
// Lancamento do repasse a partir do atendimento
// ---------------------------------------------------------------------

/**
 * Gera o recebivel do medico ao fim da consulta.
 *
 * O valor sai do cadastro do medico; sem cadastro proprio, vale o valor
 * padrao do procedimento. O indice unico por (atendimento, procedimento)
 * garante que reabrir a consulta nao duplica o lancamento.
 */
export async function lancarRepasse(
  ctx: SessionContext,
  attendanceId: string,
  procedureCode?: string | null,
): Promise<ActionResult<{ fee: number } | null>> {
  try {
    const supabase = await createClient();

    const codigo =
      procedureCode?.trim() ||
      (ctx.settings.repasse?.procedimento_padrao as string | undefined) ||
      'consulta_ocupacional';

    const { data: procedimento } = await supabase
      .from('procedure_types')
      .select('id, code, name, default_fee')
      .eq('tenant_id', ctx.tenant.id)
      .eq('code', codigo)
      .maybeSingle<{ id: string; code: string; name: string; default_fee: number }>();
    if (!procedimento) return fail('Procedimento de repasse nao cadastrado.');

    const { data: atendimento } = await supabase
      .from('attendances')
      .select('id, patient_id, company_id, doctor_id, created_at')
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        patient_id: string | null;
        company_id: string | null;
        doctor_id: string | null;
        created_at: string;
      }>();
    if (!atendimento) return fail('Atendimento nao encontrado.');

    const medico = atendimento.doctor_id ?? ctx.userId;

    const { data: valorProprio } = await supabase
      .from('medical_fees')
      .select('fee')
      .eq('profile_id', medico)
      .eq('procedure_type_id', procedimento.id)
      .maybeSingle<{ fee: number }>();

    const fee = Number(valorProprio?.fee ?? procedimento.default_fee) || 0;
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(atendimento.created_at),
    );

    const { error } = await supabase.from('fee_entries').insert({
      tenant_id: ctx.tenant.id,
      profile_id: medico,
      attendance_id: attendanceId,
      patient_id: atendimento.patient_id,
      company_id: atendimento.company_id,
      procedure_type_id: procedimento.id,
      procedure_code: procedimento.code,
      procedure_name: procedimento.name,
      fee,
      competencia: competenciaDe(dia),
      created_by: ctx.userId,
    });

    // Consulta reaberta e finalizada de novo cai no indice unico: nao e erro.
    if (error) {
      if (error.code === '23505') return ok(null);
      return fail(toFriendlyError(error));
    }

    revalidarFinanceiro();
    return ok({ fee });
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

const baixaSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos um lancamento'),
});

export async function marcarRepassePago(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const parsed = baixaSchema.safeParse({ ids: formData.getAll('ids').map(String) });
    if (!parsed.success) return fail('Selecione ao menos um lancamento.');

    const supabase = await createClient();
    const { error } = await supabase
      .from('fee_entries')
      .update({ status: 'pago', paid_at: new Date().toISOString(), paid_by: ctx.userId })
      .in('id', parsed.data.ids)
      .eq('tenant_id', ctx.tenant.id)
      .eq('status', 'a_pagar');
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'fee_entries',
      description: `Repasse pago (${parsed.data.ids.length} lancamento(s))`,
    });
    revalidarFinanceiro();
    return ok(undefined, 'Repasse marcado como pago.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

// ---------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------

const contaSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().trim().min(2, 'Informe a descrição'),
  category: z.string().trim().min(1).default('geral'),
  supplier: z.string().trim().nullable().optional(),
  amount: z.coerce.number().min(0, 'Valor invalido'),
  due_date: z.string().min(10, 'Informe o vencimento'),
  is_recurring: z.coerce.boolean().default(false),
  notes: z.string().trim().nullable().optional(),
});

export async function salvarConta(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const raw = Object.fromEntries(formData.entries());
    const parsed = contaSchema.safeParse({
      ...raw,
      id: raw.id || undefined,
      supplier: raw.supplier || null,
      notes: raw.notes || null,
      is_recurring: raw.is_recurring === 'sim',
    });
    if (!parsed.success) {
      return fail('Verifique os dados da conta.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { id, ...campos } = parsed.data;

    const { error } = id
      ? await supabase
          .from('payables')
          .update({ ...campos, updated_by: ctx.userId })
          .eq('id', id)
          .eq('tenant_id', ctx.tenant.id)
      : await supabase
          .from('payables')
          .insert({ ...campos, tenant_id: ctx.tenant.id, created_by: ctx.userId });
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: id ? 'update' : 'create',
      entity: 'payables',
      entityId: id ?? null,
      description: `Conta a pagar: ${campos.description}`,
    });
    revalidarFinanceiro();
    return ok(undefined, 'Conta salva.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

export async function mudarStatusConta(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const id = String(formData.get('id') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!z.string().uuid().safeParse(id).success) return fail('Conta invalida.');
    if (!['aberta', 'paga', 'cancelada'].includes(status)) return fail('Status invalido.');

    const supabase = await createClient();
    const { error } = await supabase
      .from('payables')
      .update({
        status,
        paid_at: status === 'paga' ? new Date().toISOString() : null,
        paid_by: status === 'paga' ? ctx.userId : null,
        updated_by: ctx.userId,
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, { action: 'update', entity: 'payables', entityId: id, description: `Conta ${status}` });
    revalidarFinanceiro();
    return ok(undefined, status === 'paga' ? 'Conta paga.' : 'Conta atualizada.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

export async function excluirConta(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const id = String(formData.get('id') ?? '');
    if (!z.string().uuid().safeParse(id).success) return fail('Conta invalida.');

    const supabase = await createClient();
    const { error } = await supabase
      .from('payables')
      .update({ deleted_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, { action: 'delete', entity: 'payables', entityId: id });
    revalidarFinanceiro();
    return ok(undefined, 'Conta removida.');
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}
