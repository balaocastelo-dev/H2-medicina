'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, PhoneCall, Play, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { elapsedFrom } from '@/lib/format';
import { callNextForRoom, recallTicket, updateExamStatus } from '@/modules/queue/actions';
import { FichaDeExameForm } from '@/modules/clinical/ficha-de-exame';
import type { QueueExam, RoomInfo } from './types';

export function RoomsBoard({ rooms, exams }: { rooms: RoomInfo[]; exams: QueueExam[] }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage({
        ok: result.ok,
        text: result.ok ? (result.message ?? 'Concluido.') : (result.error ?? 'Erro.'),
      });
    });

  const examsForRoom = (room: RoomInfo) =>
    exams.filter((e) => e.room_id === room.id || e.exam_types?.default_room_id === room.id);

  return (
    <div className="space-y-4">
      {message && <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => {
          const roomExams = examsForRoom(room);
          const active = roomExams.find((e) => ['chamado', 'em_andamento'].includes(e.status));
          const queue = roomExams
            .filter((e) => ['pendente', 'em_fila'].includes(e.status))
            // Ordem de chegada, pura. A clinica deixou de usar preferencia.
            .sort((a, b) => {
              return (
                new Date(a.queued_at ?? a.attendances?.checkin_at ?? 0).getTime() -
                new Date(b.queued_at ?? b.attendances?.checkin_at ?? 0).getTime()
              );
            });

          return (
            <Card key={room.id}>
              <CardHeader
                title={room.name}
                description={`${queue.length} na fila`}
                action={
                  <Badge
                    color={
                      room.status === 'disponivel'
                        ? '#22C55E'
                        : room.status === 'ocupada'
                          ? '#3B82F6'
                          : '#9CA3AF'
                    }
                  >
                    {room.status}
                  </Badge>
                }
              />
              <CardBody className="space-y-3">
                {active ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs tracking-wide text-blue-700 uppercase">
                      {active.status === 'chamado' ? 'Chamado' : 'Em atendimento'}
                    </p>
                    <p className="text-lg font-semibold">
                      {active.attendances?.queue_tickets?.[0]?.code ?? '—'} ·{' '}
                      {active.attendances?.patients?.full_name ?? '—'}
                    </p>
                    <p className="text-sm text-slate-600">{active.exam_types?.name}</p>
                    {active.notes && (
                      <p className="mt-1 rounded bg-white/70 p-2 text-xs text-slate-700">
                        <strong>Solicitado:</strong> {active.notes}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {active.status === 'chamado' && (
                        <>
                          <Button
                            size="sm"
                            loading={pending}
                            onClick={() => run(() => updateExamStatus(active.id, 'em_andamento'))}
                          >
                            <Play className="h-4 w-4" /> Iniciar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            loading={pending}
                            onClick={() => run(() => recallTicket(active.attendance_id, room.id))}
                          >
                            <RotateCcw className="h-4 w-4" /> Rechamar
                          </Button>
                        </>
                      )}
                      {active.status === 'em_andamento' && (
                        <Button
                          size="sm"
                          variant="success"
                          loading={pending}
                          onClick={() => run(() => updateExamStatus(active.id, 'concluido'))}
                        >
                          <CheckCircle2 className="h-4 w-4" /> Concluir
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        loading={pending}
                        onClick={() => run(() => updateExamStatus(active.id, 'pendente'))}
                      >
                        Devolver a fila
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={pending}
                        onClick={() => {
                          const reason = window.prompt('Motivo do não comparecimento/realizacao:');
                          if (reason !== null) {
                            run(() => updateExamStatus(active.id, 'nao_realizado', reason));
                          }
                        }}
                      >
                        <XCircle className="h-4 w-4" /> Não realizado
                      </Button>
                    </div>

                    {/* "anexar fichas de cada exame respectivo nas abas para
                        preenchimento manual durante realizacao do examinador" */}
                    <div className="mt-3 rounded-lg bg-white p-3">
                      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        Ficha do exame
                      </p>
                      <FichaDeExameForm
                        key={active.id}
                        patientExamId={active.id}
                        codigoExame={active.exam_types?.code}
                        valoresIniciais={active.exam_results?.[0]?.values ?? {}}
                        conclusaoInicial={active.exam_results?.[0]?.conclusion ?? ''}
                      />
                    </div>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    loading={pending}
                    disabled={queue.length === 0}
                    onClick={() => run(() => callNextForRoom(room.id))}
                  >
                    <PhoneCall className="h-4 w-4" /> Chamar próximo
                  </Button>
                )}

                {queue.length === 0 ? (
                  <EmptyState title="Fila vazia" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {queue.slice(0, 6).map((e) => (
                      <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {e.attendances?.queue_tickets?.[0]?.code ?? '—'} ·{' '}
                            {e.attendances?.patients?.full_name ?? '—'}
                          </p>
                          <p className="text-xs text-slate-500">{e.exam_types?.name}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <p className="text-xs text-slate-500">
                            {elapsedFrom(e.queued_at ?? e.attendances?.checkin_at)}
                          </p>
                          {/* Paciente que foi embora, desistiu ou entrou por
                              engano trava a fila enquanto ninguem o tira. */}
                          <button
                            type="button"
                            disabled={pending}
                            title="Tirar da fila"
                            aria-label={`Tirar ${e.attendances?.patients?.full_name ?? 'paciente'} da fila`}
                            onClick={() => {
                              const nome = e.attendances?.patients?.full_name ?? 'este paciente';
                              if (!window.confirm(`Tirar ${nome} da fila desta sala?`)) return;
                              const motivo =
                                window.prompt('Motivo (ex: desistiu, foi embora):') ?? '';
                              run(() =>
                                updateExamStatus(
                                  e.id,
                                  'nao_realizado',
                                  motivo || 'Removido da fila na recepção',
                                ),
                              );
                            }}
                            className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
