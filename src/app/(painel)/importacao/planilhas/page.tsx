import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader, Table, Td, Th } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { ROTULO_ORIGEM } from '@/modules/import/planilha';
import { ImportadorPlanilha } from './importador';
import type { OriginKind } from '@/modules/queue/origin-kind';

export const dynamic = 'force-dynamic';

interface Historico {
  id: string;
  file_name: string;
  origin_kind: string | null;
  rows_total: number;
  rows_ok: number;
  rows_error: number;
  status: string;
  created_at: string;
}

export default async function ImportacaoPlanilhasPage() {
  const ctx = await requirePermission('importacoes.aprovar');
  const supabase = await createClient();

  const [companiesRes, examsRes, historicoRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase
      .from('exam_types')
      .select('id, name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from('file_imports')
      .select('id, file_name, origin_kind, rows_total, rows_ok, rows_error, status, created_at')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false })
      .limit(15)
      .returns<Historico[]>(),
  ]);

  const historico = historicoRes.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Importar planilha de agendamentos"
        description="SISPER, Estado e ingresso — cria pacientes e agenda automaticamente"
      />

      <ImportadorPlanilha
        companies={(companiesRes.data ?? []).map((c) => ({
          id: c.id,
          label: c.trade_name ?? c.legal_name,
        }))}
        examTypes={examsRes.data ?? []}
      />

      <Card>
        <CardHeader title="Importações recentes" description="Últimos 15 arquivos processados" />
        <CardBody className="p-0">
          {historico.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nenhuma planilha importada ainda.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Arquivo</Th>
                  <Th>Procedência</Th>
                  <Th>Linhas</Th>
                  <Th>Importadas</Th>
                  <Th>Falhas</Th>
                  <Th>Quando</Th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id}>
                    <Td>{h.file_name}</Td>
                    <Td>
                      {h.origin_kind
                        ? (ROTULO_ORIGEM[h.origin_kind as OriginKind] ?? h.origin_kind)
                        : '—'}
                    </Td>
                    <Td>{h.rows_total}</Td>
                    <Td>{h.rows_ok}</Td>
                    <Td>{h.rows_error > 0 ? h.rows_error : '—'}</Td>
                    <Td>{formatDateTime(h.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
