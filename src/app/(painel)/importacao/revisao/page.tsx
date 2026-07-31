import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, Badge, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface ReviewRow {
  id: string;
  status: string;
  action: string;
  match_rule: string | null;
  issues: unknown[];
  scraper_normalized_records: {
    patient_data: Record<string, string | null>;
    company_data: Record<string, string | null>;
    appointment_data: Record<string, string | null>;
    confidence: number;
    is_valid: boolean;
  } | null;
}

export default async function RevisaoPage() {
  const ctx = await requirePermission('importacoes.aprovar');
  const supabase = await createClient();

  const { data } = await supabase
    .from('scraper_import_reviews')
    .select(
      'id, status, action, match_rule, issues, scraper_normalized_records(patient_data, company_data, appointment_data, confidence, is_valid)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'pendente')
    .limit(200)
    .returns<ReviewRow[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Revisao de importacao"
        description="Aprovacao humana antes de sincronizar com pacientes, empresas e agenda"
      />

      <div className="mb-4">
        <Alert variant="info">
          O modo inicial de todo conector e <strong>aprovacao humana</strong>. A importacao e
          idempotente: reexecutar a mesma coleta nao duplica registros.
        </Alert>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Aguardando aprovacao" value={rows.length} color="#FB923C" />
        <StatCard label="Novos" value={rows.filter((r) => r.action === 'criar').length} />
        <StatCard
          label="Atualizacoes"
          value={rows.filter((r) => r.action === 'atualizar').length}
        />
        <StatCard
          label="Com conflito"
          value={rows.filter((r) => (r.issues ?? []).length > 0).length}
          color="#EF4444"
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nada aguardando aprovacao"
            description="Quando uma coleta terminar, a previa aparece aqui para conferencia."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Empresa</Th>
                <Th>Data</Th>
                <Th>Acao</Th>
                <Th>Regra</Th>
                <Th>Confianca</Th>
                <Th>Problemas</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rec = r.scraper_normalized_records;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{rec?.patient_data?.full_name ?? '—'}</Td>
                    <Td className="text-slate-600">{rec?.company_data?.legal_name ?? '—'}</Td>
                    <Td>{rec?.appointment_data?.scheduled_at ?? '—'}</Td>
                    <Td>{r.action}</Td>
                    <Td className="text-xs">{r.match_rule ?? '—'}</Td>
                    <Td>
                      <Badge color={(rec?.confidence ?? 0) >= 80 ? '#22C55E' : '#FB923C'}>
                        {rec?.confidence ?? 0}%
                      </Badge>
                    </Td>
                    <Td className="text-xs text-red-600">{(r.issues ?? []).length || '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
