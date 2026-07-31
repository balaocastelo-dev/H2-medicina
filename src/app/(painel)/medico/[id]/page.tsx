import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { auditClinicalAccess } from '@/lib/audit';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { calcAge, formatCPF, formatDate, formatDateTime } from '@/lib/format';
import { ConsultationForm } from '@/modules/clinical/consultation-form';
import type { MedicalConsultation, Triage } from '@/types/entities';

export const dynamic = 'force-dynamic';

interface AttendanceDetail {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  notes: string | null;
  patients: {
    id: string;
    full_name: string;
    cpf: string | null;
    birth_date: string | null;
    gender: string;
    job_title: string | null;
    department: string | null;
  } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  triages: Triage[];
  medical_consultations: MedicalConsultation[];
  patient_exams: {
    id: string;
    status: string;
    finished_at: string | null;
    not_performed_reason: string | null;
    exam_types: { name: string } | null;
    exam_results: {
      conclusion: string | null;
      is_altered: boolean;
      values: Record<string, unknown>;
    }[];
  }[];
}

export default async function MedicoAtendimentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission('medico.atender');
  const supabase = await createClient();

  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, priority, checkin_at, notes, patients(id, full_name, cpf, birth_date, gender, job_title, department), companies(trade_name, legal_name), triages(*), medical_consultations(*), patient_exams(id, status, finished_at, not_performed_reason, exam_types(name), exam_results(conclusion, is_altered, values))',
    )
    .eq('id', id)
    .eq('tenant_id', ctx.tenant.id)
    .maybeSingle<AttendanceDetail>();

  if (!data || !data.patients) notFound();

  await auditClinicalAccess(ctx, data.patients.id, 'prontuario', id);

  const triage = data.triages?.[0];
  const consultation = data.medical_consultations?.[0];

  return (
    <div>
      <PageHeader
        title={data.patients.full_name}
        description={[
          data.patients.cpf ? formatCPF(data.patients.cpf) : null,
          calcAge(data.patients.birth_date) !== null
            ? `${calcAge(data.patients.birth_date)} anos`
            : null,
          data.companies?.trade_name ?? data.companies?.legal_name,
          data.patients.job_title,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={data.priority !== 'normal' ? <Badge color="#EF4444">{data.priority}</Badge> : null}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Triagem" />
            <CardBody className="space-y-1 text-sm">
              {!triage ? (
                <p className="text-slate-500">Sem triagem registrada.</p>
              ) : (
                <>
                  <Row
                    label="PA"
                    value={`${triage.blood_pressure_systolic ?? '—'}/${triage.blood_pressure_diastolic ?? '—'} mmHg`}
                  />
                  <Row label="FC" value={triage.heart_rate ? `${triage.heart_rate} bpm` : '—'} />
                  <Row
                    label="Temperatura"
                    value={triage.temperature_c ? `${triage.temperature_c} C` : '—'}
                  />
                  <Row
                    label="SpO2"
                    value={triage.oxygen_saturation ? `${triage.oxygen_saturation}%` : '—'}
                  />
                  <Row
                    label="Peso / Altura"
                    value={`${triage.weight_kg ?? '—'} kg / ${triage.height_cm ?? '—'} cm`}
                  />
                  <Row label="IMC" value={triage.bmi ? String(triage.bmi) : '—'} />
                  {triage.alerts && (
                    <p className="mt-2 rounded bg-amber-50 p-2 text-amber-800">
                      <strong>Alertas:</strong> {triage.alerts}
                    </p>
                  )}
                  {triage.restrictions && (
                    <p className="mt-1 rounded bg-red-50 p-2 text-red-800">
                      <strong>Restricoes:</strong> {triage.restrictions}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Exames"
              description={`Chegada: ${formatDateTime(data.checkin_at)}`}
            />
            <CardBody className="space-y-2 text-sm">
              {data.patient_exams.length === 0 && <p className="text-slate-500">Sem exames.</p>}
              {data.patient_exams.map((e) => (
                <div key={e.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.exam_types?.name ?? '—'}</span>
                    <Badge
                      color={
                        e.status === 'concluido'
                          ? '#22C55E'
                          : e.status === 'nao_realizado'
                            ? '#EF4444'
                            : '#FB923C'
                      }
                    >
                      {e.status}
                    </Badge>
                  </div>
                  {e.exam_results?.[0]?.conclusion && (
                    <p className="mt-1 text-xs text-slate-600">{e.exam_results[0].conclusion}</p>
                  )}
                  {e.exam_results?.[0]?.is_altered && (
                    <Badge color="#EF4444">resultado alterado</Badge>
                  )}
                  {e.not_performed_reason && (
                    <p className="mt-1 text-xs text-red-600">{e.not_performed_reason}</p>
                  )}
                  {e.finished_at && (
                    <p className="text-[11px] text-slate-400">{formatDate(e.finished_at)}</p>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="xl:col-span-2">
          <ConsultationForm attendanceId={id} consultation={consultation ?? null} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-50 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
