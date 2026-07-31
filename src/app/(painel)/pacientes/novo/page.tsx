import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { PatientForm } from '@/modules/patients/patient-form';
import { createPatient } from '@/modules/patients/actions';

export const dynamic = 'force-dynamic';

export default async function NovoPacientePage() {
  const ctx = await requirePermission('pacientes.criar');
  const supabase = await createClient();
  const { data } = await supabase
    .from('companies')
    .select('id, legal_name, trade_name')
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .order('legal_name')
    .returns<{ id: string; legal_name: string; trade_name: string | null }[]>();

  const companies = (data ?? []).map((c) => ({ id: c.id, label: c.trade_name ?? c.legal_name }));

  return (
    <div>
      <PageHeader title="Novo paciente" description="Preencha os dados do paciente" />
      <PatientForm action={createPatient} companies={companies} />
    </div>
  );
}
