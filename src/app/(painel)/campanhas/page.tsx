import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, Badge, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { EmailCampaign } from '@/types/entities';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  rascunho: '#9CA3AF',
  aguardando_aprovacao: '#FB923C',
  aprovada: '#0EA5E9',
  agendada: '#A855F7',
  enviando: '#3B82F6',
  enviada: '#22C55E',
  cancelada: '#4B5563',
};

export default async function CampanhasPage() {
  const ctx = await requirePermission('campanhas.administrar');
  const supabase = await createClient();

  const [campaignsRes, eligibleRes, unsubRes] = await Promise.all([
    supabase
      .from('email_campaigns')
      .select('*')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .returns<EmailCampaign[]>(),
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenant.id)
      .eq('allow_marketing', true)
      .is('deleted_at', null),
    supabase
      .from('unsubscribe_list')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenant.id),
  ]);

  const rows = campaignsRes.data ?? [];

  return (
    <div>
      <PageHeader
        title="Campanhas comerciais"
        description="Prospeccao para empresas — nunca utiliza dados clinicos de pacientes"
      />

      <div className="mb-4">
        <Alert variant="info" title="Separacao clinica e comercial">
          A audiencia e formada apenas por empresas com autorizacao de comunicacao. Descadastros e
          bloqueios sao sempre respeitados. O modo padrao e <strong>aprovacao humana</strong>.
        </Alert>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Empresas elegiveis" value={eligibleRes.count ?? 0} color="#22C55E" />
        <StatCard label="Descadastros" value={unsubRes.count ?? 0} color="#EF4444" />
        <StatCard label="Campanhas" value={rows.length} />
        <StatCard
          label="Aguardando aprovacao"
          value={rows.filter((r) => r.status === 'aguardando_aprovacao').length}
          color="#FB923C"
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhuma campanha criada"
            description="Gere a primeira campanha a partir de um template; a IA e opcional e configuravel."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campanha</Th>
                <Th>Assunto</Th>
                <Th>Modo</Th>
                <Th>Destinatarios</Th>
                <Th>Enviados</Th>
                <Th>Status</Th>
                <Th>Criada em</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="text-slate-600">{c.subject}</Td>
                  <Td className="text-xs">{c.mode}</Td>
                  <Td>{c.total_recipients}</Td>
                  <Td>
                    {c.sent_count}
                    {c.failed_count > 0 && (
                      <span className="ml-1 text-xs text-red-600">({c.failed_count} falhas)</span>
                    )}
                  </Td>
                  <Td>
                    <Badge color={STATUS_COLORS[c.status] ?? '#9CA3AF'}>{c.status}</Badge>
                  </Td>
                  <Td className="text-slate-500">{formatDateTime(c.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
