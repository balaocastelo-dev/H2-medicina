'use client';

import { useActionState, useEffect } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { atualizarUsuario } from '@/modules/users/medicos-actions';
import type { ActionResult } from '@/lib/action-result';
import type { UserRow } from './user-manager';

/**
 * Edicao dos dados de um usuario.
 *
 * O e-mail e o login: mudar aqui muda tambem no Auth. E o caminho de quem
 * foi pre-cadastrado com endereco provisorio e agora vai usar o proprio.
 */
export function EditarUsuario({
  usuario,
  aoFechar,
}: {
  usuario: UserRow;
  aoFechar: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    atualizarUsuario,
    null,
  );
  const erros = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) aoFechar();
  }, [state, aoFechar]);

  return (
    <Card>
      <CardHeader
        title={`Editar ${usuario.full_name || 'usuário'}`}
        description="Nome, contato e registro no conselho"
        action={
          <Button variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
        }
      />
      <CardBody>
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        <form action={formAction} className="grid gap-4 md:grid-cols-3">
          <input type="hidden" name="id" value={usuario.id} />

          <Field label="Nome completo" error={erros?.full_name} className="md:col-span-2" required>
            <Input name="full_name" defaultValue={usuario.full_name} />
          </Field>
          <Field label="E-mail de acesso" error={erros?.email} required>
            <Input type="email" name="email" defaultValue={usuario.email ?? ''} />
          </Field>
          <Field label="Telefone">
            <Input name="phone" defaultValue={usuario.phone ?? ''} />
          </Field>
          <Field label="Cargo">
            <Input name="job_title" defaultValue={usuario.job_title ?? ''} />
          </Field>
          <Field label="Conselho">
            <Input name="council_type" placeholder="CRM" defaultValue={usuario.council_type ?? ''} />
          </Field>
          <Field label="Número do registro">
            <Input name="council_number" defaultValue={usuario.council_number ?? ''} />
          </Field>
          <Field label="UF do registro">
            <Input name="council_state" maxLength={2} defaultValue={usuario.council_state ?? ''} />
          </Field>
          <Field label="RQE" hint="Registro de especialista, se houver">
            <Input name="rqe" defaultValue={usuario.rqe ?? ''} />
          </Field>

          <div className="flex items-end md:col-span-3">
            <Button type="submit" loading={pending}>
              Salvar alterações
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
