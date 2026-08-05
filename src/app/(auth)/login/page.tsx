import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { LoginForm } from './login-form';
import { FactoryScene } from '@/components/scene/factory-scene';
import type { TenantBranding, Tenant } from '@/types/entities';

/** O login e white label: busca a marca do tenant pelo dominio ou pelo slug padrao. */
async function loadBranding(): Promise<{ tenant: Tenant | null; branding: TenantBranding | null }> {
  try {
    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
      .maybeSingle<Tenant>();
    if (!tenant) return { tenant: null, branding: null };
    const { data: branding } = await supabase
      .from('tenant_branding')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle<TenantBranding>();
    return { tenant, branding };
  } catch {
    return { tenant: null, branding: null };
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await searchParams;
  const { tenant, branding } = await loadBranding();
  const systemName = branding?.system_name ?? tenant?.trade_name ?? 'Plataforma Clínica';

  const cor = branding?.color_primary ?? '#0F766E';

  return (
    <div className="w-full max-w-md">
      {/* Cena de abertura: dá contexto ao sistema antes de pedir a senha. */}
      <div className="mb-5 shadow-lg">
        <FactoryScene cor={cor} />
      </div>

      <div className="mb-6 text-center">
        {branding?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logo_url} alt={systemName} className="mx-auto h-14 object-contain" />
        ) : (
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={{ backgroundColor: cor }}
          >
            {systemName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <h1 className="mt-3 text-xl font-semibold text-slate-900">{systemName}</h1>
        <p className="text-sm text-slate-500">Acesse com suas credenciais</p>
      </div>

      <LoginForm next={proximo} primaryColor={cor} />

      <div className="mt-4 text-center text-sm">
        <Link href="/esqueci-senha" className="text-slate-600 underline-offset-2 hover:underline">
          Esqueci minha senha
        </Link>
      </div>

      {branding?.footer_text && (
        <p className="mt-8 text-center text-xs text-slate-400">{branding.footer_text}</p>
      )}
    </div>
  );
}
