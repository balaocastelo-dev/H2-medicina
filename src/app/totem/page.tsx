import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { TotemKiosk } from './kiosk';
import type { TenantBranding } from '@/types/entities';

export const dynamic = 'force-dynamic';

export default async function TotemPage() {
  const ctx = await requirePermission('totem.operar');
  const supabase = await createClient();

  const { data: totems } = await supabase
    .from('totems')
    .select('code, name')
    .eq('tenant_id', ctx.tenant.id)
    .eq('is_active', true)
    .returns<{ code: string; name: string }[]>();

  const settings = (ctx.settings.totem ?? {}) as {
    tempo_reinicio_segundos?: number;
    instrucoes?: string;
    mostrar_instrucoes?: boolean;
    imprimir_etiqueta?: boolean;
  };

  const branding: TenantBranding = ctx.branding;

  return (
    <TotemKiosk
      systemName={branding.system_name}
      logoUrl={branding.logo_url}
      primaryColor={branding.color_primary}
      totemCode={totems?.[0]?.code ?? null}
      resetSeconds={Number(settings.tempo_reinicio_segundos ?? 45)}
      instructions={settings.mostrar_instrucoes === false ? null : (settings.instrucoes ?? null)}
      printLabel={settings.imprimir_etiqueta !== false}
    />
  );
}
