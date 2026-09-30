'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import type { SessionContext } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { CATALOGO_PADRAO, competenciaDe } from './repasse';
import { dinheiroDigitado } from '@/lib/dinheiro-digitado';

/**
 * Telas que leem `fee_entries` e `procedure_types`.
 *
 * `/financeiro/fluxo-caixa` e `/meus-ganhos` estavam de fora: dar baixa num
 * repasse nao atualizava nem o fechamento de caixa nem a tela do medico, que
 * continuava vendo "a pagar" — e cobrando um repasse ja pago. Nenhuma das
 * duas esta na lista do refresh automatico, entao nao cicatrizava sozinho:
 * so com F5.
 */
const REVALIDAR = [
  '/financeiro',
  '/financeiro/repasse',
  '/financeiro/contas',
  '/financeiro/calendario',
  '/financeiro/fluxo-caixa',
  '/meus-ganhos',
];
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
      // Mesmo motivo dos valores por empresa: `.replace(',', '.')` quebrava
      // "1.234,56" e lia "1.234" como 1,23. E vazio aqui APAGA o valor
      // proprio do medico — num navegador em ingles, a virgula chegava como
      // vazio e o valor desaparecia com mensagem de sucesso.
      const valor = dinheiroDigitado(bruto);
      if (valor === null) {
        paraApagar.push(p.id);
        continue;
      }
      if (Number.isNaN(valor) || valor < 0) {
        return fail(
          `Valor inválido em ${p.code}. Use apenas números — pode usar vírgula nos centavos.`,
        );
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
    // O formulario vive em /usuarios/<id>/repasse, e `revalidatePath` e
    // caminho EXATO, nao prefixo: revalidar '/usuarios' nao alcancava a tela
    // que a pessoa estava olhando. Ela via "Valores do medico salvos." com os
    // campos mostrando os valores antigos, e digitava tudo de novo.
    revalidatePath('/usuarios');
    revalidatePath(`/usuarios/${profileId}/repasse`);
    revalidarFinanceiro();
    return ok(undefined, 'Valores do médico salvos.');
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

    // `attendances` NAO tem `doctor_id`. Quem tem e a consulta.
    //
    // Esta consulta pedia `attendances.doctor_id`, uma coluna que so existe
    // em `medical_consultations`. O PostgREST responde 42703 a um select
    // com coluna inexistente, o erro nao era conferido, `atendimento` vinha
    // nulo e a funcao devolvia "Atendimento nao encontrado" -- que ninguem
    // lia, porque `saveConsultation` descarta o resultado desta chamada.
    //
    // Efeito: NENHUM repasse foi lancado desde que o sistema existe. A tela
    // "Meus ganhos" e a aba Repasse sempre estiveram vazias, e o motivo
    // nunca apareceu em lugar nenhum.
    const { data: atendimento, error: erroAtendimento } = await supabase
      .from('attendances')
      .select('id, patient_id, company_id, created_at, checkin_at')
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        patient_id: string | null;
        company_id: string | null;
        created_at: string;
        checkin_at: string | null;
      }>();
    if (erroAtendimento) return fail(toFriendlyError(erroAtendimento));
    if (!atendimento) return fail('Atendimento nao encontrado.');

    // Quem recebe e quem ASSINOU a consulta. Cair em `ctx.userId` so
    // quando nao houver consulta -- o repasse de um procedimento sem
    // consulta (uma junta, por exemplo) e de quem o esta lancando.
    const { data: consulta } = await supabase
      .from('medical_consultations')
      .select('doctor_id')
      .eq('attendance_id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ doctor_id: string | null }>();

    const medico = consulta?.doctor_id ?? ctx.userId;

    const { data: valorProprio } = await supabase
      .from('medical_fees')
      .select('fee')
      .eq('profile_id', medico)
      .eq('procedure_type_id', procedimento.id)
      .maybeSingle<{ fee: number }>();

    const fee = Number(valorProprio?.fee ?? procedimento.default_fee) || 0;
    // A competencia e o mes em que o paciente FOI ATENDIDO, nao o mes em que
    // a ficha foi criada no sistema. Atendimento agendado ou incluido pelo
    // robozinho nasce dias antes da pessoa aparecer: usar `created_at`
    // jogava o repasse no mes anterior. `checkin_at` e a chegada; `created_at`
    // fica so como rede para ficha sem check-in registrado.
    //
    // Mesma regra da recuperacao de lancamentos da 0047, de proposito: duas
    // regras diferentes colocariam o mesmo atendimento em dois meses.
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(atendimento.checkin_at ?? atendimento.created_at),
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

/**
 * Cancela o repasse de um atendimento que nao vai mais ser cobrado.
 *
 * ---------------------------------------------------------------------
 * O que nao existia
 * ---------------------------------------------------------------------
 * Em todo o sistema NAO havia um unico ponto que escrevesse
 * `status = 'cancelado'` em `fee_entries`. Estornar uma cobranca devolvia o
 * dinheiro ao paciente e o lancamento do medico continuava intacto, em
 * aberto, somando em "Meus ganhos" e em Contas a pagar. Cancelar o
 * atendimento no CRM, igual.
 *
 * Ou seja: a clinica devolvia os R$ 300 ao paciente e continuava devendo os
 * R$ 100 do medico pelo atendimento que deixou de existir. Prejuizo
 * silencioso, uma vez por estorno.
 *
 * ---------------------------------------------------------------------
 * Por que cancelar e nao apagar
 * ---------------------------------------------------------------------
 * O medico atendeu. O lancamento tem de continuar visivel, com o motivo,
 * para ele poder discordar — e para a clinica saber por que aquele
 * atendimento nao entrou no mes. `agruparPorMedico` e `resumirGanhos` ja
 * excluem `cancelado` de todas as somas.
 *
 * Repasse JA PAGO nao se toca: o dinheiro saiu, e mexer no valor pago
 * desacerta o que o medico recebeu. Esse caso e conversa entre a clinica e
 * o medico, nao update de banco — a funcao devolve quantos ficaram de fora
 * para quem chamou poder avisar.
 */
export async function cancelarRepasseDoAtendimento(
  ctx: SessionContext,
  attendanceId: string,
  motivo: string,
): Promise<{ cancelados: number; jaPagos: number }> {
  const supabase = await createClient();

  const { data: lancamentos } = await supabase
    .from('fee_entries')
    .select('id, status, notes')
    .eq('tenant_id', ctx.tenant.id)
    .eq('attendance_id', attendanceId)
    .returns<{ id: string; status: string; notes: string | null }[]>();

  const emAberto = (lancamentos ?? []).filter((l) => l.status === 'a_pagar');
  const jaPagos = (lancamentos ?? []).filter((l) => l.status === 'pago').length;
  if (emAberto.length === 0) return { cancelados: 0, jaPagos };

  const { data: cancelados } = await supabase
    .from('fee_entries')
    .update({
      status: 'cancelado',
      // Anexa, nao substitui: a observacao pode ja trazer um ajuste de valor.
      notes: motivo.slice(0, 240),
      updated_by: ctx.userId,
    })
    .in(
      'id',
      emAberto.map((l) => l.id),
    )
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'a_pagar')
    .select('id')
    .returns<{ id: string }[]>();

  const quantos = cancelados?.length ?? 0;
  if (quantos > 0) {
    await audit(ctx, {
      action: 'update',
      entity: 'fee_entries',
      entityId: attendanceId,
      description: `Repasse cancelado (${quantos} lancamento(s)): ${motivo}`,
    });
    revalidarFinanceiro();
  }

  return { cancelados: quantos, jaPagos };
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
    // `.select()` nao e enfeite: com RLS forcado, um UPDATE barrado afeta
    // ZERO linhas sem levantar erro nenhum. Sem ler as linhas de volta, a
    // tela dizia "Repasse marcado como pago" sobre nada — e a clinica
    // acertava com o medico acreditando que a baixa entrou.
    //
    // O filtro `status = 'a_pagar'` tambem faz a baixa ser idempotente: dois
    // operadores clicando junto, ou um duplo clique, nao paga duas vezes.
    // Mas era exatamente esse filtro que fazia a segunda chamada afetar zero
    // linhas e ainda assim responder sucesso.
    const { data: baixados, error } = await supabase
      .from('fee_entries')
      .update({ status: 'pago', paid_at: new Date().toISOString(), paid_by: ctx.userId })
      .in('id', parsed.data.ids)
      .eq('tenant_id', ctx.tenant.id)
      .eq('status', 'a_pagar')
      .select('id')
      .returns<{ id: string }[]>();
    if (error) return fail(toFriendlyError(error));

    const quantos = baixados?.length ?? 0;
    const pedidos = parsed.data.ids.length;

    if (quantos === 0) {
      return fail(
        pedidos === 1
          ? 'Este lançamento não está em aberto: verifique se a baixa já foi dada.'
          : 'Nenhum dos lançamentos selecionados estava em aberto. Recarregue a página.',
      );
    }

    await audit(ctx, {
      action: 'update',
      entity: 'fee_entries',
      description: `Repasse pago (${quantos} lancamento(s))`,
    });
    revalidarFinanceiro();

    // Dizer o numero real, nao o pedido: selecionar dez e pagar seis tem de
    // aparecer na tela, senao a diferenca some.
    return ok(
      undefined,
      quantos === pedidos
        ? `Repasse marcado como pago (${quantos}).`
        : `${quantos} de ${pedidos} lançamentos marcados como pagos — os outros já não estavam em aberto.`,
    );
  } catch (e) {
    return fail(toFriendlyError(e));
  }
}

const ajusteSchema = z.object({
  id: z.string().uuid(),
  fee: z.coerce.number().min(0, 'Valor invalido'),
  motivo: z.string().trim().max(240).optional(),
});

/**
 * Corrige o valor de um repasse ja lancado.
 *
 * "aba financeiro, nao sta dando opcao para editar o valor de repasse
 *  medico" -- Isabella, 23/09.
 *
 * O valor nasce da tabela do procedimento ou do cadastro do medico, e na
 * maioria das vezes esta certo. Mas acontece de um atendimento valer
 * diferente — plantao, acordo pontual, erro de cadastro descoberto depois
 * — e ate aqui a unica saida era mexer no banco.
 *
 * So lancamento em aberto: repasse ja pago vira historico, e mudar valor
 * pago desacerta o que o medico recebeu. Para esse caso, estorna-se e
 * lanca-se de novo.
 *
 * A correcao fica registrada nas observacoes do lancamento e na auditoria:
 * quem paga precisa saber por que o valor mudou.
 */
export async function ajustarValorDoRepasse(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('financeiro.registrar');
    const parsed = ajusteSchema.safeParse({
      id: formData.get('id'),
      fee: formData.get('fee'),
      motivo: formData.get('motivo') ?? undefined,
    });
    if (!parsed.success) {
      return fail('Verifique o valor informado.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { data: atual } = await supabase
      .from('fee_entries')
      .select('id, fee, status, notes, procedure_name')
      .eq('id', parsed.data.id)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        fee: number;
        status: string;
        notes: string | null;
        procedure_name: string;
      }>();
    if (!atual) return fail('Lançamento não encontrado.');
    if (atual.status !== 'a_pagar') {
      return fail(
        'Este repasse já foi pago. Para corrigir um valor já pago, estorne e lance de novo.',
      );
    }

    const de = Number(atual.fee);
    const para = parsed.data.fee;
    if (de === para) return ok(undefined, 'O valor já era esse.');

    const nota = [
      atual.notes,
      `Valor corrigido de ${de.toFixed(2)} para ${para.toFixed(2)}${
        parsed.data.motivo ? ` — ${parsed.data.motivo}` : ''
      }`,
    ]
      .filter(Boolean)
      .join('\n');

    const { error } = await supabase
      .from('fee_entries')
      .update({ fee: para, notes: nota })
      .eq('id', parsed.data.id)
      .eq('tenant_id', ctx.tenant.id)
      .eq('status', 'a_pagar');
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'fee_entries',
      entityId: parsed.data.id,
      description: `Repasse de ${atual.procedure_name}: valor corrigido de ${de.toFixed(
        2,
      )} para ${para.toFixed(2)}`,
    });
    revalidarFinanceiro();
    return ok(undefined, 'Valor do repasse atualizado.');
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
