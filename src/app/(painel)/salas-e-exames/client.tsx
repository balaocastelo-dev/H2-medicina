'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
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
import { formatMoney } from '@/lib/format';
import {
  salvarSala,
  salvarTipoDeExame,
} from '@/modules/settings/salas-e-exames-actions';
import { CODIGOS_DO_SISTEMA } from '@/modules/settings/salas-e-exames';
import type { ActionResult } from '@/lib/action-result';

export interface SalaCadastrada {
  id: string;
  code: string;
  name: string;
  kind: string;
  sort_order: number;
  is_active: boolean;
  current_attendance_id: string | null;
}

export interface ExameCadastrado {
  id: string;
  code: string;
  name: string;
  default_room_id: string | null;
  price: number | null;
  average_minutes: number;
  sort_order: number;
  is_active: boolean;
  ocupa_sala: boolean;
}

const TIPOS_DE_SALA: { value: string; label: string }[] = [
  { value: 'exame', label: 'Sala de exame' },
  { value: 'triagem', label: 'Triagem' },
  { value: 'consultorio', label: 'Consultório' },
  { value: 'recepcao', label: 'Recepção' },
  { value: 'guiche', label: 'Guichê' },
];

const ROTULO_TIPO: Record<string, string> = Object.fromEntries(
  TIPOS_DE_SALA.map((t) => [t.value, t.label]),
);

// =====================================================================
// Salas
// =====================================================================

export function CadastroDeSalas({ salas }: { salas: SalaCadastrada[] }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarSala,
    null,
  );
  const [editando, setEditando] = useState<SalaCadastrada | null>(null);
  const [criando, setCriando] = useState(false);
  const erros = state && !state.ok ? state.fieldErrors : undefined;

  const emEdicao = criando || editando !== null;
  const chave = editando?.id ?? (criando ? 'nova' : 'fechado');

  return (
    <Card>
      <CardHeader
        title="Salas"
        description="Onde os exames acontecem. A ordem define como elas aparecem no quadro de filas."
        action={
          !emEdicao && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="h-4 w-4" /> Nova sala
            </Button>
          )
        }
      />
      <CardBody>
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        {emEdicao && (
          <form
            action={formAction}
            className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-5"
            key={chave}
          >
            <input type="hidden" name="id" value={editando?.id ?? ''} />
            <Field label="Nome" error={erros?.name} className="md:col-span-2">
              <Input name="name" defaultValue={editando?.name ?? ''} autoFocus />
            </Field>
            <Field
              label="Código"
              error={erros?.code}
              hint={editando ? undefined : 'Curto, sem espaço'}
            >
              <Input name="code" defaultValue={editando?.code ?? ''} placeholder="SALA7" />
            </Field>
            <Field label="Tipo" error={erros?.kind}>
              <Select name="kind" defaultValue={editando?.kind ?? 'exame'}>
                {TIPOS_DE_SALA.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ordem" error={erros?.sort_order}>
              <Input
                name="sort_order"
                type="number"
                min="0"
                defaultValue={editando?.sort_order ?? salas.length + 1}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input
                type="checkbox"
                name="is_active"
                value="on"
                defaultChecked={editando?.is_active ?? true}
              />
              <span>
                Sala em uso
                <span className="ml-1 text-xs text-slate-500">
                  Desmarque para tirá-la do quadro de filas sem apagar o histórico.
                </span>
              </span>
            </label>

            <div className="flex items-end gap-2 md:col-span-2">
              <Button type="submit" loading={pending}>
                {editando ? 'Salvar sala' : 'Criar sala'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditando(null);
                  setCriando(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        <Table>
          <thead>
            <tr>
              <Th>Sala</Th>
              <Th>Código</Th>
              <Th>Tipo</Th>
              <Th>Ordem</Th>
              <Th>Situação</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {salas.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td className="font-medium">{s.name}</Td>
                <Td className="font-mono text-xs text-slate-500">{s.code}</Td>
                <Td className="text-slate-600">{ROTULO_TIPO[s.kind] ?? s.kind}</Td>
                <Td className="text-slate-500">{s.sort_order}</Td>
                <Td>
                  {s.is_active ? (
                    <Badge color="#22C55E">em uso</Badge>
                  ) : (
                    <Badge color="#94A3B8">desativada</Badge>
                  )}
                  {s.current_attendance_id && (
                    <span className="ml-2 text-xs text-amber-600">com paciente</span>
                  )}
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCriando(false);
                      setEditando(s);
                    }}
                  >
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

// =====================================================================
// Tipos de exame
// =====================================================================

export function CadastroDeExames({
  exames,
  salas,
}: {
  exames: ExameCadastrado[];
  salas: SalaCadastrada[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarTipoDeExame,
    null,
  );
  const [editando, setEditando] = useState<ExameCadastrado | null>(null);
  const [criando, setCriando] = useState(false);
  const erros = state && !state.ok ? state.fieldErrors : undefined;

  const emEdicao = criando || editando !== null;
  const chave = editando?.id ?? (criando ? 'novo' : 'fechado');
  const salasDisponiveis = salas.filter((s) => s.is_active);
  const nomeDaSala = (id: string | null) => salas.find((s) => s.id === id)?.name ?? null;

  // Exame novo sempre ocupa sala: os que não ocupam são os que o médico
  // responde ou que são feitos fora, e esses já existem.
  const ocupaSala = editando ? editando.ocupa_sala : true;
  const codigoTravado = editando ? CODIGOS_DO_SISTEMA.has(editando.code) : false;

  return (
    <Card>
      <CardHeader
        title="Tipos de exame"
        description="O que a clínica realiza, quanto custa e em qual sala acontece."
        action={
          !emEdicao && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="h-4 w-4" /> Novo exame
            </Button>
          )
        }
      />
      <CardBody>
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        {emEdicao && (
          <form
            action={formAction}
            className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-6"
            key={chave}
          >
            <input type="hidden" name="id" value={editando?.id ?? ''} />
            <Field label="Nome do exame" error={erros?.name} className="md:col-span-3">
              <Input name="name" defaultValue={editando?.name ?? ''} autoFocus />
            </Field>
            <Field
              label="Código"
              error={erros?.code}
              hint={codigoTravado ? 'Usado pelo sistema' : undefined}
            >
              <Input
                name="code"
                defaultValue={editando?.code ?? ''}
                placeholder="DINAMO_PAL"
                readOnly={codigoTravado}
              />
            </Field>
            <Field label="Valor" error={erros?.price}>
              <Input
                name="price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editando?.price ?? 0}
              />
            </Field>
            <Field label="Duração (min)" error={erros?.average_minutes}>
              <Input
                name="average_minutes"
                type="number"
                min="0"
                defaultValue={editando?.average_minutes ?? 15}
              />
            </Field>

            <Field
              label="Sala"
              error={erros?.default_room_id}
              className="md:col-span-3"
              hint={
                ocupaSala
                  ? 'Trocar aqui move o exame de fila; a sala antiga para de chamá-lo.'
                  : 'Este exame não é chamado em sala: o médico responde ou é feito fora.'
              }
            >
              <Select
                name="default_room_id"
                defaultValue={editando?.default_room_id ?? ''}
                disabled={!ocupaSala}
              >
                <option value="">Sem sala</option>
                {salasDisponiveis.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ordem" error={erros?.sort_order}>
              <Input
                name="sort_order"
                type="number"
                min="0"
                defaultValue={editando?.sort_order ?? exames.length + 1}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm md:col-span-4">
              <input
                type="checkbox"
                name="is_active"
                value="on"
                defaultChecked={editando?.is_active ?? true}
              />
              <span>
                Exame oferecido
                <span className="ml-1 text-xs text-slate-500">
                  Desmarque para tirá-lo da recepção sem apagar o que já foi feito.
                </span>
              </span>
            </label>

            <div className="flex items-end gap-2 md:col-span-2">
              <Button type="submit" loading={pending}>
                {editando ? 'Salvar exame' : 'Criar exame'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditando(null);
                  setCriando(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        <Table>
          <thead>
            <tr>
              <Th>Exame</Th>
              <Th>Código</Th>
              <Th>Sala</Th>
              <Th>Valor</Th>
              <Th>Situação</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {exames.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td className="font-medium">{e.name}</Td>
                <Td className="font-mono text-xs text-slate-500">{e.code}</Td>
                <Td className="text-slate-600">
                  {e.ocupa_sala ? (
                    (nomeDaSala(e.default_room_id) ?? (
                      <span className="text-amber-600">sem sala</span>
                    ))
                  ) : (
                    <span className="text-slate-400">não usa sala</span>
                  )}
                </Td>
                <Td>{formatMoney(Number(e.price ?? 0))}</Td>
                <Td>
                  {e.is_active ? (
                    <Badge color="#22C55E">oferecido</Badge>
                  ) : (
                    <Badge color="#94A3B8">desativado</Badge>
                  )}
                </Td>
                <Td>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCriando(false);
                      setEditando(e);
                    }}
                  >
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
