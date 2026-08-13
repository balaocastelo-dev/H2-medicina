'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, CheckCircle2, Clock, Download, Search, XCircle } from 'lucide-react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/format';
import { consultarReserva, type ReservaConsultada } from '@/modules/scheduling/publico-actions';

const SITUACOES: Record<
  ReservaConsultada['situacao'],
  { rotulo: string; cor: string; icone: typeof Clock; texto: string }
> = {
  a_confirmar: {
    rotulo: 'Aguardando confirmação',
    cor: '#F97316',
    icone: Clock,
    texto: 'Seu horário está reservado. A clínica entrará em contato para confirmar.',
  },
  confirmado: {
    rotulo: 'Confirmado',
    cor: '#22C55E',
    icone: CheckCircle2,
    texto: 'Compareça com 15 minutos de antecedência, com documento com foto.',
  },
  recusado: {
    rotulo: 'Pedido recusado',
    cor: '#EF4444',
    icone: XCircle,
    texto: 'A clínica não pôde atender neste horário. Faça um novo agendamento.',
  },
  cancelado: {
    rotulo: 'Cancelado',
    cor: '#64748B',
    icone: AlertCircle,
    texto: 'Este agendamento foi cancelado.',
  },
};

/** Consulta do agendamento pelo codigo — a unica credencial de quem nao tem login. */
export function ConsultaDeComprovante() {
  const [codigo, setCodigo] = useState('');
  const [reserva, setReserva] = useState<ReservaConsultada | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const consultar = () =>
    startTransition(async () => {
      setErro(null);
      setReserva(null);
      const r = await consultarReserva(codigo);
      if (r.ok && r.data) setReserva(r.data);
      else if (!r.ok) setErro(r.error);
    });

  const situacao = reserva ? SITUACOES[reserva.situacao] : null;
  const Icone = situacao?.icone ?? Clock;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Field label="Código do comprovante" hint="Oito caracteres, como ABCD-2345">
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && codigo.length >= 8 && consultar()}
            placeholder="ABCD-2345"
            className="font-mono tracking-widest uppercase"
            autoCapitalize="characters"
          />
        </Field>
        <Button
          className="mt-3 w-full justify-center"
          loading={pendente}
          disabled={codigo.trim().length < 8}
          onClick={consultar}
        >
          <Search className="h-4 w-4" /> Consultar
        </Button>
      </div>

      {erro && <Alert variant="error">{erro}</Alert>}

      {reserva && situacao && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p
            className="flex items-center gap-2 text-base font-semibold"
            style={{ color: situacao.cor }}
          >
            <Icone className="h-5 w-5" />
            {situacao.rotulo}
          </p>
          <p className="mt-1 text-sm text-slate-600">{situacao.texto}</p>
          {reserva.motivo && (
            <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
              Motivo informado pela clínica: {reserva.motivo}
            </p>
          )}

          <dl className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Paciente</dt>
              <dd className="font-medium text-slate-800">{reserva.nome}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Data</dt>
              <dd className="font-medium text-slate-800">{formatDate(reserva.quando)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Horário</dt>
              <dd className="font-medium text-slate-800">{formatTime(reserva.quando)}</dd>
            </div>
            {reserva.exames.length > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Exames</dt>
                <dd className="max-w-[60%] text-right font-medium text-slate-800">
                  {reserva.exames.join(', ')}
                </dd>
              </div>
            )}
          </dl>

          <a
            href={`/api/public/comprovante/${reserva.codigo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            <Download className="h-4 w-4" /> Baixar comprovante em PDF
          </a>
        </div>
      )}
    </div>
  );
}
