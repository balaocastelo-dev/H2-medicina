import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { ScraperRun } from '@/types/entities';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  pendente: '#9CA3AF',
  executando: '#3B82F6',
  concluido: '#22C55E',
  concluido_com_erros: '#FB923C',
  erro: '#EF4444',
  cancelado: '#4B5563',
};

export default async function ExecucoesPage() {
  const ctx = await requirePermission('importacoes.executar');
  const supabase = await createClient();

  const { data } = await supabase
    .from('scraper_runs')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<ScraperRun[]>();

  const rows = data ?? [];
  const last = rows[0];

  return (
    <div>
      <PageHeader
        title="Execucoes de importacao"
        description="Historico, contadores e erros por execucao"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ultima execucao" value={formatDateTime(last?.created_at)} />
        <StatCard label="Registros coletados" value={last?.collected_count ?? 0} />
        <StatCard label="Duplicidades" value={last?.duplicates_count ?? 0} color="#FB923C" />
        <StatCard label="Erros" value={last?.error_count ?? 0} color="#EF4444" />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhuma execucao registrada"
            description="Configure um conector e dispare a primeira coleta em modo de teste."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Inicio</Th>
                <Th>Gatilho</Th>
                <Th>Referencia</Th>
                <Th>Coletados</Th>
                <Th>Novos / Atualizados</Th>
                <Th>Erros</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td className="text-slate-600">{formatDateTime(r.started_at ?? r.created_at)}</Td>
                  <Td>{r.trigger}</Td>
                  <Td>{r.reference_date ?? '—'}</Td>
                  <Td className="font-medium">{r.collected_count}</Td>
                  <Td>
                    {r.new_patients + r.new_appointments} /{' '}
                    {r.updated_patients + r.updated_appointments}
                  </Td>
                  <Td>{r.error_count}</Td>
                  <Td>
                    <Badge color={STATUS_COLORS[r.status] ?? '#9CA3AF'}>{r.status}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
