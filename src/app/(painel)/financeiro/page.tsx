import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { FilterSelect } from '@/components/ui/data-controls';
import { formatDate, formatMoney } from '@/lib/format';
import { PaymentActions, NewChargeCard } from './client';

import type { PaymentRow } from './types';

export const dynamic = 'force-dynamic';

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePermission('financeiro.ver');
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('payments')
    .select(
      'id, description, amount, discount, net_amount, method, status, due_date, paid_at, created_at, patients(full_name), companies(trade_name, legal_name), pix_charges(payload, qrcode_data_url)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);

  if (sp.status) query = query.eq('status', sp.status);

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<PaymentRow[]>();
  const rows = data ?? [];

  const total = (status: string) =>
    rows.filter((r) => r.status === status).reduce((s, r) => s + Number(r.net_amount), 0);

  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="Cobrancas, Pix com confirmacao manual, estornos e recibos"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Recebido" value={formatMoney(total('pago'))} color="#22C55E" />
        <StatCard label="Pendente" value={formatMoney(total('pendente'))} color="#FB923C" />
        <StatCard label="Estornado" value={formatMoney(total('estornado'))} color="#EF4444" />
        <StatCard label="Lancamentos" value={rows.length} />
      </div>

      {ctx.permissions.has('financeiro.registrar') && (
        <div className="mb-4">
          <NewChargeCard
            hasPixKey={!!(ctx.settings.pagamento as { chave_pix?: string })?.chave_pix}
          />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <FilterSelect
            name="status"
            label="Status"
            options={['pendente', 'pago', 'cancelado', 'estornado', 'em_analise', 'falhou'].map(
              (s) => ({
                value: s,
                label: s,
              }),
            )}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nenhum lancamento" description="Crie a primeira cobranca acima." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Descricao</Th>
                <Th>Cliente</Th>
                <Th>Metodo</Th>
                <Th>Valor</Th>
                <Th>Status</Th>
                <Th>Data</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{p.description ?? '—'}</Td>
                  <Td className="text-slate-600">
                    {p.patients?.full_name ??
                      p.companies?.trade_name ??
                      p.companies?.legal_name ??
                      '—'}
                  </Td>
                  <Td className="text-slate-600">{p.method}</Td>
                  <Td className="font-medium">{formatMoney(p.net_amount)}</Td>
                  <Td>{p.status}</Td>
                  <Td className="text-slate-500">{formatDate(p.paid_at ?? p.created_at)}</Td>
                  <Td>
                    <PaymentActions
                      payment={p}
                      canRegister={ctx.permissions.has('financeiro.registrar')}
                      canRefund={ctx.permissions.has('financeiro.estornar')}
                    />
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
