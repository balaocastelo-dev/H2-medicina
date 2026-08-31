import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { AppointmentForm } from '@/modules/scheduling/appointment-form';
import { createAppointment } from '@/modules/scheduling/actions';

export const dynamic = 'force-dynamic';

export default async function NovoAgendamentoPage() {
  const ctx = await requirePermission('agenda.administrar');
  const supabase = await createClient();

  const [patientsRes, companiesRes, examsRes, profsRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, full_name, cpf, company_id')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('full_name')
      .limit(500)
      .returns<
        { id: string; full_name: string; cpf: string | null; company_id: string | null }[]
      >(),
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase
      .from('exam_types')
      .select('id, name, code, average_minutes')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<{ id: string; name: string; code: string; average_minutes: number }[]>(),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .order('full_name')
      .returns<{ id: string; full_name: string }[]>(),
  ]);

  return (
    <div>
      <PageHeader
        title="Novo agendamento"
        description="Vincule paciente, empresa e exames previstos"
      />
      <AppointmentForm
        intervaloMinutos={Number((ctx.settings.agenda as { intervalo_minutos?: number } | undefined)?.intervalo_minutos ?? 10) || 10}
        action={createAppointment}
        patients={patientsRes.data ?? []}
        companies={(companiesRes.data ?? []).map((c) => ({
          id: c.id,
          label: c.trade_name ?? c.legal_name,
        }))}
        examTypes={examsRes.data ?? []}
        professionals={profsRes.data ?? []}
      />
    </div>
  );
}
