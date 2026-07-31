'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import type { ActionResult } from '@/lib/action-result';
import type { Company } from '@/types/entities';

type Action = (
  prev: ActionResult<Company> | null,
  formData: FormData,
) => Promise<ActionResult<Company>>;

export function CompanyForm({ action, company }: { action: Action; company?: Company | null }) {
  const [state, formAction, pending] = useActionState<ActionResult<Company> | null, FormData>(
    action,
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

      <Card>
        <CardHeader title="Dados cadastrais" />
        <CardBody className="grid gap-4 md:grid-cols-3">
          <Field label="Razao social" required error={errors?.legal_name} className="md:col-span-2">
            <Input name="legal_name" defaultValue={company?.legal_name ?? ''} required />
          </Field>
          <Field label="Nome fantasia" error={errors?.trade_name}>
            <Input name="trade_name" defaultValue={company?.trade_name ?? ''} />
          </Field>
          <Field label="CNPJ" error={errors?.document}>
            <Input name="document" defaultValue={company?.document ?? ''} inputMode="numeric" />
          </Field>
          <Field label="Inscricao estadual">
            <Input name="state_registration" defaultValue="" />
          </Field>
          <Field label="Segmento" error={errors?.segment}>
            <Input name="segment" defaultValue={company?.segment ?? ''} />
          </Field>
          <Field label="Situacao" error={errors?.situation}>
            <Select name="situation" defaultValue={company?.situation ?? 'ativa'}>
              <option value="ativa">Ativa</option>
              <option value="prospect">Prospect</option>
              <option value="inativa">Inativa</option>
              <option value="bloqueada">Bloqueada</option>
            </Select>
          </Field>
          <Field label="Responsavel" error={errors?.responsible_name}>
            <Input name="responsible_name" defaultValue={company?.responsible_name ?? ''} />
          </Field>
          <Field label="Cargo do responsavel" error={errors?.responsible_role}>
            <Input name="responsible_role" defaultValue={company?.responsible_role ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contato e endereco" />
        <CardBody className="grid gap-4 md:grid-cols-3">
          <Field label="Telefone" error={errors?.phone}>
            <Input name="phone" defaultValue={company?.phone ?? ''} />
          </Field>
          <Field label="WhatsApp" error={errors?.whatsapp}>
            <Input name="whatsapp" defaultValue={company?.whatsapp ?? ''} />
          </Field>
          <Field label="Site" error={errors?.website}>
            <Input name="website" defaultValue="" />
          </Field>
          <Field label="E-mail geral" error={errors?.email}>
            <Input type="email" name="email" defaultValue={company?.email ?? ''} />
          </Field>
          <Field label="E-mail administrativo" error={errors?.email_admin}>
            <Input type="email" name="email_admin" defaultValue={company?.email_admin ?? ''} />
          </Field>
          <Field label="E-mail comercial" error={errors?.email_commercial}>
            <Input
              type="email"
              name="email_commercial"
              defaultValue={company?.email_commercial ?? ''}
            />
          </Field>
          <Field label="E-mail financeiro" error={errors?.email_financial}>
            <Input type="email" name="email_financial" defaultValue="" />
          </Field>
          <Field label="CEP" error={errors?.zip_code}>
            <Input name="zip_code" defaultValue="" />
          </Field>
          <Field label="Logradouro" error={errors?.street}>
            <Input name="street" defaultValue="" />
          </Field>
          <Field label="Numero">
            <Input name="number" defaultValue="" />
          </Field>
          <Field label="Complemento">
            <Input name="complement" defaultValue="" />
          </Field>
          <Field label="Bairro">
            <Input name="district" defaultValue="" />
          </Field>
          <Field label="Cidade" error={errors?.city}>
            <Input name="city" defaultValue={company?.city ?? ''} />
          </Field>
          <Field label="UF" error={errors?.state}>
            <Input name="state" maxLength={2} defaultValue={company?.state ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Comunicacao comercial"
          description="Somente empresas com autorizacao entram nas campanhas. Dados clinicos nunca sao usados."
        />
        <CardBody className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allow_marketing"
              defaultChecked={company?.allow_marketing ?? false}
            />
            Autorizo receber comunicacoes comerciais
          </label>
          <Field label="Base legal / origem do consentimento" error={errors?.legal_basis}>
            <Input
              name="legal_basis"
              defaultValue={company?.legal_basis ?? ''}
              placeholder="Ex.: relacionamento contratual, consentimento em formulario"
            />
          </Field>
          <Field label="Observacoes" error={errors?.notes}>
            <Textarea name="notes" defaultValue={company?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {company ? 'Salvar alteracoes' : 'Cadastrar empresa'}
        </Button>
        <Link href="/empresas">
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </Link>
      </div>
    </form>
  );
}
