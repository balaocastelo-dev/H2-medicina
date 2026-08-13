import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, EmptyState, StatCard } from '@/components/ui';
import { startOfTodayISO } from '@/lib/format';
import { ORDEM_DA_ESTEIRA, etapaDe } from '@/modules/guide/etapas';
import { MapaDoDia, type LinhaDoMapa } from './mapa';

export const dynamic = 'force-dynamic';

export default async function JornadaPage() {
  const ctx = await requirePermission('agenda.ver');
  const supabase = await createClient();

  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, checkin_at, stage_changed_at, finished_at, origin_kind, priority, patient_id, patients(id, full_name, cpf), companies(trade_name, legal_name), queue_tickets(code)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .gte('checkin_at', startOfTodayISO())
    .order('checkin_at')
    .returns<LinhaDoMapa[]>();

  const linhas = data ?? [];
  const emAndamento = linhas.filter((l) => !etapaDe(l.stage_code).terminal);
  const finalizados = linhas.filter((l) => l.stage_code === 'finalizado');

  // A etapa com mais gente parada é onde a fila está travando hoje.
  const contagem = new Map<string, number>();
  for (const l of emAndamento) contagem.set(l.stage_code, (contagem.get(l.stage_code) ?? 0) + 1);
  const gargalo = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <PageHeader
        title="Onde está cada um"
        description="Todos os pacientes de hoje, agrupados pela etapa em que estão agora"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Na clínica agora" value={emAndamento.length} color="#3B82F6" />
        <StatCard label="Já foram embora" value={finalizados.length} color="#22C55E" />
        <StatCard label="Chegaram hoje" value={linhas.length} />
        <StatCard
          label="Maior fila"
          value={gargalo ? etapaDe(gargalo[0]).rotulo : '—'}
          hint={gargalo ? `${gargalo[1]} paciente(s) parados` : 'nenhuma fila no momento'}
          color="#F97316"
        />
      </div>

      {linhas.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Ninguém passou pela clínica hoje"
              description="Os pacientes aparecem aqui assim que fazem o check-in no totem."
            />
          </CardBody>
        </Card>
      ) : (
        <MapaDoDia linhas={linhas} ordem={ORDEM_DA_ESTEIRA} />
      )}
    </div>
  );
}
