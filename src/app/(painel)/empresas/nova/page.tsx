import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { CompanyForm } from '@/modules/companies/company-form';
import { createCompany } from '@/modules/companies/actions';

export default async function NovaEmpresaPage() {
  await requirePermission('empresas.administrar');
  return (
    <div>
      <PageHeader title="Nova empresa" />
      <CompanyForm action={createCompany} />
    </div>
  );
}
