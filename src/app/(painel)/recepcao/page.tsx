import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { ReceptionBoard } from './board';

export const dynamic = 'force-dynamic';

export interface ReceptionRow {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  needs_triage: boolean;
  payment_status: string;
  notes: string | null;
  order_id: string | null;
  patients: { id: string; full_name: string; cpf: string | null; job_title: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  patient_exams: { id: string; exam_type_id: string; status: string }[];
}

export default async function RecepcaoPage() {
  const ctx = await requirePermission('recepcao.operar');
  const supabase = await createClient();

  const [rowsRes, examsRes] = await Promise.all([
    supabase
      .from('attendances')
      .select(
        'id, stage_code, priority, checkin_at, needs_triage, payment_status, notes, order_id, patients(id, full_name, cpf, job_title), companies(trade_name, legal_name), queue_tickets(code), patient_exams(id, exam_type_id, status)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .in('stage_code', ['aguardando_recepcao', 'na_recepcao'])
      .is('finished_at', null)
      .is('deleted_at', null)
      .order('checkin_at')
      .returns<ReceptionRow[]>(),
    supabase
      .from('exam_types')
      .select('id, name, code')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<{ id: string; name: string; code: string }[]>(),
  ]);

  const rows = rowsRes.data ?? [];
  const waiting = rows.filter((r) => r.stage_code === 'aguardando_recepcao');
  const inProgress = rows.filter((r) => r.stage_code === 'na_recepcao');

  return (
    <div>
      <PageHeader
        title="Recepcao"
        description="Confirme dados, exames e prioridade antes de liberar o paciente"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Aguardando recepcao" value={waiting.length} color="#FB923C" />
        <StatCard label="Em atendimento" value={inProgress.length} color="#3B82F6" />
        <StatCard label="Total na fila" value={rows.length} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum paciente aguardando"
            description="Os pacientes aparecem aqui logo apos o check-in no totem."
          />
        </Card>
      ) : (
        <ReceptionBoard
          rows={rows}
          examTypes={examsRes.data ?? []}
          canRegisterPayment={ctx.permissions.has('financeiro.registrar')}
        />
      )}
    </div>
  );
}
