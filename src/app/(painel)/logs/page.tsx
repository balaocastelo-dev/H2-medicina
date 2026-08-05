import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { FilterSelect, Pagination } from '@/components/ui/data-controls';
import { formatDateTime } from '@/lib/format';
import type { AuditLog } from '@/types/entities';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 50;

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; acao?: string; entidade?: string }>;
}) {
  const ctx = await requirePermission('logs.ver');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.pagina ?? 1));
  const supabase = await createClient();

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .eq('tenant_id', ctx.tenant.id);

  if (sp.acao) query = query.eq('action', sp.acao);
  if (sp.entidade) query = query.eq('entity', sp.entidade);

  const { data, count } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<AuditLog[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Logs e auditoria"
        description="Registro append-only de todas as ações sensiveis"
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <FilterSelect
            name="acao"
            label="Acao"
            options={[
              'create',
              'update',
              'delete',
              'view',
              'login',
              'logout',
              'refund',
              'print',
              'send',
            ].map((a) => ({ value: a, label: a }))}
          />
          <FilterSelect
            name="entidade"
            label="Entidade"
            options={[
              'patients',
              'companies',
              'appointments',
              'attendances',
              'triages',
              'patient_exams',
              'medical_consultations',
              'documents',
              'payments',
              'orders',
              'tenant_settings',
              'tenant_branding',
            ].map((e) => ({ value: e, label: e }))}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nenhum registro" description="Nada foi auditado com esses filtros." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Usuário</Th>
                  <Th>Ação</Th>
                  <Th>Entidade</Th>
                  <Th>Descrição</Th>
                  <Th>Origem</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap text-slate-500">
                      {formatDateTime(l.created_at)}
                    </Td>
                    <Td>{l.user_name ?? '—'}</Td>
                    <Td>
                      <Badge
                        color={
                          l.action === 'delete' || l.action === 'refund'
                            ? '#EF4444'
                            : l.action === 'create'
                              ? '#22C55E'
                              : '#0EA5E9'
                        }
                      >
                        {l.action}
                      </Badge>
                    </Td>
                    <Td className="font-mono text-xs">{l.entity}</Td>
                    <Td className="text-slate-600">{l.description ?? '—'}</Td>
                    <Td className="text-xs text-slate-500">
                      {l.is_automatic ? 'automatico' : l.origin}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? rows.length} />
          </>
        )}
      </Card>
    </div>
  );
}
