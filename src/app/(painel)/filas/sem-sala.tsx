'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { atribuirSalaAoExame } from '@/modules/queue/actions';
import { elapsedFrom } from '@/lib/format';
import type { QueueExam, RoomInfo } from './types';

/**
 * Exames em fila que nao pertencem a nenhuma sala da tela.
 *
 * A clinica viu isto em 13/09: o topo dizia "5 exames na fila" e todas as
 * salas diziam "fila vazia". Os cinco pacientes estavam na clinica esperando,
 * e nenhum botao da tela conseguia chama-los.
 *
 * Acontece quando o tipo de exame nao tem sala padrao cadastrada. Aqui eles
 * aparecem com nome, exame e tempo de espera, e o examinador manda cada um
 * para a sala certa sem sair da tela.
 */
export function ExamesSemSala({
  exames,
  salas,
}: {
  exames: QueueExam[];
  salas: RoomInfo[];
}) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [pendente, startTransition] = useTransition();

  const primeira = salas[0]?.id ?? '';

  const enviar = (exame: QueueExam) => {
    const roomId = escolha[exame.id] ?? primeira;
    if (!roomId) return;
    startTransition(async () => {
      const r = await atribuirSalaAoExame(exame.id, roomId);
      setMsg({ ok: r.ok, texto: r.ok ? (r.message ?? 'Enviado.') : r.error });
    });
  };

  const tiposSemSala = Array.from(
    new Set(exames.map((e) => e.exam_types?.name).filter(Boolean) as string[]),
  );

  return (
    <Card className="border-amber-300">
      <CardHeader
        title="Exames esperando sem sala"
        description="Estes pacientes estão na fila, mas o exame deles não está ligado a nenhuma sala — por isso não aparecem em nenhum cartão abaixo"
        action={<AlertTriangle className="h-5 w-5 text-amber-500" />}
      />
      <CardBody className="space-y-3">
        {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.texto}</Alert>}

        {exames.map((exame) => (
          <div
            key={exame.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {exame.attendances?.patients?.full_name ?? 'Paciente'}
              </p>
              <p className="text-xs text-slate-500">
                {exame.exam_types?.name ?? 'Exame'}
                {' · esperando há '}
                {elapsedFrom(exame.queued_at ?? exame.attendances?.checkin_at ?? null)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={escolha[exame.id] ?? primeira}
                onChange={(e) => setEscolha((s) => ({ ...s, [exame.id]: e.target.value }))}
                aria-label={`Sala para ${exame.attendances?.patients?.full_name ?? 'o paciente'}`}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
              >
                {salas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" loading={pendente} onClick={() => enviar(exame)}>
                <Send className="h-4 w-4" /> Enviar
              </Button>
            </div>
          </div>
        ))}

        {tiposSemSala.length > 0 && (
          <p className="text-xs text-slate-500">
            Para não se repetir amanhã, cadastre a sala padrão destes exames em Configurações:{' '}
            <strong>{tiposSemSala.join(', ')}</strong>.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
