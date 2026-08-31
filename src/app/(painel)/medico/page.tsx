import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/page-header';
import { AutoRefresh } from '@/components/layout/auto-refresh';
import { Badge, Button, Card, EmptyState, StatCard, Table, Td, Th } from '@/components/ui';
import { elapsedFrom, formatTime } from '@/lib/format';
import { ordenarFilaDoMedico } from '@/modules/queue/fila-do-medico';
import { Consultorios, type Consultorio } from './consultorios';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  stage_changed_at: string;
  current_room_id: string | null;
  patients: { id: string; full_name: string } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  patient_exams: { status: string }[];
}

export default async function MedicoPage() {
  const ctx = await requirePermission('medico.atender');
  const supabase = await createClient();

  const [atendimentosRes, salasRes] = await Promise.all([
    supabase
      .from('attendances')
      .select(
        'id, stage_code, priority, checkin_at, stage_changed_at, current_room_id, patients(id, full_name), companies(trade_name, legal_name), queue_tickets(code), patient_exams(status)',
      )
      .eq('tenant_id', ctx.tenant.id)
      .in('stage_code', ['aguardando_medico', 'em_consulta', 'aguardando_documentos'])
      .is('finished_at', null)
      .is('deleted_at', null)
      .order('checkin_at')
      .returns<Row[]>(),
    supabase
      .from('rooms')
      .select('id, name, status, current_attendance_id')
      .eq('tenant_id', ctx.tenant.id)
      .eq('kind', 'consultorio')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .returns<
        { id: string; name: string; status: string; current_attendance_id: string | null }[]
      >(),
  ]);

  const rows = atendimentosRes.data ?? [];

  // A fila e uma so para todos os consultorios, ordenada por prioridade e
  // depois por chegada — a mesma regra das salas de exame.
  const aguardando = ordenarFilaDoMedico(
    rows.filter((r) => r.stage_code === 'aguardando_medico'),
  );

  const consultorios: Consultorio[] = (salasRes.data ?? []).map((sala) => {
    const atual = rows.find((r) => r.id === sala.current_attendance_id);
    return {
      id: sala.id,
      name: sala.name,
      status: sala.status,
      // A sala so conta como ocupada se o paciente ainda esta em atendimento:
      // um vinculo velho deixaria o botao de chamar sumido para sempre.
      atendimentoId: atual ? sala.current_attendance_id : null,
      rotulo: atual
        ? `${atual.queue_tickets[0]?.code ?? '—'} · ${atual.patients?.full_name ?? ''}`
        : null,
    };
  });

  return (
    <div>
      {/* "ir atualizando conforme cada sala chama": com tres consultorios na
          mesma fila, esperar os 20s do painel deixaria duas salas olhando
          para o mesmo paciente por tempo demais. */}
      <AutoRefresh segundos={6} />

      <PageHeader
        title="Módulo médico"
        description="Fila única para todos os consultórios — chamar abre a ficha do paciente"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Aguardando médico" value={aguardando.length} color="#A855F7" />
        <StatCard
          label="Em consulta"
          value={rows.filter((r) => r.stage_code === 'em_consulta').length}
          color="#3B82F6"
        />
        <StatCard
          label="Aguardando documentos"
          value={rows.filter((r) => r.stage_code === 'aguardando_documentos').length}
          color="#FACC15"
        />
      </div>

      {consultorios.length > 0 && (
        <Consultorios salas={consultorios} aguardando={aguardando.length} />
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum paciente aguardando"
            description="Assim que a triagem ou os exames terminarem, o paciente aparece aqui."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Senha</Th>
                <Th>Paciente</Th>
                <Th>Empresa</Th>
                <Th>Exames</Th>
                <Th>Etapa</Th>
                <Th>Espera</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const feitos = r.patient_exams.filter((e) => e.status === 'concluido').length;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td className="font-mono font-bold">{r.queue_tickets[0]?.code ?? '—'}</Td>
                    <Td className="font-medium">{r.patients?.full_name ?? '—'}</Td>
                    <Td className="text-slate-600">
                      {r.companies?.trade_name ?? r.companies?.legal_name ?? '—'}
                    </Td>
                    <Td>
                      {r.patient_exams.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <Badge color={feitos === r.patient_exams.length ? '#22C55E' : '#FB923C'}>
                          {feitos}/{r.patient_exams.length}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge color={r.stage_code === 'em_consulta' ? '#3B82F6' : '#A855F7'}>
                        {r.stage_code === 'em_consulta' ? 'em consulta' : 'aguardando'}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">
                      {formatTime(r.checkin_at)} · {elapsedFrom(r.checkin_at)}
                    </Td>
                    <Td>
                      <Link href={`/medico/${r.id}`}>
                        <Button size="sm" variant="outline">
                          Abrir ficha
                        </Button>
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
