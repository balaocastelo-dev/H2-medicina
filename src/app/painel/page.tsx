import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { TvPanel } from './tv-panel';
import { apareceNoPainel, ehPainelValido, type PainelTv } from '@/modules/queue/tv-destino';

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

/**
 * Painel de TV.
 *
 * A clinica tem duas telas em lugares diferentes, entao cada uma tem seu
 * endereco: /painel/recepcao na sala de espera e /painel/salas no corredor.
 * Sem o parametro, /painel abre o da recepcao — e a tela que fica a vista
 * do publico e o destino mais provavel de quem digita o endereco curto.
 */
export default async function PainelPage({
  searchParams,
}: {
  searchParams: Promise<{ tela?: string }>;
}) {
  const ctx = await requirePermission('painel.operar');
  const sp = await searchParams;
  const painel: PainelTv = ehPainelValido(sp.tela) ? sp.tela : 'recepcao';
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
    .limit((limit + 1) * 4)
    .returns<CallRow[]>();

  const chamadas = (data ?? [])
    .filter((c) => apareceNoPainel(c.destination, painel))
    .slice(0, limit + 1);

  return (
    <TvPanel
      tenantId={ctx.tenant.id}
      painel={painel}
      initialCalls={chamadas}
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
