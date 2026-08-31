'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, RotateCcw, Undo2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import {
  chamarProximoNoConsultorio,
  devolverParaFilaDoMedico,
} from '@/modules/queue/consultorio-actions';
import { recallTicket } from '@/modules/queue/actions';

export interface Consultorio {
  id: string;
  name: string;
  status: string;
  atendimentoId: string | null;
  /** Senha e nome de quem está na sala agora. */
  rotulo: string | null;
}

/**
 * Um cartao por consultorio, todos servindo a mesma fila.
 *
 * "a fila de cliente para o medico deve ir para todas as salas de medicos e
 *  ir atualizando conforme cada sala chama" — chamar em qualquer sala tira o
 *  paciente da fila das outras, porque a fila e uma so.
 *
 * "somente abrir a ficha do cliente na aba modulo medico automaticamente" —
 *  por isso chamar ja navega para a ficha, sem passo intermediario.
 */
export function Consultorios({
  salas,
  aguardando,
}: {
  salas: Consultorio[];
  aguardando: number;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const chamar = (salaId: string) =>
    iniciar(async () => {
      const r = await chamarProximoNoConsultorio(salaId);
      setAviso({ ok: r.ok, texto: r.ok ? (r.message ?? 'Chamado.') : r.error });
      if (r.ok && r.data?.attendanceId) router.push(`/medico/${r.data.attendanceId}`);
    });

  return (
    <div className="mb-4 space-y-3">
      {aviso && <Alert variant={aviso.ok ? 'success' : 'error'}>{aviso.texto}</Alert>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {salas.map((sala) => (
          <Card key={sala.id}>
            <CardHeader
              title={sala.name}
              action={
                <Badge color={sala.atendimentoId ? '#3B82F6' : '#22C55E'}>
                  {sala.atendimentoId ? 'ocupada' : 'livre'}
                </Badge>
              }
            />
            <CardBody className="space-y-2">
              {sala.atendimentoId ? (
                <>
                  <p className="text-sm font-medium">{sala.rotulo ?? 'Em atendimento'}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => router.push(`/medico/${sala.atendimentoId}`)}
                    >
                      Abrir ficha
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={pendente}
                      onClick={() =>
                        iniciar(() => void recallTicket(sala.atendimentoId!, sala.id))
                      }
                    >
                      <RotateCcw className="h-4 w-4" /> Rechamar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={pendente}
                      onClick={() =>
                        iniciar(async () => {
                          await devolverParaFilaDoMedico(sala.atendimentoId!, sala.id);
                          router.refresh();
                        })
                      }
                    >
                      <Undo2 className="h-4 w-4" /> Devolver à fila
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  className="w-full"
                  loading={pendente}
                  disabled={aguardando === 0}
                  onClick={() => chamar(sala.id)}
                >
                  <Megaphone className="h-4 w-4" /> Chamar próximo
                </Button>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
