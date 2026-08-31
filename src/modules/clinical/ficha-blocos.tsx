'use client';

import { Card, CardBody, CardHeader, Textarea } from '@/components/ui';
import {
  BLOCOS_FICHA,
  type BlocoFicha,
  type RespostasBloco,
} from './ficha-estrutura';

/**
 * Blocos da ficha clinica preenchidos por selecao.
 *
 * Cada resposta vai num input escondido com nome "bloco.campo", que o servidor
 * remonta em jsonb. Assim o formulario continua sendo um <form> comum, sem
 * estado global, e funciona mesmo se o JavaScript falhar em parte da pagina.
 */
export function BlocosDaFicha({
  valores,
  alteracoes,
  onChange,
  extras = [],
}: {
  valores: Record<string, RespostasBloco>;
  alteracoes: string;
  onChange: (bloco: string, campo: string, valor: string) => void;
  /** Blocos que so aparecem em alguns atendimentos, como o psicossocial. */
  extras?: BlocoFicha[];
}) {
  return (
    <>
      {[...BLOCOS_FICHA, ...extras].map((bloco) => (
        <Card key={bloco.chave}>
          <CardHeader title={bloco.titulo} description={bloco.descricao} />
          <CardBody>
            <div className="grid gap-2 md:grid-cols-2">
              {bloco.campos.map((campo) => {
                const atual = valores[bloco.chave]?.[campo.chave] ?? '';
                const opcoes =
                  campo.tipo === 'sim_nao'
                    ? ['sim', 'não']
                    : campo.tipo === 'normal_alterado'
                      ? ['normal', 'alterado']
                      : campo.tipo === 'psicossocial'
                        ? ['sim', 'às vezes', 'não']
                        : (campo.opcoes ?? []);

                return (
                  <div
                    key={campo.chave}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <span className="text-sm text-slate-700">{campo.rotulo}</span>
                    <div className="flex flex-wrap gap-1">
                      {opcoes.map((op) => {
                        const marcado = atual === op;
                        const alerta = op === 'alterado' || op === 'sim' || op === 'às vezes';
                        return (
                          <button
                            key={op}
                            type="button"
                            onClick={() => onChange(bloco.chave, campo.chave, marcado ? '' : op)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                              marcado
                                ? alerta
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {op}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="hidden"
                      name={`${bloco.chave}.${campo.chave}`}
                      value={atual}
                      readOnly
                    />
                  </div>
                );
              })}
            </div>

            {bloco.chave === 'exame_fisico' && (
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Descrição das alterações
                </label>
                <Textarea
                  name="alteracoes_exame_fisico"
                  defaultValue={alteracoes}
                  rows={3}
                  placeholder="Descreva aqui apenas os sistemas marcados como alterados."
                />
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </>
  );
}

export type { BlocoFicha };
