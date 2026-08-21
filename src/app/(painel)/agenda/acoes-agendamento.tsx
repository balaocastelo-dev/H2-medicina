'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Ban, Pencil } from 'lucide-react';
import { Alert, Badge, Button } from '@/components/ui';
import { changeAppointmentStatus } from '@/modules/scheduling/actions';
import type { ActionResult } from '@/lib/action-result';

/**
 * Editar e cancelar direto na linha da agenda.
 *
 * Cancelar nao apaga: o agendamento fica com o motivo, some da lista do dia
 * e continua acessivel pelo filtro de status. Desmarque tem historia — a
 * empresa pergunta depois por que aquele funcionario nao foi atendido.
 */
export function AcoesDoAgendamento({
  appointmentId,
  paciente,
  status,
  jaChegou,
}: {
  appointmentId: string;
  paciente: string;
  status: string;
  /** O paciente ja fez check-in hoje. */
  jaChegou: boolean;
}) {
  const [rodando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const executar = (acao: () => Promise<ActionResult>) =>
    iniciar(async () => {
      const r = await acao();
      setAviso({ ok: r.ok, texto: r.ok ? (r.message ?? 'Feito.') : r.error });
    });

  if (status === 'cancelado') {
    return (
      <div className="flex items-center gap-2">
        <Badge color="#4B5563">cancelado</Badge>
        <button
          type="button"
          disabled={rodando}
          onClick={() => executar(() => changeAppointmentStatus(appointmentId, 'agendado'))}
          className="text-xs text-slate-500 underline hover:text-slate-800"
        >
          reativar
        </button>
      </div>
    );
  }

  // Atendimento em andamento nao se cancela pela agenda: o paciente esta na
  // clinica, e quem resolve isso e a tela de atendimento.
  const emAndamento = ['em_atendimento', 'realizado'].includes(status) || jaChegou;

  return (
    <div className="min-w-40">
      {aviso && (
        <div className="mb-1">
          <Alert variant={aviso.ok ? 'success' : 'error'}>{aviso.texto}</Alert>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        <Link href={`/agenda/${appointmentId}/editar`}>
          <Button size="sm" variant="outline" disabled={emAndamento} title="Editar agendamento">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <Button
          size="sm"
          variant="danger"
          loading={rodando}
          disabled={emAndamento}
          title={
            emAndamento
              ? 'O paciente já chegou — resolva pela tela de atendimento'
              : 'Cancelar agendamento'
          }
          onClick={() => {
            if (!window.confirm(`Cancelar o agendamento de ${paciente}?`)) return;
            const motivo = window.prompt('Motivo do cancelamento (opcional):') ?? undefined;
            executar(() =>
              changeAppointmentStatus(appointmentId, 'cancelado', motivo || 'Cancelado na agenda'),
            );
          }}
        >
          <Ban className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
