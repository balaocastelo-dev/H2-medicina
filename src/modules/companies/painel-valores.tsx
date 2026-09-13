'use client';

import { useActionState } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, Input, Table, Td, Th } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { salvarValoresDaEmpresa } from './empresa-actions';
import type { ActionResult } from '@/lib/action-result';

export interface ExameComPreco {
  id: string;
  nome: string;
  precoPadrao: number;
  /** Valor negociado com esta empresa, quando houver. */
  precoNegociado: number | null;
}

/**
 * Tabela de valores negociados com a empresa.
 *
 * "cada empresa tem um valor para exame". Sem linha aqui, a recepcao cobra
 * o preco de tabela — que continua sendo o comportamento de antes, so que
 * agora visivel.
 */
export function PainelDeValores({
  companyId,
  exames,
  podeEditar,
}: {
  companyId: string;
  exames: ExameComPreco[];
  podeEditar: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarValoresDaEmpresa,
    null,
  );

  const negociados = exames.filter((e) => e.precoNegociado !== null).length;

  return (
    <Card>
      <CardHeader
        title="Valores por exame"
        description={
          negociados > 0
            ? `${negociados} de ${exames.length} exame(s) com valor negociado`
            : 'Nenhum valor negociado: a cobrança usa o preço de tabela'
        }
      />
      <CardBody>
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        {exames.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">Nenhum exame cadastrado na clínica.</p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="company_id" value={companyId} />

            <Table>
              <thead>
                <tr>
                  <Th>Exame</Th>
                  <Th className="w-36">Valor de tabela</Th>
                  <Th className="w-44">Valor desta empresa</Th>
                </tr>
              </thead>
              <tbody>
                {exames.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{e.nome}</Td>
                    <Td className="text-slate-500">
                      {e.precoPadrao > 0 ? formatMoney(e.precoPadrao) : 'a definir'}
                    </Td>
                    <Td>
                      {podeEditar ? (
                        <Input
                          name={`preco_${e.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="tabela"
                          defaultValue={e.precoNegociado ?? ''}
                        />
                      ) : e.precoNegociado !== null ? (
                        formatMoney(e.precoNegociado)
                      ) : (
                        <span className="text-slate-400">tabela</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {podeEditar && (
              <div className="mt-4 flex items-center gap-3">
                <Button type="submit" loading={pending}>
                  Salvar valores
                </Button>
                <span className="text-xs text-slate-500">
                  Campo vazio usa o valor de tabela. Zero é um preço válido — exame de cortesia.
                </span>
              </div>
            )}
          </form>
        )}
      </CardBody>
    </Card>
  );
}
