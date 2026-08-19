'use client';

import { useActionState, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { FilterSelect } from '@/components/ui/data-controls';
import { formatDate, formatMoney } from '@/lib/format';
import { excluirConta, mudarStatusConta, salvarConta } from '@/modules/finance/repasse-actions';
import type { ActionResult } from '@/lib/action-result';
import type { ContaRow } from './types';

const CATEGORIAS = [
  'geral',
  'aluguel',
  'folha',
  'impostos',
  'insumos',
  'equipamentos',
  'servicos',
  'marketing',
];

export function NovaConta({ conta }: { conta?: ContaRow }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarConta,
    null,
  );
  const [aberto, setAberto] = useState(!!conta);
  const erros = state && !state.ok ? state.fieldErrors : undefined;

  if (!aberto) {
    return (
      <Button onClick={() => setAberto(true)}>Nova conta a pagar</Button>
    );
  }

  return (
    <Card>
      <CardHeader title={conta ? 'Editar conta' : 'Nova conta a pagar'} />
      <CardBody>
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        <form action={formAction} className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="id" value={conta?.id ?? ''} />
          <Field label="Descrição" error={erros?.description} className="md:col-span-2" required>
            <Input name="description" defaultValue={conta?.description ?? ''} />
          </Field>
          <Field label="Fornecedor">
            <Input name="supplier" defaultValue={conta?.supplier ?? ''} />
          </Field>
          <Field label="Categoria">
            <Select name="category" defaultValue={conta?.category ?? 'geral'}>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" error={erros?.amount} required>
            <Input name="amount" type="number" step="0.01" min="0" defaultValue={conta?.amount ?? ''} />
          </Field>
          <Field label="Vencimento" error={erros?.due_date} required>
            <Input name="due_date" type="date" defaultValue={conta?.due_date ?? ''} />
          </Field>
          <Field label="Repete todo mês">
            <Select name="is_recurring" defaultValue={conta?.is_recurring ? 'sim' : 'nao'}>
              <option value="nao">Não</option>
              <option value="sim">Sim</option>
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" loading={pending}>
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function ContasClient({
  contas,
  hoje,
  podeEditar,
}: {
  contas: ContaRow[];
  hoje: string;
  podeEditar: boolean;
}) {
  const [emEdicao, setEmEdicao] = useState<ContaRow | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const executar = async (id: string, acao: () => Promise<ActionResult>) => {
    setRodando(id);
    const r = await acao();
    setAviso(r.ok ? (r.message ?? 'Feito.') : r.error);
    setRodando(null);
  };

  const comStatus = (id: string, status: string) => {
    const fd = new FormData();
    fd.set('id', id);
    fd.set('status', status);
    return () => mudarStatusConta(null, fd);
  };

  return (
    <div className="space-y-4">
      {emEdicao && <NovaConta key={emEdicao.id} conta={emEdicao} />}
      {aviso && <Alert variant="info">{aviso}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <FilterSelect
            name="status"
            label="Status"
            options={['aberta', 'paga', 'cancelada'].map((s) => ({ value: s, label: s }))}
          />
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Descrição</Th>
              <Th>Categoria</Th>
              <Th>Vencimento</Th>
              <Th>Valor</Th>
              <Th>Status</Th>
              {podeEditar && <Th />}
            </tr>
          </thead>
          <tbody>
            {contas.map((c) => {
              const vencida = c.status === 'aberta' && c.due_date < hoje;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-medium">
                    {c.description}
                    {c.supplier && <p className="text-xs text-slate-500">{c.supplier}</p>}
                    {c.is_recurring && (
                      <span className="text-[10px] text-slate-400">repete todo mês</span>
                    )}
                  </Td>
                  <Td className="text-slate-600">{c.category}</Td>
                  <Td className={vencida ? 'font-medium text-red-600' : 'text-slate-600'}>
                    {formatDate(c.due_date)}
                  </Td>
                  <Td className="font-medium">{formatMoney(c.amount)}</Td>
                  <Td>
                    <Badge
                      color={
                        c.status === 'paga' ? '#22C55E' : vencida ? '#EF4444' : c.status === 'cancelada' ? '#9CA3AF' : '#FB923C'
                      }
                    >
                      {vencida ? 'vencida' : c.status}
                    </Badge>
                  </Td>
                  {podeEditar && (
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.status === 'aberta' && (
                          <Button
                            size="sm"
                            variant="success"
                            loading={rodando === c.id}
                            onClick={() => executar(c.id, comStatus(c.id, 'paga'))}
                          >
                            Pagar
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEmEdicao(c)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={rodando === c.id}
                          onClick={() => {
                            if (!window.confirm(`Remover "${c.description}"?`)) return;
                            const fd = new FormData();
                            fd.set('id', c.id);
                            void executar(c.id, () => excluirConta(null, fd));
                          }}
                        >
                          Remover
                        </Button>
                      </div>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
