import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { RoomsBoard } from './rooms-board';
import { ExamesForaDaFila } from './fora-da-fila';

import type { QueueExam, RoomInfo } from './types';

export const dynamic = 'force-dynamic';

export default async function FilasPage() {
  const ctx = await requirePermission('filas.operar');
  const supabase = await createClient();

  const [roomsRes, examsRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, name, code, kind, status, current_attendance_id')
      .eq('tenant_id', ctx.tenant.id)
      .eq('is_active', true)
      .in('kind', ['exame', 'consultorio', 'triagem'])
      .is('deleted_at', null)
      .order('sort_order')
      .returns<RoomInfo[]>(),
    supabase
      .from('patient_exams')
      .select(
        'id, status, priority, queued_at, called_at, started_at, room_id, exam_type_id, attendance_id, notes, exam_types(name, code, default_room_id), exam_results(values, conclusion), attendances!inner(id, checkin_at, stage_code, patients(full_name), queue_tickets(code))',
      )
      .eq('tenant_id', ctx.tenant.id)
      .in('status', ['pendente', 'em_fila', 'chamado', 'em_andamento'])
      // Mesma condicao da RPC que chama o proximo: se a tela mostrasse alguem
      // fora dessas etapas, o botao prometeria uma chamada que o servidor nega.
      .in('attendances.stage_code', ['aguardando_exames', 'em_exames'])
      .order('queued_at', { ascending: true, nullsFirst: false })
      .returns<QueueExam[]>(),
  ]);

  const rooms = roomsRes.data ?? [];
  const exams = examsRes.data ?? [];

  // Quem foi movido manualmente para frente pode ter deixado exames por fazer.
  // Esses exames nao aparecem em fila nenhuma — e preciso avisar.
  const { data: presos } = await supabase
    .from('patient_exams')
    .select('id, attendance_id, exam_types(name), attendances!inner(stage_code), patients(full_name)')
    .eq('tenant_id', ctx.tenant.id)
    .in('status', ['pendente', 'em_fila', 'chamado', 'em_andamento'])
    .not('attendances.stage_code', 'in', '("aguardando_exames","em_exames")')
    .not('attendances.stage_code', 'in', '("finalizado","cancelado","ausente")')
    .returns<
      {
        id: string;
        attendance_id: string;
        exam_types: { name: string } | null;
        attendances: { stage_code: string } | null;
        patients: { full_name: string } | null;
      }[]
    >();

  const foraDaFila = new Map<
    string,
    { nome: string; etapa: string; exames: string[] }
  >();
  for (const e of presos ?? []) {
    const atual = foraDaFila.get(e.attendance_id) ?? {
      nome: e.patients?.full_name ?? 'Paciente',
      etapa: e.attendances?.stage_code ?? '',
      exames: [],
    };
    if (e.exam_types?.name) atual.exames.push(e.exam_types.name);
    foraDaFila.set(e.attendance_id, atual);
  }

  return (
    <div>
      <PageHeader
        title="Filas e salas"
        description="Atendimento cruzado: o próximo paciente e escolhido por prioridade e tempo de espera"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Salas ativas" value={rooms.length} />
        <StatCard
          label="Exames na fila"
          value={exams.filter((e) => ['pendente', 'em_fila'].includes(e.status)).length}
          color="#FB923C"
        />
        <StatCard
          label="Em execução"
          value={exams.filter((e) => e.status === 'em_andamento').length}
          color="#3B82F6"
        />
        <StatCard
          label="Chamados"
          value={exams.filter((e) => e.status === 'chamado').length}
          color="#FACC15"
        />
      </div>

      {foraDaFila.size > 0 && (
        <div className="mb-4">
          <ExamesForaDaFila itens={Array.from(foraDaFila.entries())} />
        </div>
      )}

      {rooms.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma sala cadastrada"
            description="Cadastre salas e vincule os tipos de exame para operar as filas."
          />
        </Card>
      ) : (
        <RoomsBoard rooms={rooms} exams={exams} />
      )}
    </div>
  );
}
