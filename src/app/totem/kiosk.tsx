'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import { CheckCircle2, Delete, Printer, RotateCcw, Search, UserSearch } from 'lucide-react';
import {
  buscarAgendamentoPorNome,
  lookupForCheckin,
  lookupPorPaciente,
  performCheckin,
  type TotemLookupResult,
} from '@/modules/queue/actions';
import {
  MINIMO_LETRAS,
  nomeAbreviado,
  termoValido,
  type SugestaoBusca,
} from '@/modules/queue/busca-nome';
import { formatCPF, formatDate, formatTime } from '@/lib/format';
import type { Priority, QueueTicket } from '@/types/entities';

type Step = 'cpf' | 'nome' | 'confirma' | 'prioridade' | 'senha' | 'erro';

const TECLADO = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

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
  const [nome, setNome] = useState('');
  const [sugestoes, setSugestoes] = useState<SugestaoBusca[] | null>(null);
  // Quem chegou pela busca por nome nao provou identidade: a tela publica
  // continua mostrando so o nome abreviado, sem data de nascimento.
  const [viaBusca, setViaBusca] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setStep('cpf');
    setCpf('');
    setNome('');
    setSugestoes(null);
    setViaBusca(false);
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
      setViaBusca(false);
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

  /** Busca conforme a pessoa digita, a partir do minimo de letras. */
  const buscarNome = useCallback((texto: string) => {
    setNome(texto);
    setMessage(null);
    if (!termoValido(texto)) {
      setSugestoes(null);
      return;
    }
    startTransition(async () => {
      const r = await buscarAgendamentoPorNome(texto);
      setSugestoes(r.ok ? (r.data ?? []) : []);
      if (!r.ok) setMessage(r.error);
    });
  }, []);

  const escolherSugestao = (patientId: string) => {
    startTransition(async () => {
      const r = await lookupPorPaciente(patientId);
      if (!r.ok) {
        setMessage(r.error);
        setStep('erro');
        return;
      }
      const data = r.data ?? [];
      setViaBusca(true);
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
      // A caixa de dialogo do Windows nao pode ser fechada por codigo: quem
      // decide isso e o navegador. O Chrome aberto com --kiosk-printing
      // imprime direto na impressora padrao, sem perguntar nada. O atalho
      // pronto esta em docs/TOTEM-IMPRESSORA.md.
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
          <p className="mb-3 text-slate-300">{instructions ?? 'Informe seu CPF para continuar.'}</p>
          <p className="mb-5 inline-block rounded-full bg-white/10 px-4 py-1.5 text-sm text-slate-200">
            Atendimento por ordem de chegada
          </p>

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

          <button
            type="button"
            onClick={() => {
              setStep('nome');
              setMessage(null);
            }}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 py-4 text-lg font-medium text-slate-200 transition hover:bg-white/10"
          >
            <UserSearch className="h-5 w-5" /> Não tenho CPF — buscar pelo nome
          </button>
        </section>
      )}

      {step === 'nome' && (
        <section className="w-full max-w-2xl text-center">
          <h2 className="mb-1 text-2xl font-semibold">Digite seu nome</h2>
          <p className="mb-5 text-slate-300">
            Ao menos {MINIMO_LETRAS} letras. Mostramos apenas quem tem horário marcado para hoje.
          </p>

          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white/10 p-4">
            <Search className="h-6 w-6 shrink-0 text-slate-400" />
            <input
              value={nome}
              onChange={(e) => buscarNome(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="NOME"
              aria-label="Seu nome"
              className="w-full bg-transparent text-2xl tracking-wide uppercase outline-none placeholder:text-slate-500"
            />
          </div>

          <div className="mb-4 min-h-56">
            {message && <p className="rounded-xl bg-red-500/20 p-4 text-lg">{message}</p>}

            {!message && sugestoes === null && (
              <p className="p-6 text-slate-400">Comece a digitar seu nome.</p>
            )}

            {!message && sugestoes?.length === 0 && (
              <p className="p-6 text-slate-300">
                Nenhum horário encontrado com esse nome. Confira a grafia ou procure a recepção.
              </p>
            )}

            <div className="space-y-2">
              {sugestoes?.map((sug) => (
                <button
                  key={sug.patientId}
                  type="button"
                  disabled={pending}
                  onClick={() => escolherSugestao(sug.patientId)}
                  className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-5 py-4 text-left transition hover:bg-white/20 disabled:opacity-50"
                >
                  <span className="text-2xl font-semibold">{sug.nome}</span>
                  {sug.scheduledAt && (
                    <span className="rounded-full bg-white/15 px-4 py-1.5 font-mono text-xl">
                      {formatTime(sug.scheduledAt)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {TECLADO.map((linha) => (
              <div key={linha} className="flex justify-center gap-1.5">
                {linha.split('').map((letra) => (
                  <button
                    key={letra}
                    type="button"
                    onClick={() => buscarNome(nome + letra)}
                    className="h-14 w-[9%] min-w-11 rounded-xl bg-white/10 text-xl font-semibold transition hover:bg-white/25"
                  >
                    {letra}
                  </button>
                ))}
              </div>
            ))}
            <div className="flex justify-center gap-1.5">
              <button
                type="button"
                onClick={() => buscarNome(nome + ' ')}
                className="h-14 w-1/2 rounded-xl bg-white/10 text-base transition hover:bg-white/25"
              >
                espaço
              </button>
              <button
                type="button"
                onClick={() => buscarNome(nome.slice(0, -1))}
                aria-label="Apagar"
                className="h-14 w-1/5 rounded-xl bg-white/5 transition hover:bg-white/25"
              >
                <Delete className="mx-auto h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => buscarNome('')}
                aria-label="Limpar"
                className="h-14 w-1/5 rounded-xl bg-white/5 transition hover:bg-white/25"
              >
                <RotateCcw className="mx-auto h-6 w-6" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={reset}
            className="mt-5 text-lg text-slate-400 underline hover:text-white"
          >
            Voltar e usar o CPF
          </button>
        </section>
      )}

      {step === 'confirma' && selected && (
        <section className="w-full max-w-lg text-center">
          <h2 className="mb-4 text-2xl font-semibold">
            {viaBusca ? 'Confirme seu horário' : 'Confirme seus dados'}
          </h2>
          <div className="rounded-2xl bg-white/10 p-6 text-left">
            <p className="text-3xl font-bold">
              {viaBusca ? nomeAbreviado(selected.patientName) : selected.patientName}
            </p>
            {!viaBusca && selected.birthDate && (
              <p className="mt-1 text-slate-300">Nascimento: {formatDate(selected.birthDate)}</p>
            )}
            {selected.companyName && (
              <p className="text-slate-300">Empresa: {selected.companyName}</p>
            )}
            {selected.scheduledAt && (
              <p className={viaBusca ? 'mt-2 text-2xl font-semibold' : 'text-slate-300'}>
                Horário: {formatTime(selected.scheduledAt)}
              </p>
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
                  {viaBusca ? nomeAbreviado(m.patientName) : m.patientName} —{' '}
                  {m.scheduledAt ? formatTime(m.scheduledAt) : 'sem horario'}
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
              onClick={() => confirm('normal')}
              className="rounded-2xl py-5 text-lg font-semibold"
              style={{ backgroundColor: primaryColor }}
            >
              Confirmar
            </button>
          </div>
        </section>
      )}

      {step === 'senha' && (
        <section className="w-full max-w-md text-center">
          <CheckCircle2 className="no-print mx-auto mb-3 h-14 w-14 text-emerald-400" />
          <h2 className="no-print mb-1 text-xl font-medium">Check-in realizado</h2>
          {message && <p className="no-print mb-3 text-sm text-amber-200">{message}</p>}

          {/* Na tela e um cartao; no papel de 80mm vira o ticket da bobina. */}
          <div className="ticket-termico rounded-3xl bg-white p-8 text-slate-900">
            <p className="text-sm tracking-widest uppercase">{systemName}</p>
            <p className="so-papel text-[10px]">SENHA DE ATENDIMENTO</p>
            <p className="my-3 text-7xl font-black tracking-tight">{ticket?.code ?? '—'}</p>
            <p className="text-sm">
              {viaBusca
                ? nomeAbreviado(selected?.patientName ?? '')
                : (selected?.patientName ?? '')}
            </p>
            {selected?.companyName && (
              <p className="text-xs text-slate-500">{selected.companyName}</p>
            )}
            {selected?.scheduledAt && (
              <p className="text-xs text-slate-500">
                Horário marcado: {formatTime(selected.scheduledAt)}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {formatDate(new Date())} · {formatTime(new Date())}
            </p>
            <p className="mt-3 text-xs text-slate-600">Aguarde ser chamado na recepção.</p>
            <p className="so-papel mt-3 text-[9px]">Atendimento por ordem de chegada</p>
            {/* Espaco antes do corte: a lamina fica alguns milimetros acima
                da cabeca de impressao e comeria a ultima linha. */}
            <p className="so-papel mt-6 text-[9px]">&nbsp;</p>
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
