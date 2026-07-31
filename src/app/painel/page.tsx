import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { TvPanel } from './tv-panel';

export const dynamic = 'force-dynamic';

interface CallRow {
  id: string;
  ticket_code: string;
  patient_label: string | null;
  room_name: string | null;
  destination: string | null;
  priority: string;
  is_recall: boolean;
  called_at: string;
}

export default async function PainelPage() {
  const ctx = await requirePermission('painel.operar');
  const supabase = await createClient();

  const settings = (ctx.settings.painel_tv ?? {}) as {
    quantidade_ultimas_chamadas?: number;
    aviso_sonoro?: boolean;
    volume?: number;
    exibir_nome_parcial?: boolean;
  };
  const limit = Number(settings.quantidade_ultimas_chamadas ?? 5);

  const { data } = await supabase
    .from('tv_calls')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .order('called_at', { ascending: false })
    .limit(limit + 1)
    .returns<CallRow[]>();

  return (
    <TvPanel
      tenantId={ctx.tenant.id}
      initialCalls={data ?? []}
      systemName={ctx.branding.system_name}
      logoUrl={ctx.branding.logo_url}
      primaryColor={ctx.branding.color_primary}
      historySize={limit}
      sound={settings.aviso_sonoro !== false}
      volume={Number(settings.volume ?? 0.8)}
      showName={settings.exibir_nome_parcial !== false}
    />
  );
}
