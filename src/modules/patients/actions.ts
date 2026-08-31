'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { patientSchema } from '@/lib/validators';
import { onlyDigits } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { Patient } from '@/types/entities';

function parseForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  return patientSchema.safeParse({
    ...raw,
    company_id: raw.company_id ? String(raw.company_id) : null,
    cpf: raw.cpf ? String(raw.cpf) : null,
    email: raw.email ? String(raw.email) : '',
  });
}

/** Procura duplicidades antes de gravar (CPF, documento externo, nome+nascimento). */
async function findDuplicates(
  tenantId: string,
  data: { cpf?: string | null; full_name: string; birth_date?: string | null },
  excludeId?: string,
): Promise<{ id: string; full_name: string; rule: string }[]> {
  const supabase = await createClient();
  const found: { id: string; full_name: string; rule: string }[] = [];

  if (data.cpf) {
    const { data: byCpf } = await supabase
      .from('patients')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('cpf', onlyDigits(data.cpf))
      .is('deleted_at', null)
      .returns<{ id: string; full_name: string }[]>();
    for (const p of byCpf ?? []) {
      if (p.id !== excludeId) found.push({ ...p, rule: 'cpf' });
    }
  }

  if (data.birth_date && found.length === 0) {
    const { data: byName } = await supabase
      .from('patients')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('birth_date', data.birth_date)
      .ilike('full_name', data.full_name)
      .is('deleted_at', null)
      .returns<{ id: string; full_name: string }[]>();
    for (const p of byName ?? []) {
      if (p.id !== excludeId) found.push({ ...p, rule: 'nome_nascimento' });
    }
  }

  return found;
}

export async function createPatient(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Patient>> {
  try {
    const ctx = await assertPermission('pacientes.criar');
    const parsed = parseForm(formData);
    if (!parsed.success) {
      return fail('Verifique os campos destacados.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const duplicates = await findDuplicates(ctx.tenant.id, parsed.data);
    const force = formData.get('confirmar_duplicidade') === 'sim';

    if (duplicates.length > 0 && !force) {
      return fail(
        `Ja existe paciente com dados semelhantes: ${duplicates
          .map((d) => d.full_name)
          .join(', ')}. Confirme para cadastrar mesmo assim.`,
      );
    }

    const { data, error } = await supabase
      .from('patients')
      .insert({
        ...parsed.data,
        tenant_id: ctx.tenant.id,
        origin: 'manual',
        needs_review: duplicates.length > 0,
        review_reason: duplicates.length > 0 ? 'Possível duplicidade confirmada no cadastro' : null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('*')
      .single<Patient>();

    if (error) return fail(toFriendlyError(error));

    if (parsed.data.company_id) {
      await supabase.from('patient_employments').insert({
        tenant_id: ctx.tenant.id,
        patient_id: data.id,
        company_id: parsed.data.company_id,
        job_title: parsed.data.job_title ?? null,
        department: parsed.data.department ?? null,
        registration_number: parsed.data.registration_number ?? null,
        is_current: true,
        created_by: ctx.userId,
      });
    }

    await audit(ctx, {
      action: 'create',
      entity: 'patients',
      entityId: data.id,
      patientId: data.id,
      description: `Paciente ${data.full_name} cadastrado`,
      next: data,
    });

    revalidatePath('/pacientes');
    return ok(data, 'Paciente cadastrado com sucesso.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function updatePatient(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Patient>> {
  try {
    const ctx = await assertPermission('pacientes.editar');
    const parsed = parseForm(formData);
    if (!parsed.success) {
      return fail('Verifique os campos destacados.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { data: previous } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle<Patient>();

    const { data, error } = await supabase
      .from('patients')
      .update({ ...parsed.data, updated_by: ctx.userId })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .select('*')
      .single<Patient>();

    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'patients',
      entityId: id,
      patientId: id,
      description: `Paciente ${data.full_name} atualizado`,
      previous,
      next: data,
    });

    revalidatePath('/pacientes');
    revalidatePath(`/pacientes/${id}`);
    return ok(data, 'Cadastro atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function softDeletePatient(id: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('pacientes.excluir');
    const supabase = await createClient();
    const { error } = await supabase
      .from('patients')
      .update({ deleted_at: new Date().toISOString(), updated_by: ctx.userId })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'delete',
      entity: 'patients',
      entityId: id,
      patientId: id,
      description: 'Paciente removido (soft delete)',
    });
    revalidatePath('/pacientes');
    return ok(undefined, 'Paciente removido.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Unifica dois cadastros do mesmo paciente.
 * "criar opc de mesclar clientes" / "Unificar cadastros de pacientes"
 *
 * Todo o historico — agendamentos, atendimentos, exames, documentos e
 * pagamentos — passa para o cadastro escolhido; o duplicado e arquivado.
 */
export async function mergePatients(
  origemId: string,
  destinoId: string,
): Promise<ActionResult<{ destinoId: string }>> {
  try {
    const ctx = await assertPermission('pacientes.editar');
    if (origemId === destinoId) return fail('Selecione dois cadastros diferentes.');

    const supabase = await createClient();
    const { error } = await supabase.rpc('merge_patients', {
      p_source: origemId,
      p_target: destinoId,
    });
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'patients',
      entityId: destinoId,
      patientId: destinoId,
      description: 'Cadastros de paciente unificados',
    });

    revalidatePath('/pacientes');
    revalidatePath(`/pacientes/${destinoId}`);
    revalidatePath(`/pacientes/${origemId}`);
    return ok({ destinoId }, 'Cadastros unificados.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Cadastros que parecem ser da mesma pessoa: mesmo CPF, ou mesmo nome com a
 * mesma data de nascimento. Alimenta a sugestao de unificacao na tela.
 */
export async function findMergeCandidates(
  patientId: string,
): Promise<ActionResult<{ id: string; full_name: string; cpf: string | null; rule: string }[]>> {
  try {
    const ctx = await assertPermission('pacientes.ver');
    const supabase = await createClient();

    const { data: patient } = await supabase
      .from('patients')
      .select('id, full_name, cpf, birth_date')
      .eq('id', patientId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        full_name: string;
        cpf: string | null;
        birth_date: string | null;
      }>();
    if (!patient) return fail('Paciente não encontrado.');

    const duplicados = await findDuplicates(ctx.tenant.id, patient, patientId);
    if (duplicados.length === 0) return ok([]);

    const { data } = await supabase
      .from('patients')
      .select('id, full_name, cpf')
      .in(
        'id',
        duplicados.map((d) => d.id),
      )
      .returns<{ id: string; full_name: string; cpf: string | null }[]>();

    return ok(
      (data ?? []).map((p) => ({
        ...p,
        rule: duplicados.find((d) => d.id === p.id)?.rule ?? 'cpf',
      })),
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Busca rapida usada pelo totem, recepcao e agenda. */
export async function searchPatients(term: string): Promise<Patient[]> {
  const ctx = await assertPermission('pacientes.ver');
  const supabase = await createClient();
  const digits = onlyDigits(term);

  const query = supabase
    .from('patients')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .limit(20);

  const { data } =
    digits.length >= 11
      ? await query.eq('cpf', digits).returns<Patient[]>()
      : await query.ilike('full_name', `%${term}%`).returns<Patient[]>();

  return data ?? [];
}
