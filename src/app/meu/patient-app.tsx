'use client';

import { useEffect, useState, useTransition } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { lookupPatientJourney, type PatientJourney } from './actions';
import { formatCPF, formatDateTime } from '@/lib/format';

const STEPS = [
  { code: 'agendado', label: 'Agendamento' },
  { code: 'aguardando_recepcao', label: 'Totem' },
  { code: 'na_recepcao', label: 'Recepcao' },
  { code: 'em_triagem', label: 'Triagem' },
  { code: 'em_exames', label: 'Exames' },
  { code: 'em_consulta', label: 'Medico' },
  { code: 'aguardando_documentos', label: 'Documentos' },
  { code: 'finalizado', label: 'Finalizado' },
];

const ORDER: Record<string, number> = {
  agendado: 0,
  checkin: 1,
  aguardando_recepcao: 1,
  na_recepcao: 2,
  aguardando_triagem: 3,
  em_triagem: 3,
  aguardando_exames: 4,
  em_exames: 4,
  aguardando_medico: 5,
  em_consulta: 5,
  aguardando_documentos: 6,
  finalizado: 7,
};

export function PatientApp({
  systemName,
  logoUrl,
  primaryColor,
}: {
  systemName: string;
  logoUrl: string | null;
  primaryColor: string;
}) {
  const [cpf, setCpf] = useState('');
  const [birth, setBirth] = useState('');
  const [journey, setJourney] = useState<PatientJourney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Atualiza a etapa a cada 20s enquanto o atendimento estiver aberto
  useEffect(() => {
    if (!journey || journey.stageCode === 'finalizado') return;
    const timer = setInterval(() => {
      startTransition(async () => {
        const result = await lookupPatientJourney(cpf, birth);
        if (result.ok && result.data) setJourney(result.data);
      });
    }, 20000);
    return () => clearInterval(timer);
  }, [journey, cpf, birth]);

  const search = () =>
    startTransition(async () => {
      setError(null);
      const result = await lookupPatientJourney(cpf, birth);
      if (!result.ok) {
        setError(result.error);
        setJourney(null);
        return;
      }
      setJourney(result.data ?? null);
    });

  const currentIndex = journey ? (ORDER[journey.stageCode] ?? 0) : -1;

  return (
    <main
      className="min-h-screen bg-slate-50"
      style={{ ['--brand-primary' as string]: primaryColor }}
    >
      <header className="px-5 py-6 text-white" style={{ backgroundColor: primaryColor }}>
        <div className="mx-auto flex max-w-md items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={systemName} className="h-9 object-contain" />
          ) : (
            <span className="text-lg font-bold">{systemName}</span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-md p-5">
        {!journey && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h1 className="mb-1 text-lg font-semibold">Acompanhe seu atendimento</h1>
            <p className="mb-4 text-sm text-slate-500">
              Informe seu CPF e data de nascimento para consultar sua senha e etapa atual.
            </p>

            {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">CPF</span>
              <input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                inputMode="numeric"
                className="h-11 w-full rounded-lg border border-slate-300 px-3"
                placeholder="000.000.000-00"
              />
            </label>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Data de nascimento</span>
              <input
                type="date"
                value={birth}
                onChange={(e) => setBirth(e.target.value)}
                className="h-11 w-full rounded-lg border border-slate-300 px-3"
              />
            </label>

            <button
              type="button"
              onClick={search}
              disabled={pending || cpf.replace(/\D/g, '').length !== 11 || !birth}
              className="h-12 w-full rounded-lg font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: primaryColor }}
            >
              {pending ? 'Consultando...' : 'Consultar'}
            </button>
          </div>
        )}

        {journey && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
              <p className="text-xs tracking-widest text-slate-500 uppercase">Sua senha</p>
              <p className="my-2 text-6xl font-black" style={{ color: primaryColor }}>
                {journey.ticketCode ?? '—'}
              </p>
              <p className="text-sm font-medium">{journey.patientName}</p>
              <p className="text-xs text-slate-500">{formatCPF(cpf)}</p>
              {journey.roomName && (
                <p className="mt-3 rounded-lg bg-slate-100 p-2 text-sm">
                  Dirija-se a <strong>{journey.roomName}</strong>
                </p>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold">Sua jornada</p>
              <ol className="space-y-3">
                {STEPS.map((step, index) => {
                  const done = index < currentIndex;
                  const current = index === currentIndex;
                  return (
                    <li key={step.code} className="flex items-center gap-3">
                      {done ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : current ? (
                        <Loader2 className="h-5 w-5 animate-spin" style={{ color: primaryColor }} />
                      ) : (
                        <Circle className="h-5 w-5 text-slate-300" />
                      )}
                      <span
                        className={
                          current ? 'font-semibold' : done ? 'text-slate-600' : 'text-slate-400'
                        }
                      >
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 text-xs text-slate-400">
                Check-in: {formatDateTime(journey.checkinAt)}
              </p>
            </div>

            {journey.exams.length > 0 && (
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <p className="mb-3 text-sm font-semibold">Exames</p>
                <ul className="space-y-2 text-sm">
                  {journey.exams.map((e) => (
                    <li key={e.name} className="flex items-center justify-between">
                      <span>{e.name}</span>
                      <span
                        className={e.status === 'concluido' ? 'text-emerald-600' : 'text-slate-400'}
                      >
                        {e.status === 'concluido' ? 'concluido' : 'pendente'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setJourney(null);
                setCpf('');
                setBirth('');
              }}
              className="h-11 w-full rounded-lg border border-slate-300 bg-white text-sm font-medium"
            >
              Consultar outro CPF
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
