import { requireModulePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { FilterSelect } from '@/components/ui/data-controls';
import { formatDateTime, formatMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  buyer_name: string;
  total: number;
  payment_status: string;
  requires_scheduling: boolean;
  scheduling_done: boolean;
  created_at: string;
  companies: { trade_name: string | null; legal_name: string } | null;
  order_items: { id: string }[];
}

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireModulePermission('ecommerce', 'pedidos.administrar');
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('orders')
    .select(
      'id, order_number, status, buyer_name, total, payment_status, requires_scheduling, scheduling_done, created_at, companies(trade_name, legal_name), order_items(id)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);
  if (sp.status) query = query.eq('status', sp.status);

  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<OrderRow[]>();
  const rows = data ?? [];
  const revenue = rows
    .filter((r) => r.payment_status === 'pago')
    .reduce((s, r) => s + Number(r.total), 0);

  return (
    <div>
      <PageHeader title="Pedidos" description="Compras da loja e agendamentos originados" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pedidos" value={rows.length} />
        <StatCard
          label="Pagos"
          value={rows.filter((r) => r.payment_status === 'pago').length}
          color="#22C55E"
        />
        <StatCard
          label="Agendamento pendente"
          value={rows.filter((r) => r.requires_scheduling && !r.scheduling_done).length}
          color="#FB923C"
        />
        <StatCard label="Faturamento" value={formatMoney(revenue)} color="#0EA5E9" />
      </div>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <FilterSelect
            name="status"
            label="Status"
            options={[
              'aguardando_pagamento',
              'pago',
              'agendamento_pendente',
              'agendado',
              'em_atendimento',
              'concluido',
              'cancelado',
              'reembolsado',
            ].map((s) => ({ value: s, label: s }))}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum pedido" description="Os pedidos da loja aparecem aqui." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th>Comprador</Th>
                <Th>Itens</Th>
                <Th>Total</Th>
                <Th>Pagamento</Th>
                <Th>Status</Th>
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td className="font-mono">{o.order_number}</Td>
                  <Td>
                    {o.buyer_name}
                    {o.companies && (
                      <p className="text-xs text-slate-500">
                        {o.companies.trade_name ?? o.companies.legal_name}
                      </p>
                    )}
                  </Td>
                  <Td>{o.order_items.length}</Td>
                  <Td className="font-medium">{formatMoney(o.total)}</Td>
                  <Td>
                    <Badge color={o.payment_status === 'pago' ? '#22C55E' : '#FB923C'}>
                      {o.payment_status}
                    </Badge>
                  </Td>
                  <Td>{o.status}</Td>
                  <Td className="text-slate-500">{formatDateTime(o.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
