import { Card, Skeleton } from '@/components/ui';

/** Filas e salas sao cartoes lado a lado, nao uma tabela. */
export default function CarregandoFilas() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando as salas…</span>

      <div className="mb-5">
        <Skeleton className="h-7 w-40" />
        <div className="mt-2">
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((sala) => (
          <Card key={sala}>
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div>
                <Skeleton className="h-5 w-32" />
                <div className="mt-2">
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div className="space-y-3 p-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
