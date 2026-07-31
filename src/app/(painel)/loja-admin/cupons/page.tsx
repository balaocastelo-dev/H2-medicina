import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  discount_kind: string;
  discount_value: number;
  minimum_amount: number;
  starts_at: string | null;
  ends_at: string | null;
  total_limit: number | null;
  used_count: number;
  is_active: boolean;
}

export default async function CuponsPage() {
  const ctx = await requirePermission('ecommerce.administrar');
  const supabase = await createClient();

  const { data } = await supabase
    .from('coupons')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .order('created_at', { ascending: false })
    .returns<CouponRow[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Cupons e promocoes"
        description="Descontos por valor ou percentual, com limites de uso"
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum cupom" description="Crie cupons para campanhas e parcerias." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Codigo</Th>
                <Th>Desconto</Th>
                <Th>Minimo</Th>
                <Th>Vigencia</Th>
                <Th>Uso</Th>
                <Th>Situacao</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono font-medium">{c.code}</Td>
                  <Td>
                    {c.discount_kind === 'percentual'
                      ? `${c.discount_value}%`
                      : formatMoney(c.discount_value)}
                  </Td>
                  <Td>{formatMoney(c.minimum_amount)}</Td>
                  <Td className="text-slate-500">
                    {formatDate(c.starts_at)} — {formatDate(c.ends_at)}
                  </Td>
                  <Td>
                    {c.used_count}
                    {c.total_limit ? ` / ${c.total_limit}` : ''}
                  </Td>
                  <Td>
                    <Badge color={c.is_active ? '#22C55E' : '#9CA3AF'}>
                      {c.is_active ? 'ativo' : 'inativo'}
                    </Badge>
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
