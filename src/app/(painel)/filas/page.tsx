import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { RoomsBoard } from './rooms-board';

export const dynamic = 'force-dynamic';

export interface QueueExam {
  id: string;
  status: string;
  priority: string;
  queued_at: string | null;
  called_at: string | null;
  started_at: string | null;
  room_id: string | null;
  exam_type_id: string;
  attendance_id: string;
  exam_types: { name: string; code: string; default_room_id: string | null } | null;
  attendances: {
    id: string;
    checkin_at: string;
    stage_code: string;
    patients: { full_name: string } | null;
    queue_tickets: { code: string }[];
  } | null;
}

export interface RoomInfo {
  id: string;
  name: string;
  code: string;
  kind: string;
  status: string;
  current_attendance_id: string | null;
}

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
        'id, status, priority, queued_at, called_at, started_at, room_id, exam_type_id, attendance_id, exam_types(name, code, default_room_id), attendances!inner(id, checkin_at, stage_code, patients(full_name), queue_tickets(code))',
      )
      .eq('tenant_id', ctx.tenant.id)
      .in('status', ['pendente', 'em_fila', 'chamado', 'em_andamento'])
      .order('queued_at', { ascending: true, nullsFirst: false })
      .returns<QueueExam[]>(),
  ]);

  const rooms = roomsRes.data ?? [];
  const exams = examsRes.data ?? [];

  return (
    <div>
      <PageHeader
        title="Filas e salas"
        description="Atendimento cruzado: o proximo paciente e escolhido por prioridade e tempo de espera"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Salas ativas" value={rooms.length} />
        <StatCard
          label="Exames na fila"
          value={exams.filter((e) => ['pendente', 'em_fila'].includes(e.status)).length}
          color="#FB923C"
        />
        <StatCard
          label="Em execucao"
          value={exams.filter((e) => e.status === 'em_andamento').length}
          color="#3B82F6"
        />
        <StatCard
          label="Chamados"
          value={exams.filter((e) => e.status === 'chamado').length}
          color="#FACC15"
        />
      </div>

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
