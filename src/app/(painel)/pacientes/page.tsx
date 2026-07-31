import Link from 'next/link';
import { Plus, AlertTriangle } from 'lucide-react';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Button, Card, EmptyState, Table, Td, Th } from '@/components/ui';
import { SearchBox, Pagination } from '@/components/ui/data-controls';
import { calcAge, formatCPF, formatDate, formatPhone } from '@/lib/format';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 20;

interface Row {
  id: string;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  phone: string | null;
  needs_review: boolean;
  created_at: string;
  companies: { trade_name: string | null; legal_name: string } | null;
}

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const ctx = await requirePermission('pacientes.ver');
  const { q, pagina } = await searchParams;
  const page = Math.max(1, Number(pagina ?? 1));
  const supabase = await createClient();

  let query = supabase
    .from('patients')
    .select(
      'id, full_name, cpf, birth_date, phone, needs_review, created_at, companies(trade_name, legal_name)',
      {
        count: 'exact',
      },
    )
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);

  if (q) {
    const digits = q.replace(/\D/g, '');
    query =
      digits.length >= 6 ? query.ilike('cpf', `%${digits}%`) : query.ilike('full_name', `%${q}%`);
  }

  const { data, count } = await query
    .order('full_name')
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<Row[]>();

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Pacientes"
        description="Cadastro unico com deteccao de duplicidade"
        actions={
          ctx.permissions.has('pacientes.criar') && (
            <Link href="/pacientes/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo paciente
              </Button>
            </Link>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchBox placeholder="Buscar por nome ou CPF" />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={q ? 'Nenhum paciente encontrado' : 'Nenhum paciente cadastrado'}
            description={
              q
                ? 'Ajuste os termos da busca ou cadastre um novo paciente.'
                : 'Cadastre manualmente, importe uma planilha ou use um conector de importacao.'
            }
            action={
              ctx.permissions.has('pacientes.criar') && (
                <Link href="/pacientes/novo">
                  <Button size="sm">Cadastrar paciente</Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>CPF</Th>
                  <Th>Idade</Th>
                  <Th>Empresa</Th>
                  <Th>Telefone</Th>
                  <Th>Cadastro</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td>
                      <Link
                        href={`/pacientes/${p.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {p.full_name}
                      </Link>
                      {p.needs_review && (
                        <Badge className="ml-2" color="#F59E0B">
                          <AlertTriangle className="h-3 w-3" /> revisar
                        </Badge>
                      )}
                    </Td>
                    <Td className="font-mono text-xs">{p.cpf ? formatCPF(p.cpf) : '—'}</Td>
                    <Td>{calcAge(p.birth_date) ?? '—'}</Td>
                    <Td className="text-slate-600">
                      {p.companies?.trade_name ?? p.companies?.legal_name ?? '—'}
                    </Td>
                    <Td className="text-slate-600">{p.phone ? formatPhone(p.phone) : '—'}</Td>
                    <Td className="text-slate-500">{formatDate(p.created_at)}</Td>
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
