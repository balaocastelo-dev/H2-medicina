import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { TriageWorkspace } from './workspace';

import type { ExameDeBancada, TriageRow } from './types';

export const dynamic = 'force-dynamic';

export default async function TriagemPage() {
  const ctx = await requirePermission('triagem.preencher');
  const supabase = await createClient();

  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, priority, checkin_at, patients(id, full_name, birth_date), companies(trade_name, legal_name), queue_tickets(code), triages(*)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .in('stage_code', ['aguardando_triagem', 'em_triagem'])
    .is('finished_at', null)
    .is('deleted_at', null)
    .order('checkin_at')
    .returns<TriageRow[]>();

  const rows = data ?? [];

  // Salas de triagem, para a chamada sair com o nome certo na TV.
  const { data: salasDeTriagem } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('tenant_id', ctx.tenant.id)
    .eq('kind', 'triagem')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order')
    .returns<{ id: string; name: string }[]>();

  // Exames de bancada destes pacientes: sao feitos aqui mesmo, sem o
  // paciente sair da triagem para entrar numa fila e voltar depois.
  let bancada: ExameDeBancada[] = [];
  if (rows.length > 0) {
    const { data: exames } = await supabase
      .from('patient_exams')
      .select(
        'id, status, attendance_id, exam_types(name, code, rooms:default_room_id(kind)), exam_results(values, conclusion)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .in(
        'attendance_id',
        rows.map((r) => r.id),
      )
      .in('status', ['pendente', 'em_fila', 'chamado', 'em_andamento'])
      .returns<(ExameDeBancada & { exam_types: { rooms: { kind: string } | null } | null })[]>();

    bancada = (exames ?? []).filter((e) => e.exam_types?.rooms?.kind === 'triagem');
  }

  return (
    <div>
      <PageHeader title="Triagem" description="Sinais vitais, alertas e restrições" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Aguardando"
          value={rows.filter((r) => r.stage_code === 'aguardando_triagem').length}
          color="#FB923C"
        />
        <StatCard
          label="Em triagem"
          value={rows.filter((r) => r.stage_code === 'em_triagem').length}
          color="#3B82F6"
        />
        <StatCard label="Total" value={rows.length} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum paciente na triagem"
            description="Os pacientes chegam aqui apos a recepção."
          />
        </Card>
      ) : (
        <TriageWorkspace rows={rows} bancada={bancada} salas={salasDeTriagem ?? []} />
      )}
    </div>
  );
}
