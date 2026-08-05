'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { CheckCircle2, Delete, Printer, RotateCcw } from 'lucide-react';
import { lookupForCheckin, performCheckin, type TotemLookupResult } from '@/modules/queue/actions';
import { formatCPF, formatDate, formatTime } from '@/lib/format';
import type { Priority, QueueTicket } from '@/types/entities';

type Step = 'cpf' | 'confirma' | 'prioridade' | 'senha' | 'erro';

export function TotemKiosk({
  systemName,
  logoUrl,
  primaryColor,
  totemCode,
  resetSeconds,
  instructions,
  printLabel,
}: {
  systemName: string;
  logoUrl: string | null;
  primaryColor: string;
  totemCode: string | null;
  resetSeconds: number;
  instructions: string | null;
  printLabel: boolean;
}) {
  const [step, setStep] = useState<Step>('cpf');
  const [cpf, setCpf] = useState('');
  const [matches, setMatches] = useState<TotemLookupResult[]>([]);
  const [selected, setSelected] = useState<TotemLookupResult | null>(null);
  const [ticket, setTicket] = useState<QueueTicket | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setStep('cpf');
    setCpf('');
    setMatches([]);
    setSelected(null);
    setTicket(null);
    setMessage(null);
  }, []);

  // Reinicio automatico da tela
  useEffect(() => {
    if (step === 'cpf') return;
    const timer = setTimeout(reset, resetSeconds * 1000);
    return () => clearTimeout(timer);
  }, [step, resetSeconds, reset]);

  const press = (digit: string) => {
    if (cpf.length >= 11) return;
    setCpf((v) => v + digit);
  };

  const search = () => {
    startTransition(async () => {
      const result = await lookupForCheckin(cpf);
      if (!result.ok) {
        setMessage(result.error);
        setStep('erro');
        return;
      }
      const data = result.data ?? [];
      setMatches(data);
      setSelected(data[0] ?? null);
      setStep('confirma');
    });
  };

  const confirm = (priority: Priority) => {
    if (!selected) return;
    startTransition(async () => {
      const result = await performCheckin({
        appointmentId: selected.appointmentId,
        patientId: selected.patientId,
        priority,
        totemCode: totemCode ?? undefined,
      });
      if (!result.ok) {
        setMessage(result.error);
        setStep('erro');
        return;
      }
      setTicket(result.data?.ticket ?? null);
      setMessage(
        result.data?.alreadyCheckedIn
          ? 'Você já havia realizado o check-in hoje. Esta e a sua senha.'
          : null,
      );
      setStep('senha');
      if (printLabel) setTimeout(() => window.print(), 400);
    });
  };

  return (
    <main
      className="kiosk flex min-h-screen flex-col items-center justify-center bg-slate-900 p-6 text-white"
      style={{ ['--brand-primary' as string]: primaryColor }}
    >
      <header className="no-print mb-6 flex flex-col items-center gap-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={systemName} className="h-16 object-contain" />
        ) : (
          <h1 className="text-3xl font-bold">{systemName}</h1>
        )}
      </header>

      {step === 'cpf' && (
        <section className="w-full max-w-md text-center">
          <h2 className="mb-1 text-2xl font-semibold">Bem-vindo</h2>
          <p className="mb-6 text-slate-300">{instructions ?? 'Informe seu CPF para continuar.'}</p>

          <div className="mb-6 rounded-2xl bg-white/10 p-6 font-mono text-3xl tracking-widest">
            {cpf ? formatCPF(cpf.padEnd(11, '_')).replace(/_/g, '•') : '•••.•••.•••-••'}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => press(d)}
                className="rounded-2xl bg-white/10 py-6 text-2xl font-semibold transition hover:bg-white/20"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCpf('')}
              className="rounded-2xl bg-white/5 py-6 text-lg transition hover:bg-white/20"
            >
              <RotateCcw className="mx-auto h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => press('0')}
              className="rounded-2xl bg-white/10 py-6 text-2xl font-semibold transition hover:bg-white/20"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setCpf((v) => v.slice(0, -1))}
              className="rounded-2xl bg-white/5 py-6 transition hover:bg-white/20"
            >
              <Delete className="mx-auto h-6 w-6" />
            </button>
          </div>

          <button
            type="button"
            disabled={cpf.length !== 11 || pending}
            onClick={search}
            className="mt-6 w-full rounded-2xl py-5 text-xl font-semibold disabled:opacity-40"
            style={{ backgroundColor: primaryColor }}
          >
            {pending ? 'Consultando...' : 'Continuar'}
          </button>
        </section>
      )}

      {step === 'confirma' && selected && (
        <section className="w-full max-w-lg text-center">
          <h2 className="mb-4 text-2xl font-semibold">Confirme seus dados</h2>
          <div className="rounded-2xl bg-white/10 p-6 text-left">
            <p className="text-3xl font-bold">{selected.patientName}</p>
            {selected.birthDate && (
              <p className="mt-1 text-slate-300">Nascimento: {formatDate(selected.birthDate)}</p>
            )}
            {selected.companyName && (
              <p className="text-slate-300">Empresa: {selected.companyName}</p>
            )}
            {selected.scheduledAt && (
              <p className="text-slate-300">Horario: {formatTime(selected.scheduledAt)}</p>
            )}
            {selected.exams.length > 0 && (
              <p className="mt-2 text-sm text-slate-400">Exames: {selected.exams.join(', ')}</p>
            )}
            {!selected.appointmentId && (
              <p className="mt-3 rounded-lg bg-amber-500/20 p-2 text-sm text-amber-200">
                Nao encontramos agendamento para hoje. Voce sera atendido como encaixe.
              </p>
            )}
          </div>

          {matches.length > 1 && (
            <div className="mt-3 space-y-2">
              {matches.map((m, i) => (
                <button
                  key={`${m.patientId}-${i}`}
                  type="button"
                  onClick={() => setSelected(m)}
                  className={`w-full rounded-xl p-3 text-left ${m === selected ? 'bg-white/20' : 'bg-white/5'}`}
                >
                  {m.patientName} — {m.scheduledAt ? formatTime(m.scheduledAt) : 'sem horario'}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl bg-white/10 py-5 text-lg font-medium"
            >
              Nao sou eu
            </button>
            <button
              type="button"
              onClick={() => setStep('prioridade')}
              className="rounded-2xl py-5 text-lg font-semibold"
              style={{ backgroundColor: primaryColor }}
            >
              Confirmar
            </button>
          </div>
        </section>
      )}

      {step === 'prioridade' && (
        <section className="w-full max-w-lg text-center">
          <h2 className="mb-2 text-2xl font-semibold">Atendimento prioritário?</h2>
          <p className="mb-6 text-slate-300">
            Idosos, gestantes, lactantes, pessoas com deficiencia ou com crianca de colo.
          </p>
          <div className="grid gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm('prioritario')}
              className="rounded-2xl bg-red-500 py-6 text-xl font-semibold"
            >
              Sim, tenho prioridade
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm(selected?.appointmentId ? 'normal' : 'encaixe')}
              className="rounded-2xl bg-white/10 py-6 text-xl font-semibold"
            >
              Nao, atendimento normal
            </button>
          </div>
        </section>
      )}

      {step === 'senha' && (
        <section className="w-full max-w-md text-center">
          <CheckCircle2 className="no-print mx-auto mb-3 h-14 w-14 text-emerald-400" />
          <h2 className="no-print mb-1 text-xl font-medium">Check-in realizado</h2>
          {message && <p className="no-print mb-3 text-sm text-amber-200">{message}</p>}

          <div className="rounded-3xl bg-white p-8 text-slate-900">
            <p className="text-sm tracking-widest uppercase">{systemName}</p>
            <p className="my-3 text-7xl font-black tracking-tight">{ticket?.code ?? '—'}</p>
            <p className="text-sm">{selected?.patientName}</p>
            {selected?.companyName && (
              <p className="text-xs text-slate-500">{selected.companyName}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {formatDate(new Date())} · {formatTime(new Date())}
            </p>
            <p className="mt-3 text-xs text-slate-600">Aguarde ser chamado na recepção.</p>
          </div>

          <div className="no-print mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-2xl bg-white/10 py-4"
            >
              <Printer className="mx-auto h-5 w-5" />
              Imprimir
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-2xl py-4 font-semibold"
              style={{ backgroundColor: primaryColor }}
            >
              Concluir
            </button>
          </div>
        </section>
      )}

      {step === 'erro' && (
        <section className="w-full max-w-md text-center">
          <div className="rounded-2xl bg-red-500/20 p-6 text-lg text-red-100">{message}</div>
          <button
            type="button"
            onClick={reset}
            className="mt-6 w-full rounded-2xl bg-white/10 py-5 text-lg"
          >
            Tentar novamente
          </button>
        </section>
      )}
    </main>
  );
}
