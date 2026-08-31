'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

const loginSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido'),
  password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres'),
  next: z.string().optional(),
});

async function logAuthEvent(
  event: string,
  email: string | null,
  userId?: string | null,
  tenantId?: string | null,
) {
  try {
    const supabase = await createClient();
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    await supabase.from('auth_events').insert({
      tenant_id: tenantId ?? null,
      user_id: userId ?? null,
      email,
      event,
      ip_address: forwarded ? forwarded.split(',')[0]?.trim() : null,
      user_agent: h.get('user-agent'),
    });
  } catch {
    /* auditoria de login nunca bloqueia o fluxo */
  }
}

export async function signIn(_prev: unknown, formData: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return fail(
      'Aplicação sem configuração do Supabase. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e refaça o deploy.',
    );
  }

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next'),
  });
  if (!parsed.success) {
    return fail('Verifique os dados informados.', z.flattenError(parsed.error).fieldErrors);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    await logAuthEvent('login_failed', parsed.data.email);
    return fail('E-mail ou senha invalidos.');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, is_active, blocked_at, blocked_reason')
    .eq('id', data.user.id)
    .maybeSingle<{
      id: string;
      tenant_id: string | null;
      is_active: boolean;
      blocked_at: string | null;
      blocked_reason: string | null;
    }>();

  if (!profile || !profile.is_active || profile.blocked_at) {
    await supabase.auth.signOut();
    await logAuthEvent('blocked', parsed.data.email, data.user.id, profile?.tenant_id ?? null);
    return fail(
      profile?.blocked_reason
        ? `Acesso bloqueado: ${profile.blocked_reason}`
        : 'Seu acesso esta inativo. Procure o administrador.',
    );
  }

  await supabase
    .from('profiles')
    .update({ last_sign_in_at: new Date().toISOString() })
    .eq('id', data.user.id);

  await logAuthEvent('login', parsed.data.email, data.user.id, profile.tenant_id);

  const target =
    parsed.data.next && parsed.data.next.startsWith('/') ? parsed.data.next : '/dashboard';
  redirect(target);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await logAuthEvent('logout', user.email ?? null, user.id);
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function requestPasswordReset(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return fail(
      'Aplicação sem configuração do Supabase. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e refaça o deploy.',
    );
  }

  const email = String(formData.get('email') ?? '').trim();
  if (!email || !z.string().email().safeParse(email).success) {
    return fail('Informe um e-mail válido.');
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/redefinir-senha`,
  });
  await logAuthEvent('password_reset_requested', email);
  if (error) return fail(toFriendlyError(error));
  // Resposta neutra: nao revela se o e-mail existe.
  return ok(undefined, 'Se o e-mail estiver cadastrado, enviaremos as instruções em instantes.');
}

export async function updatePassword(_prev: unknown, formData: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) {
    return fail(
      'Aplicação sem configuração do Supabase. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e refaça o deploy.',
    );
  }

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 8) return fail('A senha deve ter ao menos 8 caracteres.');
  if (password !== confirm) return fail('As senhas não conferem.');

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return fail(toFriendlyError(error));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id);
    await logAuthEvent('password_changed', user.email ?? null, user.id);
  }
  return ok(undefined, 'Senha atualizada com sucesso.');
}
