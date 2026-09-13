'use client';

import { useActionState, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Textarea,
} from '@/components/ui';
import { CATEGORIAS, SEM_RISCO_RELEVANTE } from '@/modules/documents/riscos';
import { excluirPerfilDeRisco, salvarPerfilDeRisco } from './empresa-actions';
import type { ActionResult } from '@/lib/action-result';

export interface PerfilNaTela {
  id: string;
  cargo: string | null;
  fisicos: string | null;
  quimicos: string | null;
  biologicos: string | null;
  ergonomicos: string | null;
  acidentes: string | null;
}

/**
 * Perigos e fatores de risco por cargo.
 *
 * O bloco e obrigatorio no A.S.O. pela NR-7. Sem perfil cadastrado, o
 * documento sai com "Não foram encontradas fontes significativas do risco"
 * nas cinco categorias — correto, mas generico demais para uma empresa que
 * tem risco de verdade.
 */
export function PainelDeRiscos({
  companyId,
  perfis,
  podeEditar,
}: {
  companyId: string;
  perfis: PerfilNaTela[];
  podeEditar: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    salvarPerfilDeRisco,
    null,
  );
  const [editando, setEditando] = useState<PerfilNaTela | null>(null);
  const [criando, setCriando] = useState(false);
  const [removendo, iniciarRemocao] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const aberto = criando || !!editando;
  const geral = perfis.find((p) => !p.cargo);

  return (
    <Card>
      <CardHeader
        title="Perigos e fatores de risco"
        description="Impressos no A.S.O. de cada funcionário, conforme a NR-7"
        action={
          podeEditar && !aberto ? (
            <Button
              size="sm"
              onClick={() => {
                setEditando(null);
                setCriando(true);
              }}
            >
              <Plus className="h-4 w-4" /> Novo perfil
            </Button>
          ) : null
        }
      />
      <CardBody>
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
        {aviso && <Alert variant="info">{aviso}</Alert>}

        {!geral && perfis.length > 0 && (
          <Alert variant="warning">
            Nenhum perfil geral cadastrado. Cargos sem perfil próprio saem no A.S.O. com
            &quot;{SEM_RISCO_RELEVANTE}&quot; em todas as categorias.
          </Alert>
        )}

        {aberto && (
          <form action={formAction} className="mb-4 space-y-3 rounded-lg border border-slate-200 p-4">
            <input type="hidden" name="company_id" value={companyId} />
            <input type="hidden" name="id" value={editando?.id ?? ''} />

            <Field
              label="Cargo"
              hint="Deixe em branco para valer como perfil geral da empresa"
            >
              <Input
                name="cargo"
                defaultValue={editando?.cargo ?? ''}
                placeholder="Ex.: Motorista/Entregador"
              />
            </Field>

            {CATEGORIAS.map(({ chave, rotulo }) => (
              <Field key={chave} label={rotulo}>
                <Textarea
                  name={chave}
                  rows={2}
                  defaultValue={(editando?.[chave] as string | null) ?? ''}
                  placeholder={SEM_RISCO_RELEVANTE}
                />
              </Field>
            ))}

            <div className="flex gap-2">
              <Button type="submit" loading={pending}>
                Salvar perfil
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCriando(false);
                  setEditando(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {perfis.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">
            Nenhum perfil cadastrado. O A.S.O. sai com a frase padrão nas cinco categorias.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {perfis.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.cargo ?? 'Todos os cargos'}
                      {!p.cargo && (
                        <Badge color="#64748B" className="ml-2">
                          perfil geral
                        </Badge>
                      )}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {CATEGORIAS.filter(({ chave }) => p[chave]).map(({ chave, rotulo }) => (
                        <li key={chave} className="text-xs text-slate-600">
                          <span className="font-medium">{rotulo}:</span> {p[chave]}
                        </li>
                      ))}
                      {CATEGORIAS.every(({ chave }) => !p[chave]) && (
                        <li className="text-xs text-slate-400">Sem risco relevante informado.</li>
                      )}
                    </ul>
                  </div>

                  {podeEditar && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCriando(false);
                          setEditando(p);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={removendo}
                        onClick={() => {
                          if (!window.confirm(`Remover o perfil de ${p.cargo ?? 'todos os cargos'}?`)) {
                            return;
                          }
                          iniciarRemocao(async () => {
                            const r = await excluirPerfilDeRisco(p.id, companyId);
                            setAviso(r.ok ? (r.message ?? 'Removido.') : r.error);
                          });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
