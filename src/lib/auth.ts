import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type {
  Profile,
  Tenant,
  TenantBranding,
  TenantModule,
  TenantSetting,
} from '@/types/entities';

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: Profile;
  tenant: Tenant;
  branding: TenantBranding;
  permissions: Set<string>;
  modules: Set<string>;
  settings: Record<string, Record<string, unknown>>;
  roles: string[];
}

/** Carrega o contexto completo do usuario autenticado (1x por request). */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<Profile>();

  if (!profile || !profile.is_active || profile.blocked_at || !profile.tenant_id) return null;

  const [tenantRes, brandingRes, settingsRes, modulesRes, rolesRes, userPermsRes] =
    await Promise.all([
      supabase.from('tenants').select('*').eq('id', profile.tenant_id).maybeSingle<Tenant>(),
      supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle<TenantBranding>(),
      supabase
        .from('tenant_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .returns<TenantSetting[]>(),
      supabase
        .from('tenant_modules')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .returns<TenantModule[]>(),
      supabase
        .from('user_roles')
        .select('role_id, roles!inner(id, code, name)')
        .eq('user_id', user.id)
        .returns<{ role_id: string; roles: { id: string; code: string; name: string } }[]>(),
      supabase
        .from('user_permissions')
        .select('permission_code, is_granted')
        .eq('user_id', user.id)
        .returns<{ permission_code: string; is_granted: boolean }[]>(),
    ]);

  const tenant = tenantRes.data;
  if (!tenant) return null;

  const roleIds = (rolesRes.data ?? []).map((r) => r.role_id);
  let permissions = new Set<string>();

  if (roleIds.length > 0) {
    const { data: rolePerms } = await supabase
      .from('role_permissions')
      .select('permission_code')
      .in('role_id', roleIds)
      .returns<{ permission_code: string }[]>();
    permissions = new Set((rolePerms ?? []).map((p) => p.permission_code));
  }

  for (const up of userPermsRes.data ?? []) {
    if (up.is_granted) permissions.add(up.permission_code);
    else permissions.delete(up.permission_code);
  }

  if (profile.is_platform_admin) {
    const { data: all } = await supabase
      .from('permissions')
      .select('code')
      .returns<{ code: string }[]>();
    permissions = new Set((all ?? []).map((p) => p.code));
  }

  const settings: Record<string, Record<string, unknown>> = {};
  for (const s of settingsRes.data ?? []) {
    settings[s.group_key] = s.settings ?? {};
  }

  const branding: TenantBranding = brandingRes.data ?? {
    tenant_id: tenant.id,
    system_name: tenant.trade_name,
    logo_url: null,
    logo_compact_url: null,
    favicon_url: null,
    color_primary: '#0F766E',
    color_secondary: '#0EA5E9',
    color_accent: '#F59E0B',
    color_sidebar: '#0B1220',
    footer_text: null,
    pdf_header_html: null,
    pdf_footer_html: null,
    login_background_url: null,
    status_colors: {},
  };

  return {
    userId: user.id,
    email: user.email ?? profile.email,
    profile,
    tenant,
    branding,
    permissions,
    modules: new Set((modulesRes.data ?? []).filter((m) => m.is_enabled).map((m) => m.module_key)),
    settings,
    roles: (rolesRes.data ?? []).map((r) => r.roles?.code).filter(Boolean) as string[],
  };
});

/** Exige sessao valida; redireciona para o login caso contrario. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/** Exige uma permissao especifica. */
export async function requirePermission(permission: string): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!ctx.permissions.has(permission)) {
    redirect(`/sem-permissao?p=${encodeURIComponent(permission)}`);
  }
  return ctx;
}

export function can(ctx: SessionContext | null, permission: string): boolean {
  return !!ctx?.permissions.has(permission);
}

export function canAny(ctx: SessionContext | null, permissions: string[]): boolean {
  return permissions.some((p) => can(ctx, p));
}

/** Erro de permissao para uso dentro de Server Actions. */
export class PermissionError extends Error {
  constructor(permission: string) {
    super(`Sem permissao: ${permission}`);
    this.name = 'PermissionError';
  }
}

/** Versao de requirePermission para Server Actions (lanca em vez de redirecionar). */
export async function assertPermission(permission: string): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new PermissionError('sessao');
  if (!ctx.permissions.has(permission)) throw new PermissionError(permission);
  return ctx;
}
