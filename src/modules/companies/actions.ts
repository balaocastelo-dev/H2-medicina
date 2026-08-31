'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { companySchema } from '@/lib/validators';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { Company } from '@/types/entities';

function parseForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  return companySchema.safeParse({
    ...raw,
    allow_marketing: raw.allow_marketing === 'on' || raw.allow_marketing === 'true',
    // Caixa desmarcada nao chega no FormData: ausencia significa "nao emite".
    emite_ficha_clinica: raw.emite_ficha_clinica === 'on' || raw.emite_ficha_clinica === 'true',
    document: raw.document ? String(raw.document) : null,
    email: raw.email ? String(raw.email) : '',
    email_admin: raw.email_admin ? String(raw.email_admin) : '',
    email_financial: raw.email_financial ? String(raw.email_financial) : '',
    email_commercial: raw.email_commercial ? String(raw.email_commercial) : '',
  });
}

export async function createCompany(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Company>> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const parsed = parseForm(formData);
    if (!parsed.success) {
      return fail('Verifique os campos destacados.', z.flattenError(parsed.error).fieldErrors);
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('companies')
      .insert({
        ...parsed.data,
        tenant_id: ctx.tenant.id,
        origin: 'manual',
        consent_at: parsed.data.allow_marketing ? new Date().toISOString() : null,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('*')
      .single<Company>();
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'create',
      entity: 'companies',
      entityId: data.id,
      companyId: data.id,
      description: `Empresa ${data.legal_name} cadastrada`,
      next: data,
    });
    revalidatePath('/empresas');
    return ok(data, 'Empresa cadastrada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function updateCompany(
  id: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Company>> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const parsed = parseForm(formData);
    if (!parsed.success) {
      return fail('Verifique os campos destacados.', z.flattenError(parsed.error).fieldErrors);
    }
    const supabase = await createClient();
    const { data: previous } = await supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .maybeSingle<Company>();

    const { data, error } = await supabase
      .from('companies')
      .update({
        ...parsed.data,
        updated_by: ctx.userId,
        marketing_blocked_at: parsed.data.allow_marketing ? null : new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .select('*')
      .single<Company>();
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'companies',
      entityId: id,
      companyId: id,
      description: `Empresa ${data.legal_name} atualizada`,
      previous,
      next: data,
    });
    revalidatePath('/empresas');
    revalidatePath(`/empresas/${id}`);
    return ok(data, 'Empresa atualizada.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function addCompanyContact(
  companyId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('empresas.administrar');
    const schema = z.object({
      name: z.string().trim().min(2, 'Informe o nome'),
      role: z.string().trim().optional(),
      email: z.string().trim().email('E-mail inválido').or(z.literal('')),
      phone: z.string().trim().optional(),
      allow_marketing: z.boolean().default(false),
    });
    const parsed = schema.safeParse({
      name: formData.get('name'),
      role: formData.get('role') ?? '',
      email: formData.get('email') ?? '',
      phone: formData.get('phone') ?? '',
      allow_marketing: formData.get('allow_marketing') === 'on',
    });
    if (!parsed.success) {
      return fail('Verifique os dados do contato.', z.flattenError(parsed.error).fieldErrors);
    }
    const supabase = await createClient();
    const { error } = await supabase.from('company_contacts').insert({
      tenant_id: ctx.tenant.id,
      company_id: companyId,
      name: parsed.data.name,
      role: parsed.data.role || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      allow_marketing: parsed.data.allow_marketing,
      created_by: ctx.userId,
    });
    if (error) return fail(toFriendlyError(error));
    await audit(ctx, {
      action: 'create',
      entity: 'company_contacts',
      companyId,
      description: `Contato ${parsed.data.name} adicionado`,
    });
    revalidatePath(`/empresas/${companyId}`);
    return ok(undefined, 'Contato adicionado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
