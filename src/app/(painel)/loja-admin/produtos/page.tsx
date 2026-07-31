import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { SearchBox } from '@/components/ui/data-controls';
import { formatMoney } from '@/lib/format';
import type { Product } from '@/types/entities';

export const dynamic = 'force-dynamic';

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requirePermission('produtos.administrar');
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('products')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);
  if (q) query = query.ilike('name', `%${q}%`);

  const { data } = await query.order('sort_order').order('name').returns<Product[]>();
  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Produtos e servicos"
        description="Catalogo da loja: exames, consultas, pacotes e produtos fisicos"
      />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <SearchBox placeholder="Buscar produto" />
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="Catalogo vazio"
            description="Execute o seed do tenant para criar os produtos a partir dos tipos de exame."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th>Tipo</Th>
                <Th>Preco</Th>
                <Th>Promocao</Th>
                <Th>Agendamento</Th>
                <Th>Situacao</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="font-medium">{p.name}</span>
                    {p.is_featured && (
                      <Badge className="ml-2" color="#F59E0B">
                        destaque
                      </Badge>
                    )}
                    <p className="text-xs text-slate-500">{p.short_description}</p>
                  </Td>
                  <Td className="text-slate-600">{p.kind}</Td>
                  <Td className="font-medium">{formatMoney(p.price)}</Td>
                  <Td>{p.promo_price ? formatMoney(p.promo_price) : '—'}</Td>
                  <Td>{p.requires_scheduling ? 'Sim' : 'Nao'}</Td>
                  <Td>
                    <Badge color={p.is_active ? '#22C55E' : '#9CA3AF'}>
                      {p.is_active ? 'ativo' : 'inativo'}
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
