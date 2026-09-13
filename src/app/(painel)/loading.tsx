import { Card, Skeleton, TableSkeleton } from '@/components/ui';

/**
 * Esqueleto mostrado enquanto a proxima tela busca os dados.
 *
 * Antes disso, clicar numa aba deixava a tela anterior parada ate o banco
 * responder — parecia que o sistema tinha travado. Agora a tela troca na
 * hora e o conteudo chega em seguida.
 *
 * O desenho imita a estrutura real das telas (titulo, cartoes de numero e
 * tabela) para a troca nao dar solavanco quando o conteudo entra.
 *
 * Next usa este arquivo automaticamente em toda tela do painel que nao
 * tenha um proprio.
 */
export default function CarregandoPainel() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>

      <div className="mb-5">
        <Skeleton className="h-7 w-56" />
        <div className="mt-2">
          <Skeleton className="h-4 w-80" />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-24" />
            <div className="mt-3">
              <Skeleton className="h-7 w-20" />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-slate-100 p-4">
          <Skeleton className="h-9 w-64" />
        </div>
        <TableSkeleton rows={6} cols={6} />
      </Card>
    </div>
  );
}
