'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const SITUACOES = [
  { value: '', label: 'Todos' },
  { value: 'aberto', label: 'Aguardando liberação' },
  { value: 'concluido', label: 'Atendimento concluído' },
];

/**
 * Filtros da lista de documentos.
 *
 * "Documentos: ter um filtro para 'concluidos' e 'em aberto' das pessoas que
 *  ainda não foi encerrado o atendimento" — e o período, porque sem ele a
 *  lista dos últimos 30 dias vira rolagem no fim do mês.
 */
export function FiltrosDeDocumento({
  de,
  ate,
  tipos,
}: {
  de: string;
  ate: string;
  tipos: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const situacao = params.get('situacao') ?? '';
  const tipo = params.get('tipo') ?? '';

  const aplicar = (patch: Record<string, string>) => {
    const proximo = new URLSearchParams(params.toString());
    for (const [chave, valor] of Object.entries(patch)) {
      if (valor) proximo.set(chave, valor);
      else proximo.delete(chave);
    }
    router.replace(`${pathname}?${proximo.toString()}`);
  };

  const campo =
    'h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-700';

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
      <div className="flex gap-1">
        {SITUACOES.map((s) => (
          <button
            key={s.value || 'todos'}
            type="button"
            onClick={() => aplicar({ situacao: s.value })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              s.value === situacao
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-1">
        Tipo
        <select value={tipo} onChange={(e) => aplicar({ tipo: e.target.value })} className={campo}>
          <option value="">Todos</option>
          {tipos.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1">
        De
        <input
          type="date"
          value={de}
          max={ate}
          onChange={(e) => aplicar({ de: e.target.value, ate })}
          className={campo}
        />
      </label>

      <label className="flex items-center gap-1">
        até
        <input
          type="date"
          value={ate}
          min={de}
          onChange={(e) => aplicar({ de, ate: e.target.value })}
          className={campo}
        />
      </label>
    </div>
  );
}
