'use client';

import { useActionState, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import {
  marcarRepassePago,
  restaurarCatalogo,
  salvarProcedimento,
} from '@/modules/finance/repasse-actions';
import type { ActionResult } from '@/lib/action-result';

export function SeletorCompetencia({ competencia }: { competencia: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <label className="text-sm font-medium text-slate-600" htmlFor="competencia">
        Competência
      </label>
      <input
        id="competencia"
        type="month"
        value={competencia}
        onChange={(e) => {
          const proximo = new URLSearchParams(params.toString());
          proximo.set('competencia', e.target.value);
          router.replace(`${pathname}?${proximo.toString()}`);
        }}
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
      />
    </div>
  );
}

interface LinhaRepasse {
  id: string;
  paciente: string;
  procedimento: string;
  valor: number;
  status: string;
  data: string;
}

export function BaixaDeRepasse({
  lancamentos,
  podeBaixar,
}: {
  lancamentos: LinhaRepasse[];
  podeBaixar: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    marcarRepassePago,
    null,
  );
  const abertos = lancamentos.filter((l) => l.status === 'a_pagar');

  return (
    <form action={formAction}>
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

      <Table>
        <thead>
          <tr>
            {podeBaixar && <Th className="w-10" />}
            <Th>Paciente</Th>
            <Th>Procedimento</Th>
            <Th>Data</Th>
            <Th>Valor</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {lancamentos.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              {podeBaixar && (
                <Td>
                  {l.status === 'a_pagar' && (
                    <input
                      type="checkbox"
                      name="ids"
                      value={l.id}
                      defaultChecked
                      aria-label={`Selecionar ${l.paciente}`}
                    />
                  )}
                </Td>
              )}
              <Td className="font-medium">{l.paciente}</Td>
              <Td className="text-slate-600">{l.procedimento}</Td>
              <Td className="text-slate-500">{formatDate(l.data)}</Td>
              <Td className="font-medium">{formatMoney(l.valor)}</Td>
              <Td>
                <Badge color={l.status === 'pago' ? '#22C55E' : '#FB923C'}>{l.status}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {podeBaixar && abertos.length > 0 && (
        <div className="mt-3">
          <Button type="submit" size="sm" loading={pending}>
            Marcar selecionados como pagos
          </Button>
        </div>
      )}
    </form>
  );
}

interface Procedimento {
  id: string;
  code: string;
  name: string;
  default_fee: number;
  sort_order: number;
  is_active: boolean;
}

export function CatalogoProcedimentos({ procedimentos }: { procedimentos: Procedimento[] }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarProcedimento,
    null,
  );
  const [editando, setEditando] = useState<Procedimento | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [avisoCatalogo, setAvisoCatalogo] = useState<string | null>(null);
  const erros = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader
        title="Tabela de procedimentos"
        description="Valor padrão de cada procedimento. O cadastro do médico pode ter valor próprio."
        action={
          <Button
            size="sm"
            variant="outline"
            loading={restaurando}
            onClick={async () => {
              setRestaurando(true);
              const r = await restaurarCatalogo();
              setAvisoCatalogo(r.ok ? (r.message ?? 'Catálogo restaurado.') : r.error);
              setRestaurando(false);
            }}
          >
            Restaurar tabela padrão
          </Button>
        }
      />
      <CardBody>
        {avisoCatalogo && <Alert variant="info">{avisoCatalogo}</Alert>}
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        <form action={formAction} className="mb-4 grid gap-3 md:grid-cols-5">
          <input type="hidden" name="id" value={editando?.id ?? ''} />
          <Field label="Código" error={erros?.code}>
            <Input name="code" defaultValue={editando?.code ?? ''} key={`c-${editando?.id ?? 'novo'}`} />
          </Field>
          <Field label="Nome" error={erros?.name} className="md:col-span-2">
            <Input name="name" defaultValue={editando?.name ?? ''} key={`n-${editando?.id ?? 'novo'}`} />
          </Field>
          <Field label="Valor padrão" error={erros?.default_fee}>
            <Input
              name="default_fee"
              type="number"
              step="0.01"
              min="0"
              defaultValue={editando?.default_fee ?? 0}
              key={`v-${editando?.id ?? 'novo'}`}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" loading={pending}>
              {editando ? 'Salvar' : 'Adicionar'}
            </Button>
            {editando && (
              <Button type="button" variant="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>

        <Table>
          <thead>
            <tr>
              <Th>Procedimento</Th>
              <Th>Código</Th>
              <Th>Valor padrão</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {procedimentos.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-medium">
                  {p.name}
                  {!p.is_active && <span className="ml-2 text-xs text-slate-400">(inativo)</span>}
                </Td>
                <Td className="font-mono text-xs text-slate-500">{p.code}</Td>
                <Td>
                  {Number(p.default_fee) > 0 ? (
                    formatMoney(p.default_fee)
                  ) : (
                    <span className="text-amber-600">valor a definir</span>
                  )}
                </Td>
                <Td>
                  <Button size="sm" variant="outline" onClick={() => setEditando(p)}>
                    Editar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
