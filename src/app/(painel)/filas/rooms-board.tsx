'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, PhoneCall, Play, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { elapsedFrom } from '@/lib/format';
import { callNextForRoom, recallTicket, updateExamStatus } from '@/modules/queue/actions';
import { FichaDeExameForm } from '@/modules/clinical/ficha-de-exame';
import { gerarLaudoDeExame } from '@/modules/documents/laudo-actions';
import { distribuirExames } from '@/modules/queue/distribuicao';
import type { QueueExam, RoomInfo } from './types';

/** Exames com laudo proprio. Cresce quando outro exame ganhar o seu. */
const TEM_LAUDO = new Set(['AUDIO']);

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

  /**
   * Conclui o exame e, quando ele tem laudo proprio, ja emite o documento.
   *
   * Duas acoes numa so porque o cartao do paciente sai da tela assim que o
   * exame e concluido: um botao de laudo depois disso nunca apareceria. O
   * examinador acabou de preencher a ficha e e quem assina o laudo.
   *
   * Falha na emissao nao desfaz a conclusao: o exame foi feito de verdade,
   * e o laudo pode ser emitido depois pela tela de documentos.
   */
  const concluir = (examId: string, codigo: string | undefined) =>
    startTransition(async () => {
      const conclusao = await updateExamStatus(examId, 'concluido');
      if (!conclusao.ok) {
        setMessage({ ok: false, text: conclusao.error ?? 'Erro.' });
        return;
      }

      if (!TEM_LAUDO.has(codigo ?? '')) {
        setMessage({ ok: true, text: conclusao.message ?? 'Exame concluído.' });
        return;
      }

      const laudo = await gerarLaudoDeExame(examId);
      setMessage({
        ok: laudo.ok,
        text: laudo.ok
          ? 'Exame concluído e laudo emitido.'
          : `Exame concluído, mas o laudo falhou: ${laudo.error}`,
      });
    });

  // Mesma reparticao que a pagina usa para contar. Duas contas diferentes para
  // a mesma pergunta foi o que fez o topo dizer 5 com as salas todas vazias.
  const { porSala } = distribuirExames(rooms, exams);
  const examsForRoom = (room: RoomInfo) => porSala.get(room.id) ?? [];

  return (
    <div className="space-y-4">
      {message && <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => {
          const roomExams = examsForRoom(room);
          // Todos os exames do paciente chamado nesta sala, e nao um so.
          //
          // "se o paciente tem varios exames para fazer em uma sala, ao
          //  chamar ele na primeira vez ja aparecer todas as fichas e nao
          //  precisar chamar a senha varias vezes" -- Isabella, 18/09.
          const ativos = roomExams.filter((e) => ['chamado', 'em_andamento'].includes(e.status));
          const active = ativos[0];
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
                    <p className="text-sm text-slate-600">
                      {ativos.length === 1
                        ? active.exam_types?.name
                        : `${ativos.length} exames nesta sala`}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={pending}
                        onClick={() => run(() => recallTicket(active.attendance_id, room.id))}
                      >
                        <RotateCcw className="h-4 w-4" /> Rechamar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={pending}
                        onClick={() =>
                          run(async () => {
                            // Devolve o paciente inteiro, não um exame só:
                            // deixar metade chamada prende a sala.
                            //
                            // E confere cada um. O laço descartava os
                            // resultados e devolvia `ok: true` fixo: se um
                            // exame falhasse, o paciente ficava metade
                            // chamado e metade na fila — prendendo a sala,
                            // que é exatamente o que este botão existe para
                            // evitar — com mensagem verde na tela.
                            const falhas: string[] = [];
                            for (const e of ativos) {
                              const r = await updateExamStatus(e.id, 'pendente');
                              if (!r.ok) {
                                falhas.push(`${e.exam_types?.name ?? 'Exame'}: ${r.error}`);
                              }
                            }
                            if (falhas.length > 0) {
                              return {
                                ok: false as const,
                                error:
                                  falhas.length === ativos.length
                                    ? falhas[0]!
                                    : `Devolvido em parte — ${falhas.join('; ')}. A sala pode ter ficado ocupada: atualize a tela.`,
                              };
                            }
                            return { ok: true as const, message: 'Devolvido à fila.' };
                          })
                        }
                      >
                        Devolver à fila
                      </Button>
                    </div>

                    {/* Uma ficha por exame, todas na mesma chamada. */}
                    <div className="mt-3 space-y-3">
                      {ativos.map((exame) => (
                        <div key={exame.id} className="rounded-lg bg-white p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                              {exame.exam_types?.name ?? 'Exame'}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {exame.status === 'chamado' && (
                                <Button
                                  size="sm"
                                  loading={pending}
                                  onClick={() => run(() => updateExamStatus(exame.id, 'em_andamento'))}
                                >
                                  <Play className="h-4 w-4" /> Iniciar
                                </Button>
                              )}
                              {exame.status === 'em_andamento' && (
                                <Button
                                  size="sm"
                                  variant="success"
                                  loading={pending}
                                  onClick={() => concluir(exame.id, exame.exam_types?.code)}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  {TEM_LAUDO.has(exame.exam_types?.code ?? '')
                                    ? 'Concluir e emitir laudo'
                                    : 'Concluir'}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="danger"
                                loading={pending}
                                onClick={() => {
                                  const reason = window.prompt(
                                    `Motivo de não realizar ${exame.exam_types?.name ?? 'o exame'}:`,
                                  );
                                  if (reason !== null) {
                                    run(() => updateExamStatus(exame.id, 'nao_realizado', reason));
                                  }
                                }}
                              >
                                <XCircle className="h-4 w-4" /> Não realizado
                              </Button>
                            </div>
                          </div>

                          {exame.notes && (
                            <p className="mb-2 rounded bg-slate-50 p-2 text-xs text-slate-700">
                              <strong>Solicitado:</strong> {exame.notes}
                            </p>
                          )}

                          {/*
                            O exame termina AQUI, na ficha.

                            O botao "Concluir" do alto do cartao continua,
                            para quem nao vai preencher nada. Mas o caminho
                            normal e este: digitou o resultado, acabou.
                            `aoSalvar` recebe se concluiu, para o laudo do
                            exame que tem laudo proprio sair junto — depois de
                            concluido o cartao some da tela, e um botao de
                            laudo ali nunca mais apareceria.
                          */}
                          <FichaDeExameForm
                            key={exame.id}
                            patientExamId={exame.id}
                            codigoExame={exame.exam_types?.code}
                            valoresIniciais={exame.exam_results?.[0]?.values ?? {}}
                            conclusaoInicial={exame.exam_results?.[0]?.conclusion ?? ''}
                            comBotaoConcluir
                            aoSalvar={(concluido) => {
                              if (!concluido) return;
                              const codigo = exame.exam_types?.code ?? '';
                              if (!TEM_LAUDO.has(codigo)) return;
                              startTransition(async () => {
                                const laudo = await gerarLaudoDeExame(exame.id);
                                setMessage({
                                  ok: laudo.ok,
                                  text: laudo.ok
                                    ? 'Exame concluído e laudo emitido.'
                                    : `Exame concluído, mas o laudo falhou: ${laudo.error}`,
                                });
                              });
                            }}
                          />
                        </div>
                      ))}
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
                  // Rolagem propria em vez de `slice(0, 6)`.
                  //
                  // O cabecalho dizia "9 na fila" e a lista mostrava seis. Os
                  // tres ultimos eram inalcancaveis — inclusive pelo botao de
                  // tirar da fila: se o setimo paciente foi embora, ninguem
                  // conseguia remove-lo, e ele seguia contando na fila e nas
                  // bolinhas do menu. Manha de empresa grande passa de seis
                  // com facilidade.
                  <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                    {queue.map((e) => (
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
