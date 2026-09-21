import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { RoomsBoard } from './rooms-board';
import { ExamesForaDaFila } from './fora-da-fila';
import { ExamesSemSala } from './sem-sala';
import { contarNaFila, distribuirExames, NA_FILA } from '@/modules/queue/distribuicao';

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
      // So salas de exame.
      //
      // Os consultorios saem daqui: a fila do medico e chamada na propria
      // tela do medico, onde a fila e de pacientes e nao de exames.
      //
      // As salas de triagem tambem sairam (15/09). Acuidade, Ishihara e
      // fadiga sao feitos na bancada da triagem, e apareciam aqui como se
      // fossem outra etapa -- o paciente saia da triagem, entrava nesta
      // fila e voltava. Agora o examinador preenche tudo na tela de Triagem.
      .eq('kind', 'exame')
      .is('deleted_at', null)
      .order('sort_order')
      .returns<RoomInfo[]>(),
    supabase
      .from('patient_exams')
      .select(
        'id, status, priority, queued_at, called_at, started_at, room_id, exam_type_id, attendance_id, notes, exam_types(name, code, default_room_id, ocupa_sala), exam_results(values, conclusion), attendances!inner(id, checkin_at, stage_code, patients(full_name), queue_tickets(code))',
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

  // Exame de bancada da triagem nao e orfao: ele tem sala, so nao e uma
  // sala desta tela. Sem esta exclusao ele cairia no aviso de "sem sala" e
  // a recepcao seria avisada de um problema que nao existe.
  const { data: salasDeTriagem } = await supabase
    .from('rooms')
    .select('id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('kind', 'triagem')
    .returns<{ id: string }[]>();

  const idsDeTriagem = new Set((salasDeTriagem ?? []).map((s) => s.id));
  const exams = (examsRes.data ?? []).filter((e) => {
    // Consulta clínica e raio X não são feitos em sala daqui. Entravam
    // com sala nula e ficavam presos: nenhum cartão os mostrava e nenhum
    // botão os alcançava. "raio x tambem esta ficando preso sem sala
    // perdido no processo" — Isabella, 18/09.
    if (e.exam_types?.ocupa_sala === false) return false;
    const sala = e.room_id ?? e.exam_types?.default_room_id ?? null;
    return sala === null || !idsDeTriagem.has(sala);
  });

  // Reparte antes de desenhar: o que nao couber em sala nenhuma precisa
  // aparecer em algum lugar, e o numero do topo sai desta mesma conta.
  const distribuicao = distribuirExames(rooms, exams);
  const contagem = contarNaFila(distribuicao);
  const semSala = distribuicao.semSala.filter((e) => NA_FILA.includes(e.status));

  // Quem foi movido manualmente para frente pode ter deixado exames por fazer.
  // Esses exames nao aparecem em fila nenhuma — e preciso avisar.
  const { data: presos } = await supabase
    .from('patient_exams')
    .select(
      'id, attendance_id, exam_types!inner(name, ocupa_sala), attendances!inner(stage_code), patients(full_name)',
    )
    .eq('tenant_id', ctx.tenant.id)
    .in('status', ['pendente', 'em_fila', 'chamado', 'em_andamento'])
    // Raio X e consulta ficam pendentes de propósito — são o registro do
    // que foi pedido, não tarefa de sala. Sem esta exclusão, o paciente
    // que terminou tudo continuava aparecendo como tendo exame pendente.
    .eq('exam_types.ocupa_sala', true)
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
          // Conta o que as salas realmente mostram. Antes contava a fila
          // inteira, inclusive o que nenhum cartao exibia, e o numero do topo
          // nao fechava com a tela -- foi assim que a clinica achou o defeito.
          value={contagem.emSalas}
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

      {semSala.length > 0 && rooms.length > 0 && (
        <div className="mb-4">
          <ExamesSemSala exames={semSala} salas={rooms} />
        </div>
      )}

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
