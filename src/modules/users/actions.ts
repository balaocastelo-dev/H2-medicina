'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

const PAPEIS = ['administrativo', 'medico_examinador', 'atendimento'] as const;

const novoUsuarioSchema = z
  .object({
    full_name: z.string().trim().min(3, 'Informe o nome completo'),
    email: z.string().trim().toLowerCase().email('E-mail invalido'),
    password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
    role_code: z.enum(PAPEIS),
    job_title: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    council_type: z.string().trim().optional(),
    council_number: z.string().trim().optional(),
    council_state: z.string().trim().toUpperCase().optional(),
    treatment: z.string().trim().optional(),
    must_change_password: z.boolean().default(true),
  })
  .refine(
    (d) => d.role_code !== 'medico_examinador' || !!d.council_number,
    { message: 'Informe o numero do conselho do profissional', path: ['council_number'] },
  );

/**
 * Cria o usuario no Supabase Auth e o vincula ao tenant com o papel escolhido.
 *
 * Usa a service role porque criar conta no Auth exige privilegio administrativo —
 * por isso a permissao e conferida antes, e tudo fica registrado na auditoria.
 */
export async function createUser(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('usuarios.administrar');

    const parsed = novoUsuarioSchema.safeParse({
      full_name: formData.get('full_name'),
      email: formData.get('email'),
      password: formData.get('password'),
      role_code: formData.get('role_code'),
      job_title: formData.get('job_title') ?? '',
      phone: formData.get('phone') ?? '',
      council_type: formData.get('council_type') ?? '',
      council_number: formData.get('council_number') ?? '',
      council_state: formData.get('council_state') ?? '',
      treatment: formData.get('treatment') ?? '',
      must_change_password: formData.get('must_change_password') === 'on',
    });

    if (!parsed.success) {
      return fail('Verifique os campos destacados.', z.flattenError(parsed.error).fieldErrors);
    }
    const dados = parsed.data;

    const supabase = await createClient();

    const { data: papel } = await supabase
      .from('roles')
      .select('id, name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('code', dados.role_code)
      .maybeSingle<{ id: string; name: string }>();

    if (!papel) return fail('Papel nao encontrado para esta empresa.');

    const admin = createAdminClient();

    // 1. conta no Auth
    const { data: criado, error: erroAuth } = await admin.auth.admin.createUser({
      email: dados.email,
      password: dados.password,
      email_confirm: true,
      user_metadata: { full_name: dados.full_name, tenant_id: ctx.tenant.id },
    });

    if (erroAuth || !criado.user) {
      const msg = erroAuth?.message ?? '';
      if (/already been registered|already exists/i.test(msg)) {
        return fail('Ja existe uma conta com este e-mail.');
      }
      return fail(`Nao foi possivel criar a conta: ${msg}`);
    }

    const userId = criado.user.id;

    // 2. perfil vinculado ao tenant
    const { error: erroPerfil } = await admin.from('profiles').upsert(
      {
        id: userId,
        tenant_id: ctx.tenant.id,
        full_name: dados.full_name,
        email: dados.email,
        phone: dados.phone || null,
        job_title: dados.job_title || papel.name,
        council_type: dados.council_type || null,
        council_number: dados.council_number || null,
        council_state: dados.council_state || null,
        is_active: true,
        must_change_password: dados.must_change_password,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      },
      { onConflict: 'id' },
    );

    if (erroPerfil) {
      // desfaz a conta orfa para nao deixar lixo no Auth
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return fail(toFriendlyError(erroPerfil));
    }

    // 3. papel
    const { error: erroPapel } = await admin
      .from('user_roles')
      .upsert(
        { user_id: userId, role_id: papel.id, tenant_id: ctx.tenant.id, created_by: ctx.userId },
        { onConflict: 'user_id,role_id' },
      );

    if (erroPapel) return fail(toFriendlyError(erroPapel));

    // 4. como a pessoa quer ser chamada na saudacao de boas-vindas
    if (dados.treatment) {
      const { data: atual } = await admin
        .from('tenant_settings')
        .select('settings')
        .eq('tenant_id', ctx.tenant.id)
        .eq('group_key', 'saudacao')
        .maybeSingle<{ settings: Record<string, unknown> }>();

      const base = (atual?.settings ?? {}) as Record<string, unknown>;
      const tratamentos = { ...((base.tratamentos as Record<string, string>) ?? {}) };
      tratamentos[userId] = dados.treatment;

      await admin.from('tenant_settings').upsert(
        {
          tenant_id: ctx.tenant.id,
          group_key: 'saudacao',
          settings: { ...base, tratamentos },
        },
        { onConflict: 'tenant_id,group_key' },
      );
    }

    await audit(ctx, {
      action: 'create',
      entity: 'profiles',
      entityId: userId,
      description: `Usuario ${dados.full_name} criado como ${papel.name}`,
      next: { email: dados.email, papel: dados.role_code },
    });

    revalidatePath('/usuarios');
    return ok(undefined, `${dados.full_name} pode entrar com o e-mail ${dados.email}.`);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Troca o papel do usuario (substitui o anterior). */
export async function changeUserRole(userId: string, roleCode: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('permissoes.administrar');
    if (!PAPEIS.includes(roleCode as (typeof PAPEIS)[number])) return fail('Papel invalido.');

    const supabase = await createClient();
    const { data: papel } = await supabase
      .from('roles')
      .select('id, name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('code', roleCode)
      .maybeSingle<{ id: string; name: string }>();
    if (!papel) return fail('Papel nao encontrado.');

    await supabase.from('user_roles').delete().eq('user_id', userId).eq('tenant_id', ctx.tenant.id);
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role_id: papel.id, tenant_id: ctx.tenant.id, created_by: ctx.userId });
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'user_roles',
      entityId: userId,
      description: `Papel alterado para ${papel.name}`,
    });
    revalidatePath('/usuarios');
    return ok(undefined, 'Papel atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Bloqueia ou libera o acesso. */
export async function toggleUserBlock(userId: string, bloquear: boolean, motivo?: string) {
  try {
    const ctx = await assertPermission('usuarios.administrar');
    if (userId === ctx.userId) return fail('Voce nao pode bloquear o proprio acesso.');

    const supabase = await createClient();
    const { error } = await supabase
      .from('profiles')
      .update({
        blocked_at: bloquear ? new Date().toISOString() : null,
        blocked_reason: bloquear ? (motivo ?? null) : null,
        is_active: !bloquear,
        updated_by: ctx.userId,
      })
      .eq('id', userId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'profiles',
      entityId: userId,
      description: bloquear ? `Acesso bloqueado: ${motivo ?? 'sem motivo'}` : 'Acesso liberado',
    });
    revalidatePath('/usuarios');
    return ok(undefined, bloquear ? 'Acesso bloqueado.' : 'Acesso liberado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Define uma nova senha para o usuario. */
export async function resetUserPassword(userId: string, novaSenha: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('usuarios.administrar');
    if (novaSenha.length < 8) return fail('A senha deve ter ao menos 8 caracteres.');

    const supabase = await createClient();
    const { data: alvo } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', userId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; full_name: string }>();
    if (!alvo) return fail('Usuario nao encontrado nesta empresa.');

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, { password: novaSenha });
    if (error) return fail(`Nao foi possivel trocar a senha: ${error.message}`);

    await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);

    await audit(ctx, {
      action: 'update',
      entity: 'profiles',
      entityId: userId,
      description: `Senha redefinida para ${alvo.full_name}`,
    });
    revalidatePath('/usuarios');
    return ok(undefined, 'Senha redefinida.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
