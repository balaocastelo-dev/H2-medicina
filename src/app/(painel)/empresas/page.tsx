import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Button, Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { SearchBox, Pagination, FilterSelect } from '@/components/ui/data-controls';
import { formatCNPJ, formatDate, formatPhone } from '@/lib/format';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;

interface Row {
  id: string;
  legal_name: string;
  trade_name: string | null;
  document: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  situation: string;
  allow_marketing: boolean;
  employees_served: number;
  last_attendance_at: string | null;
}

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; situacao?: string }>;
}) {
  const ctx = await requirePermission('empresas.ver');
  const { q, pagina, situacao } = await searchParams;
  const page = Math.max(1, Number(pagina ?? 1));
  const supabase = await createClient();

  let query = supabase
    .from('companies')
    .select(
      'id, legal_name, trade_name, document, city, state, phone, situation, allow_marketing, employees_served, last_attendance_at',
      { count: 'exact' },
    )
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);

  if (q) query = query.ilike('legal_name', `%${q}%`);
  if (situacao) query = query.eq('situation', situacao);

  const { data, count } = await query
    .order('legal_name')
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<Row[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Empresas"
        description="Base de empresas clientes e prospeccao"
        actions={
          ctx.permissions.has('empresas.administrar') && (
            <Link href="/empresas/nova">
              <Button>
                <Plus className="h-4 w-4" /> Nova empresa
              </Button>
            </Link>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchBox placeholder="Buscar por razao social" />
          <FilterSelect
            name="situacao"
            label="Situacao"
            options={[
              { value: 'ativa', label: 'Ativa' },
              { value: 'prospect', label: 'Prospect' },
              { value: 'inativa', label: 'Inativa' },
              { value: 'bloqueada', label: 'Bloqueada' },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nenhuma empresa encontrada"
            description="Cadastre empresas manualmente ou deixe que a importação crie automaticamente."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Empresa</Th>
                  <Th>CNPJ</Th>
                  <Th>Cidade</Th>
                  <Th>Telefone</Th>
                  <Th>Situação</Th>
                  <Th>Comunicacao</Th>
                  <Th>Último atendimento</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/empresas/${c.id}`} className="font-medium hover:underline">
                        {c.trade_name ?? c.legal_name}
                      </Link>
                      {c.trade_name && <p className="text-xs text-slate-500">{c.legal_name}</p>}
                    </Td>
                    <Td className="font-mono text-xs">
                      {c.document ? formatCNPJ(c.document) : '—'}
                    </Td>
                    <Td className="text-slate-600">
                      {c.city ? `${c.city}${c.state ? `/${c.state}` : ''}` : '—'}
                    </Td>
                    <Td className="text-slate-600">{c.phone ? formatPhone(c.phone) : '—'}</Td>
                    <Td>
                      <Badge
                        color={
                          c.situation === 'ativa'
                            ? '#22C55E'
                            : c.situation === 'bloqueada'
                              ? '#EF4444'
                              : '#9CA3AF'
                        }
                      >
                        {c.situation}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge color={c.allow_marketing ? '#0EA5E9' : '#9CA3AF'}>
                        {c.allow_marketing ? 'autorizada' : 'bloqueada'}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">{formatDate(c.last_attendance_at)}</Td>
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
