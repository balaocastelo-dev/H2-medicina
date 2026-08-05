'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface DiaDoCalendario {
  /** AAAA-MM-DD */
  iso: string;
  total: number;
  realizados: number;
  ausentes: number;
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * Calendário de 30 dias com o volume de cada dia.
 *
 * A cor da barra mostra a ocupação relativa ao dia mais cheio do período —
 * bate o olho e já se vê onde a agenda aperta.
 */
export function Calendario({
  dias,
  selecionado,
  inicio,
}: {
  dias: DiaDoCalendario[];
  selecionado: string;
  inicio: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const irPara = (chave: string, valor: string) => {
    const proximo = new URLSearchParams(params.toString());
    proximo.set(chave, valor);
    router.replace(`${pathname}?${proximo.toString()}`);
  };

  const deslocar = (dias: number) => {
    const d = new Date(`${inicio}T12:00:00-03:00`);
    d.setDate(d.getDate() + dias);
    irPara('inicio', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d));
  };

  const maximo = Math.max(1, ...dias.map((d) => d.total));
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  // Alinha a primeira semana ao dia correto da semana.
  const primeiroDia = dias[0] ? new Date(`${dias[0].iso}T12:00:00-03:00`).getDay() : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => deslocar(-30)}
          className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
          aria-label="30 dias anteriores"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium">
          {formatarPeriodo(dias[0]?.iso, dias[dias.length - 1]?.iso)}
        </p>
        <button
          type="button"
          onClick={() => deslocar(30)}
          className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
          aria-label="Próximos 30 dias"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {SEMANA.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: primeiroDia }).map((_, i) => (
          <div key={`vazio-${i}`} />
        ))}

        {dias.map((dia) => {
          const ehHoje = dia.iso === hoje;
          const escolhido = dia.iso === selecionado;
          const intensidade = dia.total / maximo;
          const numero = Number(dia.iso.slice(8, 10));

          return (
            <button
              key={dia.iso}
              type="button"
              onClick={() => irPara('data', dia.iso)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition ${
                escolhido
                  ? 'border-transparent ring-2 ring-brand'
                  : ehHoje
                    ? 'border-slate-400'
                    : 'border-slate-200 hover:bg-slate-50'
              }`}
              title={`${dia.total} agendamento(s)`}
            >
              <span className={`text-sm leading-none ${ehHoje ? 'font-bold' : 'font-medium'}`}>
                {numero}
              </span>

              {dia.total > 0 ? (
                <>
                  <span
                    className="h-1 w-full rounded-full"
                    style={{
                      backgroundColor: 'var(--brand-primary)',
                      opacity: 0.25 + intensidade * 0.75,
                    }}
                  />
                  <span className="text-[10px] leading-none font-semibold text-slate-600 tabular-nums">
                    {dia.total}
                  </span>
                </>
              ) : (
                <>
                  <span className="h-1 w-full rounded-full bg-slate-100" />
                  <span className="text-[10px] leading-none text-slate-300">—</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-center text-[11px] text-slate-400">
        Clique num dia para ver a lista. A barra indica o volume em relação ao dia mais cheio.
      </p>
    </div>
  );
}

function formatarPeriodo(de?: string, ate?: string): string {
  if (!de || !ate) return '';
  const formato = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Sao_Paulo',
  });
  return `${formato.format(new Date(`${de}T12:00:00-03:00`))} — ${formato.format(new Date(`${ate}T12:00:00-03:00`))}`;
}
