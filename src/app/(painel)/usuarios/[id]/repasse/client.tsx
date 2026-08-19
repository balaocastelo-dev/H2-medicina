'use client';

import { useActionState } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, Input, Table, Td, Th } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { salvarValoresDoMedico } from '@/modules/finance/repasse-actions';
import type { ActionResult } from '@/lib/action-result';

interface Linha {
  code: string;
  name: string;
  padrao: number;
  proprio: number | null;
}

export function FormValoresDoMedico({
  profileId,
  procedimentos,
}: {
  profileId: string;
  procedimentos: Linha[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarValoresDoMedico,
    null,
  );

  return (
    <Card>
      <CardHeader
        title="Valores por procedimento"
        description="Campo vazio usa o valor padrão da tabela da clínica."
      />
      <CardBody>
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        <form action={formAction}>
          <input type="hidden" name="profile_id" value={profileId} />

          <Table>
            <thead>
              <tr>
                <Th>Procedimento</Th>
                <Th>Valor padrão</Th>
                <Th className="w-44">Valor deste médico</Th>
              </tr>
            </thead>
            <tbody>
              {procedimentos.map((p) => (
                <tr key={p.code}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-slate-500">
                    {p.padrao > 0 ? formatMoney(p.padrao) : 'a definir'}
                  </Td>
                  <Td>
                    <Input
                      name={`fee_${p.code}`}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="padrão"
                      defaultValue={p.proprio ?? ''}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-4">
            <Button type="submit" loading={pending}>
              Salvar valores
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
