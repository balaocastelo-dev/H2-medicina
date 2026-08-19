'use client';

import { useState, useTransition } from 'react';
import { CalendarClock, Trash2, UserX } from 'lucide-react';
import { Alert, Badge, Button, Input } from '@/components/ui';
import {
  changeAppointmentStatus,
  excluirAgendamento,
  rescheduleAppointment,
} from '@/modules/scheduling/actions';
import type { ActionResult } from '@/lib/action-result';
import { podeExcluirDaLista, podeMarcarAusente } from '@/modules/scheduling/regras-lista';

/**
 * Ações de cada linha da lista do próximo dia.
 *
 * A lista quase sempre chega importada de fora, e importação errada
 * acontece: sobra quem já avisou que não vem, falta quem pediu outro
 * horário. Sem isso a recepção teria que abrir o agendamento um a um.
 */
export function AcoesDaLinha({
  appointmentId,
  paciente,
  status,
  dataAtual,
  horaAtual,
}: {
  appointmentId: string;
  paciente: string;
  status: string;
  /** AAAA-MM-DD */
  dataAtual: string;
  /** HH:MM */
  horaAtual: string;
}) {
  const [rodando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [remarcando, setRemarcando] = useState(false);
  const [novaData, setNovaData] = useState(dataAtual);
  const [novaHora, setNovaHora] = useState(horaAtual);

  const executar = (acao: () => Promise<ActionResult>) =>
    iniciar(async () => {
      const r = await acao();
      setAviso({ ok: r.ok, texto: r.ok ? (r.message ?? 'Feito.') : r.error });
      if (r.ok) setRemarcando(false);
    });

  if (status === 'ausente') {
    return (
      <div className="flex items-center gap-2">
        <Badge color="#F59E0B">não veio</Badge>
        <button
          type="button"
          disabled={rodando}
          onClick={() => executar(() => changeAppointmentStatus(appointmentId, 'agendado'))}
          className="text-xs text-slate-500 underline hover:text-slate-800"
        >
          desfazer
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-56">
      {aviso && (
        <div className="mb-1">
          <Alert variant={aviso.ok ? 'success' : 'error'}>{aviso.texto}</Alert>
        </div>
      )}

      {remarcando ? (
        <div className="flex flex-wrap items-center gap-1">
          <Input
            type="date"
            value={novaData}
            onChange={(e) => setNovaData(e.target.value)}
            className="h-8 w-36 text-xs"
            aria-label={`Nova data de ${paciente}`}
          />
          <Input
            type="time"
            value={novaHora}
            onChange={(e) => setNovaHora(e.target.value)}
            className="h-8 w-24 text-xs"
            aria-label={`Nova hora de ${paciente}`}
          />
          <Button
            size="sm"
            loading={rodando}
            onClick={() =>
              executar(() =>
                rescheduleAppointment(appointmentId, `${novaData}T${novaHora}:00-03:00`),
              )
            }
          >
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRemarcando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={rodando}
            onClick={() => setRemarcando(true)}
            title="Remarcar para outro dia ou horário"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Reagendar
          </Button>
          {podeMarcarAusente(status) && (
            <Button
              size="sm"
              variant="outline"
              loading={rodando}
              title="Marcar que o paciente não compareceu"
              onClick={() =>
                executar(() => changeAppointmentStatus(appointmentId, 'ausente', 'Não compareceu'))
              }
            >
              <UserX className="h-3.5 w-3.5" /> Não veio
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            loading={rodando}
            disabled={!podeExcluirDaLista(status)}
            title={
              podeExcluirDaLista(status)
                ? 'Tirar da lista'
                : 'Paciente já em atendimento — cancele pela tela de atendimento'
            }
            onClick={() => {
              if (!window.confirm(`Remover ${paciente} da lista do dia?`)) return;
              const motivo = window.prompt('Motivo (opcional):') ?? undefined;
              executar(() => excluirAgendamento(appointmentId, motivo || undefined));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
