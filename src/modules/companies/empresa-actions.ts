'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

// ---------------------------------------------------------------------
// Perigos e fatores de risco por cargo
// ---------------------------------------------------------------------

const riscoSchema = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid(),
  /** Vazio significa perfil geral da empresa. */
  cargo: z.string().trim().nullable().optional(),
  fisicos: z.string().trim().nullable().optional(),
  quimicos: z.string().trim().nullable().optional(),
  biologicos: z.string().trim().nullable().optional(),
  ergonomicos: z.string().trim().nullable().optional(),
  acidentes: z.string().trim().nullable().optional(),
});

/**
 * Salva o perfil de risco de um cargo.
 *
 * O perfil sem cargo e o geral da empresa: vale para todo cargo que nao
 * tiver o seu. E o que evita ter que cadastrar risco funcao por funcao numa
 * empresa onde todo mundo corre o mesmo risco.
 */
export async function salvarPerfilDeRisco(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const bruto = Object.fromEntries(formData.entries());
    const parsed = riscoSchema.safeParse({
      ...bruto,
      id: bruto.id || undefined,
      cargo: (bruto.cargo as string)?.trim() || null,
      fisicos: (bruto.fisicos as string)?.trim() || null,
      quimicos: (bruto.quimicos as string)?.trim() || null,
      biologicos: (bruto.biologicos as string)?.trim() || null,
      ergonomicos: (bruto.ergonomicos as string)?.trim() || null,
      acidentes: (bruto.acidentes as string)?.trim() || null,
    });
    if (!parsed.success) {
      return fail('Verifique os dados do perfil.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { id, ...campos } = parsed.data;

    const { error } = id
      ? await supabase
          .from('company_risk_profiles')
          .update({ ...campos, updated_by: ctx.userId })
          .eq('id', id)
          .eq('tenant_id', ctx.tenant.id)
      : await supabase.from('company_risk_profiles').insert({
          ...campos,
          tenant_id: ctx.tenant.id,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        });

    if (error) {
      if (error.code === '23505') {
        return fail('Já existe um perfil para este cargo nesta empresa.');
      }
      return fail(toFriendlyError(error));
    }

    await audit(ctx, {
      action: id ? 'update' : 'create',
      entity: 'company_risk_profiles',
      entityId: id ?? null,
      companyId: campos.company_id,
      description: `Riscos de ${campos.cargo ?? 'todos os cargos'}`,
    });

    revalidatePath(`/empresas/${campos.company_id}`);
    return ok(undefined, 'Perfil de risco salvo.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function excluirPerfilDeRisco(
  id: string,
  companyId: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const supabase = await createClient();

    const { error } = await supabase
      .from('company_risk_profiles')
      .update({ deleted_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'delete',
      entity: 'company_risk_profiles',
      entityId: id,
      companyId,
    });

    revalidatePath(`/empresas/${companyId}`);
    return ok(undefined, 'Perfil removido.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

// ---------------------------------------------------------------------
// Valores negociados por exame
// ---------------------------------------------------------------------

/**
 * Salva a tabela de precos da empresa de uma vez.
 *
 * Campo vazio significa "usa o preco de tabela": a linha e removida, em vez
 * de gravar zero. Zero e um preco valido — exame de cortesia existe — e
 * confundir os dois faria a clinica deixar de cobrar sem querer.
 */
export async function salvarValoresDaEmpresa(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const companyId = String(formData.get('company_id') ?? '');
    if (!z.string().uuid().safeParse(companyId).success) return fail('Empresa inválida.');

    const supabase = await createClient();
    const { data: exames } = await supabase
      .from('exam_types')
      .select('id')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .returns<{ id: string }[]>();

    const paraGravar: Record<string, unknown>[] = [];
    const paraApagar: string[] = [];

    for (const exame of exames ?? []) {
      const bruto = formData.get(`preco_${exame.id}`);
      if (bruto === null) continue;

      const texto = String(bruto).trim().replace(',', '.');
      if (texto === '') {
        paraApagar.push(exame.id);
        continue;
      }

      const valor = Number(texto);
      if (!Number.isFinite(valor) || valor < 0) {
        return fail('Há um valor inválido na tabela. Use apenas números.');
      }

      paraGravar.push({
        tenant_id: ctx.tenant.id,
        company_id: companyId,
        exam_type_id: exame.id,
        contract_id: null,
        price: valor,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      });
    }

    // -----------------------------------------------------------------
    // Apaga e grava, em vez de "upsert".
    //
    // "na hora de colocar os valores para cada exame da empresa, esta
    //  dando erro e nao ta salvando" -- Isabella, 25/09.
    //
    // O indice unico da tabela e sobre uma EXPRESSAO --
    // `(company_id, exam_type_id, coalesce(contract_id, '000...'))` --
    // porque em Postgres dois NULOS nao sao iguais entre si: sem o
    // coalesce, a mesma empresa poderia ter o mesmo exame gravado duas
    // vezes sem contrato.
    //
    // `on conflict (company_id, exam_type_id, contract_id)` nao casa com
    // um indice de expressao, e o Postgres recusa a instrucao inteira
    // (42P10). Nao era "uma linha nao gravou": nao gravava nada.
    //
    // Apagar e inserir nao depende de inferencia de indice nenhuma. So
    // toca nos exames que vieram no formulario: apagar tudo levaria junto
    // o preco de um exame desativado, que a tela nem mostra.
    // -----------------------------------------------------------------
    const noFormulario = [...paraApagar, ...paraGravar.map((l) => String(l.exam_type_id))];

    if (noFormulario.length > 0) {
      const { error } = await supabase
        .from('company_exam_prices')
        .delete()
        .eq('tenant_id', ctx.tenant.id)
        .eq('company_id', companyId)
        .is('contract_id', null)
        .in('exam_type_id', noFormulario);
      if (error) return fail(toFriendlyError(error));
    }

    if (paraGravar.length > 0) {
      const { error } = await supabase.from('company_exam_prices').insert(paraGravar);
      if (error) return fail(toFriendlyError(error));
    }

    await audit(ctx, {
      action: 'update',
      entity: 'company_exam_prices',
      companyId,
      description: `Tabela de valores atualizada (${paraGravar.length} exame(s))`,
    });

    revalidatePath(`/empresas/${companyId}`);
    return ok(undefined, 'Valores salvos.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
