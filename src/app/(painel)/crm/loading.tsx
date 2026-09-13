import { Skeleton } from '@/components/ui';

/**
 * O CRM e um quadro de colunas, nao uma tabela. O esqueleto generico do
 * painel daria um solavanco na troca.
 */
export default function CarregandoCrm() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o quadro do dia…</span>

      <div className="mb-5">
        <Skeleton className="h-7 w-44" />
        <div className="mt-2">
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((coluna) => (
          <div key={coluna} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Skeleton className="h-4 w-28" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 - (coluna % 3) }).map((_, cartao) => (
                <div key={cartao} className="rounded-lg bg-white p-3 shadow-sm">
                  <Skeleton className="h-4 w-full" />
                  <div className="mt-2">
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
