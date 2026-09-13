'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import { Button } from '@/components/ui';
import { ROTULO_PERIODO, type Periodo } from '@/modules/finance/fluxo-caixa';

const PERIODOS: Periodo[] = ['dia', 'semana', 'mes', 'ano', 'personalizado'];

/**
 * Escolha do periodo, com atalho para andar no tempo.
 *
 * "filtrar por data de dia, semana, mes e ano" mais "opcao de incluir a
 * data manual e selecionar o periodo personalizado".
 */
export function SeletorDePeriodo({
  periodo,
  referencia,
  de,
  ate,
  inicio,
  fim,
}: {
  periodo: Periodo;
  referencia: string;
  de: string;
  ate: string;
  inicio: string;
  fim: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const ir = (patch: Record<string, string>) => {
    const proximo = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) proximo.set(k, v);
    router.replace(`${pathname}?${proximo.toString()}`);
  };

  const andar = (sentido: 1 | -1) => {
    const d = new Date(`${referencia}T12:00:00-03:00`);
    if (periodo === 'dia') d.setDate(d.getDate() + sentido);
    else if (periodo === 'semana') d.setDate(d.getDate() + 7 * sentido);
    else if (periodo === 'mes') d.setMonth(d.getMonth() + sentido);
    else d.setFullYear(d.getFullYear() + sentido);
    ir({ data: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d) });
  };

  const descrever = () => {
    const fmt = (iso: string, opcoes: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes }).format(
        new Date(`${iso}T12:00:00-03:00`),
      );
    if (periodo === 'dia') return fmt(inicio, { dateStyle: 'long' });
    if (periodo === 'ano') return inicio.slice(0, 4);
    if (periodo === 'mes') return fmt(inicio, { month: 'long', year: 'numeric' });
    return `${fmt(inicio, { day: '2-digit', month: 'short' })} a ${fmt(fim, { day: '2-digit', month: 'short', year: 'numeric' })}`;
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => ir({ periodo: p })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                p === periodo ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {ROTULO_PERIODO[p]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {periodo !== 'personalizado' && (
            <>
              <button
                type="button"
                onClick={() => andar(-1)}
                aria-label="Período anterior"
                className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="min-w-44 text-center text-sm font-medium">{descrever()}</p>
              <button
                type="button"
                onClick={() => andar(1)}
                aria-label="Próximo período"
                className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          <a href={`/financeiro/fluxo-caixa/relatorio?${params.toString()}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline">
              <FileDown className="h-4 w-4" /> Relatório
            </Button>
          </a>
        </div>
      </div>

      {periodo === 'personalizado' && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <label className="text-sm text-slate-600" htmlFor="de">
            De
          </label>
          <input
            id="de"
            type="date"
            defaultValue={de}
            onChange={(e) => ir({ de: e.target.value })}
            className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
          />
          <label className="text-sm text-slate-600" htmlFor="ate">
            até
          </label>
          <input
            id="ate"
            type="date"
            defaultValue={ate}
            onChange={(e) => ir({ ate: e.target.value })}
            className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
          />
          <span className="text-sm text-slate-500">{descrever()}</span>
        </div>
      )}
    </div>
  );
}
