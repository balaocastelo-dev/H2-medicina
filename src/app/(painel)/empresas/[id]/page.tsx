import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { CompanyForm } from '@/modules/companies/company-form';
import { updateCompany } from '@/modules/companies/actions';
import { Card, CardBody, CardHeader, EmptyState, StatCard } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { Company } from '@/types/entities';

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
    </div>
  );
}
