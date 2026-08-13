'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Alert, Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { formatTime } from '@/lib/format';
import { duracaoEmPalavras, etapaDe } from '@/modules/guide/etapas';
import { regraDe } from '@/modules/queue/origin-kind';
import { trilhaDoAtendimento, type TrilhaCompleta } from '@/modules/guide/trilha-actions';
import { TrilhaDoPaciente } from '@/components/guide/trilha';

export interface LinhaDoMapa {
  id: string;
  stage_code: string;
  checkin_at: string;
  stage_changed_at: string | null;
  finished_at: string | null;
  origin_kind: string;
  priority: string;
  patient_id: string;
  patients: { id: string; full_name: string; cpf: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
}

/** Acima disso, alguém provavelmente foi esquecido numa etapa. */
const MINUTOS_DE_ALERTA = 45;

/**
 * Mapa do dia agrupado por etapa.
 *
 * Responde de relance a pergunta que a doutora faz ao entrar na clinica:
 * quem esta aqui e onde cada um esta parado.
 */
export function MapaDoDia({ linhas, ordem }: { linhas: LinhaDoMapa[]; ordem: string[] }) {
  const [detalhe, setDetalhe] = useState<TrilhaCompleta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  // O relógio da tela avança sozinho: "há 12 minutos" precisa virar "há 13"
  // sem a pessoa recarregar. Ler Date.now() direto no render deixaria o
  // número congelado e ainda tornaria a renderização impura.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const grupos = useMemo(() => {
    const mapa = new Map<string, LinhaDoMapa[]>();
    for (const l of linhas) {
      if (!mapa.has(l.stage_code)) mapa.set(l.stage_code, []);
      mapa.get(l.stage_code)!.push(l);
    }
    // A esteira manda na ordem; etapas fora dela (cancelado, ausente) vão
    // para o fim, que é onde a atenção deve ir por último.
    return [...mapa.entries()].sort(([a], [b]) => {
      const ia = ordem.indexOf(a);
      const ib = ordem.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [linhas, ordem]);

  const abrir = (attendanceId: string) =>
    startTransition(async () => {
      setErro(null);
      const r = await trilhaDoAtendimento(attendanceId);
      if (r.ok && r.data) setDetalhe(r.data);
      else if (!r.ok) setErro(r.error);
    });

  return (
    <div className="space-y-4">
      {erro && <Alert variant="error">{erro}</Alert>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-guia="grupos-jornada">
        {grupos.map(([code, pacientes]) => {
          const etapa = etapaDe(code);
          return (
            <Card key={code}>
              <CardHeader
                title={etapa.rotulo}
                description={etapa.onde}
                action={
                  <span
                    className="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold text-white"
                    style={{ backgroundColor: etapa.cor }}
                  >
                    {pacientes.length}
                  </span>
                }
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-slate-100">
                  {pacientes.map((p) => {
                    const desde = new Date(p.stage_changed_at ?? p.checkin_at).getTime();
                    const segundos = Math.max(0, (agora - desde) / 1000);
                    const parado = !etapa.terminal && segundos > MINUTOS_DE_ALERTA * 60;
                    const regra = regraDe(p.origin_kind);

                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={pendente}
                          onClick={() => abrir(p.id)}
                          className="flex w-full items-center justify-between gap-2 p-2.5 text-left hover:bg-slate-50 disabled:opacity-60"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              title={regra.label}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                              style={{ backgroundColor: regra.color }}
                            >
                              {regra.letter}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-800">
                                {p.patients?.full_name ?? 'Paciente'}
                              </span>
                              <span className="block truncate text-xs text-slate-500">
                                chegou {formatTime(p.checkin_at)}
                                {p.companies &&
                                  ` · ${p.companies.trade_name ?? p.companies.legal_name}`}
                              </span>
                            </span>
                          </span>

                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-xs text-slate-500">
                              {p.queue_tickets?.[0]?.code ?? '—'}
                            </span>
                            <span
                              className={`block text-xs ${parado ? 'font-semibold text-amber-700' : 'text-slate-400'}`}
                            >
                              {parado && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                              {duracaoEmPalavras(segundos)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        Clique num paciente para ver por onde ele passou. Tempo em laranja significa mais de{' '}
        {MINUTOS_DE_ALERTA} minutos parado na mesma etapa.
      </p>

      {detalhe && (
        <PainelDaTrilha dados={detalhe} onFechar={() => setDetalhe(null)} />
      )}
    </div>
  );
}

/** Gaveta lateral com a trilha do paciente escolhido. */
export function PainelDaTrilha({
  dados,
  onFechar,
}: {
  dados: TrilhaCompleta;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Trilha do paciente">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onFechar} />
      <div className="relative flex w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl">
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="absolute top-4 right-4 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4">
          <Badge color="#64748B">Trilha do paciente</Badge>
        </div>
        <TrilhaDoPaciente dados={dados} />
      </div>
    </div>
  );
}
