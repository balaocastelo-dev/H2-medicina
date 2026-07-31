import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { PatientApp } from './patient-app';
import type { Tenant, TenantBranding } from '@/types/entities';

export const dynamic = 'force-dynamic';

export default async function MeuPage() {
  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
    .maybeSingle<Tenant>();

  const { data: branding } = tenant
    ? await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle<TenantBranding>()
    : { data: null };

  return (
    <PatientApp
      systemName={branding?.system_name ?? tenant?.trade_name ?? 'Portal do Paciente'}
      logoUrl={branding?.logo_url ?? null}
      primaryColor={branding?.color_primary ?? '#0F766E'}
    />
  );
}
