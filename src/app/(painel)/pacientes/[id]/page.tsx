import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { auditClinicalAccess } from '@/lib/audit';
import { PageHeader } from '@/components/layout/page-header';
import { PatientForm } from '@/modules/patients/patient-form';
import { updatePatient } from '@/modules/patients/actions';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Patient } from '@/types/entities';

export const dynamic = 'force-dynamic';

interface HistoryRow {
  id: string;
  checkin_at: string;
  stage_code: string;
  finished_at: string | null;
}

export default async function PacienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission('pacientes.ver');
  const supabase = await createClient();

  const { data: patient } = await supabase
    .from('patients')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .maybeSingle<Patient>();

  if (!patient) notFound();

  const [companiesRes, historyRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, legal_name, trade_name')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('legal_name')
      .returns<{ id: string; legal_name: string; trade_name: string | null }[]>(),
    supabase
      .from('attendances')
      .select('id, checkin_at, stage_code, finished_at')
      .eq('patient_id', id)
      .order('checkin_at', { ascending: false })
      .limit(20)
      .returns<HistoryRow[]>(),
  ]);

  if (ctx.permissions.has('clinico.ver')) {
    await auditClinicalAccess(ctx, id, 'prontuario');
  }

  const companies = (companiesRes.data ?? []).map((c) => ({
    id: c.id,
    label: c.trade_name ?? c.legal_name,
  }));

  const boundAction = updatePatient.bind(null, id);
  const history = historyRes.data ?? [];

  return (
    <div>
      <PageHeader
        title={patient.full_name}
        description={`Cadastrado em ${formatDate(patient.created_at)} · origem: ${patient.origin}`}
        actions={patient.needs_review ? <Badge color="#F59E0B">Necessita revisão</Badge> : null}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PatientForm action={boundAction} patient={patient} companies={companies} />
        </div>

        <Card className="h-fit">
          <CardHeader title="Histórico de atendimentos" />
          {history.length === 0 ? (
            <EmptyState
              title="Sem atendimentos"
              description="Este paciente ainda não passou pela clínica."
            />
          ) : (
            <CardBody className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <p className="text-sm font-medium">{formatDateTime(h.checkin_at)}</p>
                  <p className="text-xs text-slate-500">
                    {h.finished_at
                      ? `Finalizado em ${formatDateTime(h.finished_at)}`
                      : `Etapa: ${h.stage_code}`}
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
