import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { CompanyForm } from '@/modules/companies/company-form';
import { updateCompany } from '@/modules/companies/actions';
import { PainelDeRiscos, type PerfilNaTela } from '@/modules/companies/painel-riscos';
import { PainelDeValores } from '@/modules/companies/painel-valores';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import type { Company } from '@/types/entities';

interface ContratoNaTela {
  id: string;
  name: string;
  code: string | null;
  starts_on: string | null;
  ends_on: string | null;
  credits_total: number | null;
  credits_used: number;
  amount: number | null;
  status: string;
}

export const dynamic = 'force-dynamic';

export default async function EmpresaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission('empresas.ver');
  const supabase = await createClient();

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .maybeSingle<Company>();

  if (!company) notFound();

  const [contactsRes, patientsRes] = await Promise.all([
    supabase
      .from('company_contacts')
      .select('id, name, role, email, phone, allow_marketing')
      .eq('company_id', id)
      .is('deleted_at', null)
      .returns<
        {
          id: string;
          name: string;
          role: string | null;
          email: string | null;
          phone: string | null;
          allow_marketing: boolean;
        }[]
      >(),
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', id)
      .is('deleted_at', null),
  ]);

  // Contrato, valores e riscos ficam na propria empresa: sao a mesma coisa
  // vista de angulos diferentes, e a clinica pediu para parar de procurar
  // em duas telas.
  const [riscosRes, examesRes, precosRes, contratosRes] = await Promise.all([
    supabase
      .from('company_risk_profiles')
      .select('id, cargo, fisicos, quimicos, biologicos, ergonomicos, acidentes')
      .eq('tenant_id', ctx.tenant.id)
      .eq('company_id', id)
      .is('deleted_at', null)
      .order('cargo', { nullsFirst: true })
      .returns<PerfilNaTela[]>(),
    supabase
      .from('exam_types')
      .select('id, name, default_price')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<{ id: string; name: string; default_price: number }[]>(),
    supabase
      .from('company_exam_prices')
      .select('exam_type_id, price')
      .eq('tenant_id', ctx.tenant.id)
      .eq('company_id', id)
      .is('contract_id', null)
      .is('deleted_at', null)
      .returns<{ exam_type_id: string; price: number }[]>(),
    supabase
      .from('company_contracts')
      .select('id, name, code, starts_on, ends_on, credits_total, credits_used, amount, status')
      .eq('tenant_id', ctx.tenant.id)
      .eq('company_id', id)
      .is('deleted_at', null)
      .order('starts_on', { ascending: false })
      .returns<ContratoNaTela[]>(),
  ]);

  const precoPorExame = new Map(
    (precosRes.data ?? []).map((p) => [p.exam_type_id, Number(p.price)]),
  );
  const exames = (examesRes.data ?? []).map((e) => ({
    id: e.id,
    nome: e.name,
    precoPadrao: Number(e.default_price),
    precoNegociado: precoPorExame.get(e.id) ?? null,
  }));

  const podeAdministrar = ctx.permissions.has('empresas.administrar');
  const contratos = contratosRes.data ?? [];

  return (
    <div>
      <PageHeader
        title={company.trade_name ?? company.legal_name}
        description={`Cadastro criado em ${formatDate(company.created_at)}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Colaboradores" value={patientsRes.count ?? 0} />
        <StatCard label="Atendimentos" value={company.employees_served} />
        <StatCard label="Última campanha" value={formatDate(company.last_campaign_at)} />
        <StatCard label="Último atendimento" value={formatDate(company.last_attendance_at)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CompanyForm action={updateCompany.bind(null, id)} company={company} />
        </div>
        <Card className="h-fit">
          <CardHeader title="Contatos" />
          {(contactsRes.data ?? []).length === 0 ? (
            <EmptyState title="Sem contatos" description="Adicione responsaveis pela empresa." />
          ) : (
            <CardBody className="space-y-3">
              {(contactsRes.data ?? []).map((c) => (
                <div key={c.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {[c.role, c.email, c.phone].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <PainelDeValores companyId={id} exames={exames} podeEditar={podeAdministrar} />
        <PainelDeRiscos
          companyId={id}
          perfis={riscosRes.data ?? []}
          podeEditar={podeAdministrar}
        />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Contratos"
            description="Vigência, cota de exames e valor acordado"
            action={
              <Link href="/empresas/contratos" className="text-sm text-slate-500 underline">
                gerenciar contratos
              </Link>
            }
          />
          {contratos.length === 0 ? (
            <EmptyState
              title="Sem contrato cadastrado"
              description="A cobrança usa os valores por exame acima."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Contrato</Th>
                  <Th>Vigência</Th>
                  <Th>Cota</Th>
                  <Th>Valor</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {contratos.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td className="font-medium">
                      {c.name}
                      {c.code && <span className="ml-2 text-xs text-slate-400">{c.code}</span>}
                    </Td>
                    <Td className="text-slate-600">
                      {[formatDate(c.starts_on), formatDate(c.ends_on)].join(' — ')}
                    </Td>
                    <Td className="text-slate-600">
                      {c.credits_total ? `${c.credits_used} / ${c.credits_total}` : '—'}
                    </Td>
                    <Td>{c.amount ? formatMoney(c.amount) : '—'}</Td>
                    <Td>
                      <Badge color={c.status === 'ativo' ? '#22C55E' : '#9CA3AF'}>{c.status}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
