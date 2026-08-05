import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { TriageWorkspace } from './workspace';

import type { TriageRow } from './types';

export const dynamic = 'force-dynamic';

export default async function TriagemPage() {
  const ctx = await requirePermission('triagem.preencher');
  const supabase = await createClient();

  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, priority, checkin_at, patients(id, full_name, birth_date), companies(trade_name, legal_name), queue_tickets(code), triages(*)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .in('stage_code', ['aguardando_triagem', 'em_triagem'])
    .is('finished_at', null)
    .is('deleted_at', null)
    .order('checkin_at')
    .returns<TriageRow[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader title="Triagem" description="Sinais vitais, alertas e restrições" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Aguardando"
          value={rows.filter((r) => r.stage_code === 'aguardando_triagem').length}
          color="#FB923C"
        />
        <StatCard
          label="Em triagem"
          value={rows.filter((r) => r.stage_code === 'em_triagem').length}
          color="#3B82F6"
        />
        <StatCard label="Total" value={rows.length} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum paciente na triagem"
            description="Os pacientes chegam aqui apos a recepção."
          />
        </Card>
      ) : (
        <TriageWorkspace rows={rows} />
      )}
    </div>
  );
}
