import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { AppointmentForm } from '@/modules/scheduling/appointment-form';
import { updateAppointment } from '@/modules/scheduling/actions';

export const dynamic = 'force-dynamic';

/** "2026-08-21T17:30:00Z" -> "2026-08-21T14:30", que e o que o campo espera. */
function paraCampoLocal(iso: string): string {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  return partes.replace(' ', 'T');
}

export default async function EditarAgendamentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission('agenda.administrar');
  const { id } = await params;
  const supabase = await createClient();

  const [agendamentoRes, patientsRes, companiesRes, examsRes, profsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        'id, patient_id, company_id, scheduled_at, attendance_kind, priority, professional_id, notes, status, appointment_exams(exam_type_id)',
      )
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{
        id: string;
        patient_id: string;
        company_id: string | null;
        scheduled_at: string;
        attendance_kind: string;
        priority: string;
        professional_id: string | null;
        notes: string | null;
        status: string;
        appointment_exams: { exam_type_id: string }[];
      }>(),
    supabase
      .from('patients')
      .select('id, full_name, cpf, company_id')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('full_name')
      .limit(2000)
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
      .is('deleted_at', null)
      .order('full_name')
      .returns<{ id: string; full_name: string }[]>(),
  ]);

  const agendamento = agendamentoRes.data;
  if (!agendamento) notFound();

  return (
    <div>
      <PageHeader
        title="Editar agendamento"
        description="Corrija paciente, empresa, data ou exames previstos"
      />
      <AppointmentForm
        intervaloMinutos={Number((ctx.settings.agenda as { intervalo_minutos?: number } | undefined)?.intervalo_minutos ?? 10) || 10}
        action={updateAppointment}
        rotuloBotao="Salvar alterações"
        patients={patientsRes.data ?? []}
        companies={(companiesRes.data ?? []).map((c) => ({
          id: c.id,
          label: c.trade_name ?? c.legal_name,
        }))}
        examTypes={examsRes.data ?? []}
        professionals={profsRes.data ?? []}
        iniciais={{
          id: agendamento.id,
          patient_id: agendamento.patient_id,
          company_id: agendamento.company_id,
          scheduled_at: paraCampoLocal(agendamento.scheduled_at),
          attendance_kind: agendamento.attendance_kind,
          priority: agendamento.priority,
          professional_id: agendamento.professional_id,
          exam_type_ids: agendamento.appointment_exams.map((e) => e.exam_type_id),
          notes: agendamento.notes,
        }}
      />
    </div>
  );
}
