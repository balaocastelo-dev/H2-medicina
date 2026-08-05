'use client';

import { useActionState, useState, useTransition } from 'react';
import { KeyRound, Lock, Plus, Unlock, UserPlus } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, Table, Td, Th,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { changeUserRole, createUser, resetUserPassword, toggleUserBlock } from '@/modules/users/actions';
import type { ActionResult } from '@/lib/action-result';

export interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  council_type: string | null;
  council_number: string | null;
  council_state: string | null;
  is_active: boolean;
  blocked_at: string | null;
  last_sign_in_at: string | null;
  user_roles: { roles: { name: string; code: string } | null }[];
}

const PAPEIS = [
  { code: 'administrativo', nome: 'Administrativo', desc: 'Acesso total ao sistema' },
  { code: 'medico_examinador', nome: 'Medico e examinador', desc: 'Triagem, exames e consulta' },
  { code: 'atendimento', nome: 'Atendimento e recepcao', desc: 'Recepcao, filas e cobrancas' },
];

function senhaForte(): string {
  const letras = 'abcdefghijkmnpqrstuvwxyz';
  const maius = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  const simb = '!@#$%';
  const pick = (s: string, n: number) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  return (pick(maius, 2) + pick(letras, 4) + pick(nums, 3) + pick(simb, 1))
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export function UserManager({
  users,
  podeGerenciarPapeis,
  meuId,
}: {
  users: UserRow[];
  podeGerenciarPapeis: boolean;
  meuId: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [papel, setPapel] = useState('atendimento');
  const [senha, setSenha] = useState(senhaForte());
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createUser,
    null,
  );
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [running, startTransition] = useTransition();

  const erros = state && !state.ok ? state.fieldErrors : undefined;
  const ehMedico = papel === 'medico_examinador';

  const rodar = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, texto: r.ok ? (r.message ?? 'Feito.') : r.error });
    });

  return (
    <div className="space-y-4">
      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.texto}</Alert>}

      <Card>
        <CardHeader
          title="Novo usuario"
          description="Cria a conta de acesso e ja vincula ao papel escolhido"
          action={
            <Button variant={aberto ? 'outline' : 'primary'} onClick={() => setAberto((v) => !v)}>
              {aberto ? 'Fechar' : (<><Plus className="h-4 w-4" /> Adicionar usuario</>)}
            </Button>
          }
        />

        {aberto && (
          <CardBody>
            <form action={formAction} className="space-y-4">
              {state?.ok && <Alert variant="success">{state.message}</Alert>}
              {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Nome completo" required error={erros?.full_name} className="md:col-span-2">
                  <Input name="full_name" required placeholder="Ex.: Maria Souza Andrade" />
                </Field>
                <Field label="Cargo" error={erros?.job_title} hint="Aparece no topo da tela">
                  <Input name="job_title" placeholder="Ex.: Recepcionista" />
                </Field>

                <Field
                  label="Como quer ser chamado(a)"
                  error={erros?.treatment}
                  hint="Usado na saudacao ao entrar no sistema"
                >
                  <Select name="treatment" defaultValue="">
                    <option value="">Somente o nome</option>
                    <option value="Dra.">Dra.</option>
                    <option value="Dr.">Dr.</option>
                    <option value="Sra.">Sra.</option>
                    <option value="Sr.">Sr.</option>
                  </Select>
                </Field>

                <Field label="E-mail de acesso" required error={erros?.email}>
                  <Input name="email" type="email" required placeholder="pessoa@empresa.com.br" />
                </Field>
                <Field label="Telefone" error={erros?.phone}>
                  <Input name="phone" placeholder="(11) 90000-0000" />
                </Field>
                <Field label="Senha inicial" required error={erros?.password}>
                  <div className="flex gap-2">
                    <Input
                      name="password"
                      required
                      minLength={8}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="font-mono"
                    />
                    <Button type="button" variant="outline" onClick={() => setSenha(senhaForte())}>
                      Gerar
                    </Button>
                  </div>
                </Field>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Papel no sistema</p>
                <div className="grid gap-2 md:grid-cols-3">
                  {PAPEIS.map((p) => (
                    <label
                      key={p.code}
                      className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
                        papel === p.code
                          ? 'border-transparent ring-2 ring-brand bg-slate-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role_code"
                        value={p.code}
                        checked={papel === p.code}
                        onChange={() => setPapel(p.code)}
                        className="sr-only"
                      />
                      <span className="block font-medium">{p.nome}</span>
                      <span className="block text-xs text-slate-500">{p.desc}</span>
                    </label>
                  ))}
                </div>
              </div>

              {ehMedico && (
                <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
                  <Field label="Conselho" error={erros?.council_type}>
                    <Select name="council_type" defaultValue="CRM">
                      <option value="CRM">CRM</option>
                      <option value="COREN">COREN</option>
                      <option value="CRF">CRF</option>
                      <option value="CRP">CRP</option>
                    </Select>
                  </Field>
                  <Field label="Numero do registro" required error={erros?.council_number}>
                    <Input name="council_number" placeholder="123456" />
                  </Field>
                  <Field label="UF do conselho" error={erros?.council_state}>
                    <Input name="council_state" maxLength={2} placeholder="SP" />
                  </Field>
                  <p className="text-xs text-slate-500 md:col-span-3">
                    Esses dados saem impressos no atestado e nos demais documentos assinados.
                  </p>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="must_change_password" defaultChecked />
                Exigir troca de senha no primeiro acesso
              </label>

              <Button type="submit" loading={pending}>
                <UserPlus className="h-4 w-4" /> Criar usuario
              </Button>
            </form>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Usuarios" description={`${users.length} conta(s) nesta empresa`} />
        {users.length === 0 ? (
          <EmptyState title="Nenhum usuario" description="Crie o primeiro acesso acima." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>E-mail</Th>
                <Th>Papel</Th>
                <Th>Situacao</Th>
                <Th>Ultimo acesso</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const papelAtual = u.user_roles[0]?.roles?.code ?? '';
                const bloqueado = !!u.blocked_at;
                const souEu = u.id === meuId;
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="font-medium">{u.full_name || '—'}</span>
                      {souEu && <span className="ml-2 text-xs text-slate-400">(voce)</span>}
                      <p className="text-xs text-slate-500">
                        {[u.job_title, u.council_number ? `${u.council_type} ${u.council_number}/${u.council_state ?? ''}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </Td>
                    <Td className="text-slate-600">{u.email ?? '—'}</Td>
                    <Td>
                      {podeGerenciarPapeis && !souEu ? (
                        <Select
                          className="h-8 w-auto text-xs"
                          value={papelAtual}
                          disabled={running}
                          onChange={(e) => rodar(() => changeUserRole(u.id, e.target.value))}
                        >
                          {PAPEIS.map((p) => (
                            <option key={p.code} value={p.code}>
                              {p.nome}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-sm">{u.user_roles[0]?.roles?.name ?? '—'}</span>
                      )}
                    </Td>
                    <Td>
                      <Badge color={bloqueado ? '#EF4444' : u.is_active ? '#22C55E' : '#9CA3AF'}>
                        {bloqueado ? 'bloqueado' : u.is_active ? 'ativo' : 'inativo'}
                      </Badge>
                    </Td>
                    <Td className="text-slate-500">{formatDateTime(u.last_sign_in_at)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={running}
                          onClick={() => {
                            const nova = window.prompt('Nova senha (minimo 8 caracteres):', senhaForte());
                            if (nova) rodar(() => resetUserPassword(u.id, nova));
                          }}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        {!souEu && (
                          <Button
                            size="sm"
                            variant={bloqueado ? 'success' : 'danger'}
                            loading={running}
                            onClick={() => {
                              if (bloqueado) return rodar(() => toggleUserBlock(u.id, false));
                              const motivo = window.prompt('Motivo do bloqueio:');
                              if (motivo !== null) rodar(() => toggleUserBlock(u.id, true, motivo));
                            }}
                          >
                            {bloqueado ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
