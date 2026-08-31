'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import type { DiaFinanceiro, Visao } from '@/modules/finance/repasse';

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ROTULO: Record<Visao, string> = {
  dia: 'Dia',
  semana: 'Semana',
  mes: 'Mês',
  ano: 'Ano',
  personalizado: 'Período',
};

/** Botoes de visao e navegacao pelo periodo. */
export function SeletorDeVisao({
  visao,
  referencia,
  inicio,
  fim,
}: {
  visao: Visao;
  referencia: string;
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

  const deslocar = (sentido: 1 | -1) => {
    const d = new Date(`${referencia}T12:00:00-03:00`);
    if (visao === 'personalizado') return;
    if (visao === 'dia') d.setDate(d.getDate() + sentido);
    else if (visao === 'semana') d.setDate(d.getDate() + 7 * sentido);
    else if (visao === 'mes') d.setMonth(d.getMonth() + sentido);
    else d.setFullYear(d.getFullYear() + sentido);
    ir({ data: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d) });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex gap-1">
        {(Object.keys(ROTULO) as Visao[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => ir(v === 'personalizado' ? { visao: v, de: inicio, ate: fim } : { visao: v })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              v === visao ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {ROTULO[v]}
          </button>
        ))}
      </div>

      {/* "calendário opção de incluir a data manual e selecionar o periodo
          personalizado" — as duas datas so aparecem nessa visao. */}
      {visao === 'personalizado' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <label className="flex items-center gap-1">
            De
            <input
              type="date"
              value={inicio}
              max={fim}
              onChange={(e) => ir({ de: e.target.value, ate: fim })}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-1">
            até
            <input
              type="date"
              value={fim}
              min={inicio}
              onChange={(e) => ir({ de: inicio, ate: e.target.value })}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            />
          </label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => deslocar(-1)}
          className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
          aria-label="Período anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-44 text-center text-sm font-medium">{descrever(visao, inicio, fim)}</p>
        <button
          type="button"
          onClick={() => deslocar(1)}
          className="rounded-lg border border-slate-300 p-1.5 hover:bg-slate-50"
          aria-label="Próximo período"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            ir({ data: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()) })
          }
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Hoje
        </button>
      </div>
    </div>
  );
}

export function GradeCalendario({
  visao,
  dias,
  meses,
}: {
  visao: Visao;
  dias: DiaFinanceiro[];
  meses: (DiaFinanceiro & { mes: string })[];
}) {
  if (visao === 'ano') {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {meses.map((m) => (
          <Bloco key={m.mes} titulo={MESES[Number(m.mes.slice(5, 7)) - 1] ?? m.mes} dado={m} grande />
        ))}
      </div>
    );
  }

  if (visao === 'dia') {
    const d = dias[0];
    if (!d) return null;
    return (
      <div className="mx-auto max-w-md">
        <Bloco titulo={d.iso.slice(8, 10)} dado={d} grande />
      </div>
    );
  }

  const primeiro = dias[0] ? new Date(`${dias[0].iso}T12:00:00-03:00`).getDay() : 0;
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {SEMANA.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: primeiro }).map((_, i) => (
          <div key={`vazio-${i}`} />
        ))}
        {dias.map((d) => (
          <Bloco key={d.iso} titulo={d.iso.slice(8, 10)} dado={d} destaque={d.iso === hoje} />
        ))}
      </div>
    </div>
  );
}

function Bloco({
  titulo,
  dado,
  grande = false,
  destaque = false,
}: {
  titulo: string;
  dado: DiaFinanceiro;
  grande?: boolean;
  destaque?: boolean;
}) {
  const vazio = !dado.recebido && !dado.aReceber && !dado.aPagar && !dado.repasse;

  return (
    <div
      className={`rounded-lg border p-2 ${grande ? 'min-h-28' : 'min-h-20'} ${
        destaque ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
      } ${vazio ? 'opacity-50' : ''}`}
    >
      <p className={`font-semibold ${grande ? 'text-base' : 'text-xs'} text-slate-700`}>{titulo}</p>
      {vazio ? (
        <p className="mt-1 text-[10px] text-slate-400">sem movimento</p>
      ) : (
        <div className={`mt-1 space-y-0.5 ${grande ? 'text-xs' : 'text-[10px]'} leading-tight`}>
          {dado.recebido > 0 && <p className="text-emerald-600">+{formatMoney(dado.recebido)}</p>}
          {dado.aReceber > 0 && <p className="text-sky-600">~{formatMoney(dado.aReceber)}</p>}
          {dado.aPagar > 0 && <p className="text-orange-600">−{formatMoney(dado.aPagar)}</p>}
          {dado.repasse > 0 && <p className="text-violet-600">M {formatMoney(dado.repasse)}</p>}
        </div>
      )}
    </div>
  );
}

function descrever(visao: Visao, inicio: string, fim: string): string {
  const fmt = (iso: string, opcoes: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes }).format(
      new Date(`${iso}T12:00:00-03:00`),
    );

  if (visao === 'dia') return fmt(inicio, { dateStyle: 'long' });
  if (visao === 'personalizado') {
    return inicio === fim
      ? fmt(inicio, { dateStyle: 'long' })
      : `${fmt(inicio, { day: '2-digit', month: 'short', year: 'numeric' })} a ${fmt(fim, { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }
  if (visao === 'ano') return inicio.slice(0, 4);
  if (visao === 'mes') return fmt(inicio, { month: 'long', year: 'numeric' });
  return `${fmt(inicio, { day: '2-digit', month: 'short' })} a ${fmt(fim, { day: '2-digit', month: 'short' })}`;
}
