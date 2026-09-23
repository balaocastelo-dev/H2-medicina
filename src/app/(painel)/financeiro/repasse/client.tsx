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
  ajustarValorDoRepasse,
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
  const [ajuste, ajusteAction, ajustando] = useActionState<ActionResult | null, FormData>(
    ajustarValorDoRepasse,
    null,
  );
  const [editando, setEditando] = useState<LinhaRepasse | null>(null);
  const abertos = lancamentos.filter((l) => l.status === 'a_pagar');

  return (
    <div>
      {ajuste?.ok && <Alert variant="success">{ajuste.message}</Alert>}
      {ajuste && !ajuste.ok && <Alert variant="error">{ajuste.error}</Alert>}

      {/*
        "aba financeiro, nao sta dando opcao para editar o valor de repasse
         medico" — Isabella, 23/09. O valor vem da tabela do procedimento,
        mas acontece de um atendimento valer diferente.
      */}
      {editando && (
        <form
          action={ajusteAction}
          onSubmit={() => setEditando(null)}
          className="mb-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-4"
        >
          <input type="hidden" name="id" value={editando.id} />
          <div className="md:col-span-4 text-sm text-slate-600">
            Corrigindo o repasse de <strong>{editando.paciente}</strong> —{' '}
            {editando.procedimento}, hoje {formatMoney(editando.valor)}.
          </div>
          <Field label="Novo valor">
            <Input
              name="fee"
              type="number"
              step="0.01"
              min="0"
              defaultValue={editando.valor}
              autoFocus
            />
          </Field>
          <Field label="Motivo (fica registrado)" className="md:col-span-2">
            <Input name="motivo" placeholder="Ex.: acordo com o médico para este plantão" />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" loading={ajustando}>
              Salvar valor
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

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
              {podeBaixar && <Th />}
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
                {podeBaixar && (
                  <Td>
                    {/* Repasse pago e historico: corrigir valor pago
                        desacertaria o que o medico ja recebeu. */}
                    {l.status === 'a_pagar' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditando(l)}
                      >
                        Editar valor
                      </Button>
                    )}
                  </Td>
                )}
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
    </div>
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
