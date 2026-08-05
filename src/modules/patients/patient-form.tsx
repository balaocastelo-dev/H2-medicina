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
import type { Patient } from '@/types/entities';

export interface CompanyOption {
  id: string;
  label: string;
}

type Action = (
  prev: ActionResult<Patient> | null,
  formData: FormData,
) => Promise<ActionResult<Patient>>;

export function PatientForm({
  action,
  patient,
  companies,
}: {
  action: Action;
  patient?: Patient | null;
  companies: CompanyOption[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult<Patient> | null, FormData>(
    action,
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const duplicateWarning = state && !state.ok && state.error.includes('semelhantes');

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

      <Card>
        <CardHeader title="Identificacao" />
        <CardBody className="grid gap-4 md:grid-cols-3">
          <Field label="Nome completo" required error={errors?.full_name} className="md:col-span-2">
            <Input name="full_name" defaultValue={patient?.full_name ?? ''} required />
          </Field>
          <Field label="Nome social" error={errors?.social_name}>
            <Input name="social_name" defaultValue={patient?.social_name ?? ''} />
          </Field>
          <Field label="CPF" error={errors?.cpf} hint="Somente numeros">
            <Input
              name="cpf"
              defaultValue={patient?.cpf ?? ''}
              inputMode="numeric"
              maxLength={14}
            />
          </Field>
          <Field label="RG" error={errors?.rg}>
            <Input name="rg" defaultValue={patient?.rg ?? ''} />
          </Field>
          <Field label="Data de nascimento" error={errors?.birth_date}>
            <Input type="date" name="birth_date" defaultValue={patient?.birth_date ?? ''} />
          </Field>
          <Field label="Sexo" error={errors?.gender}>
            <Select name="gender" defaultValue={patient?.gender ?? 'nao_informado'}>
              <option value="nao_informado">Não informado</option>
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contato" />
        <CardBody className="grid gap-4 md:grid-cols-3">
          <Field label="Telefone" error={errors?.phone}>
            <Input name="phone" defaultValue={patient?.phone ?? ''} />
          </Field>
          <Field label="WhatsApp" error={errors?.whatsapp}>
            <Input name="whatsapp" defaultValue={patient?.whatsapp ?? ''} />
          </Field>
          <Field label="E-mail" error={errors?.email}>
            <Input type="email" name="email" defaultValue={patient?.email ?? ''} />
          </Field>
          <Field label="CEP" error={errors?.zip_code}>
            <Input name="zip_code" defaultValue={patient?.zip_code ?? ''} />
          </Field>
          <Field label="Logradouro" error={errors?.street} className="md:col-span-2">
            <Input name="street" defaultValue={patient?.street ?? ''} />
          </Field>
          <Field label="Numero" error={errors?.number}>
            <Input name="number" defaultValue={patient?.number ?? ''} />
          </Field>
          <Field label="Complemento">
            <Input name="complement" defaultValue={''} />
          </Field>
          <Field label="Bairro" error={errors?.district}>
            <Input name="district" defaultValue={patient?.district ?? ''} />
          </Field>
          <Field label="Cidade" error={errors?.city}>
            <Input name="city" defaultValue={patient?.city ?? ''} />
          </Field>
          <Field label="UF" error={errors?.state}>
            <Input name="state" maxLength={2} defaultValue={patient?.state ?? ''} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Vinculo profissional" />
        <CardBody className="grid gap-4 md:grid-cols-4">
          <Field label="Empresa" error={errors?.company_id} className="md:col-span-2">
            <Select name="company_id" defaultValue={patient?.company_id ?? ''}>
              <option value="">Sem vinculo</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cargo" error={errors?.job_title}>
            <Input name="job_title" defaultValue={patient?.job_title ?? ''} />
          </Field>
          <Field label="Setor" error={errors?.department}>
            <Input name="department" defaultValue={patient?.department ?? ''} />
          </Field>
          <Field label="Matricula" error={errors?.registration_number}>
            <Input name="registration_number" defaultValue={patient?.registration_number ?? ''} />
          </Field>
          <Field label="Contato de emergencia">
            <Input
              name="emergency_contact_name"
              defaultValue={patient?.emergency_contact_name ?? ''}
            />
          </Field>
          <Field label="Telefone de emergencia">
            <Input
              name="emergency_contact_phone"
              defaultValue={patient?.emergency_contact_phone ?? ''}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Observacoes" />
        <CardBody>
          <Textarea name="notes" defaultValue={patient?.notes ?? ''} rows={3} />
        </CardBody>
      </Card>

      {duplicateWarning && (
        <label className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <input type="checkbox" name="confirmar_duplicidade" value="sim" />
          Confirmo que devo cadastrar mesmo havendo registro semelhante.
        </label>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" loading={pending}>
          {patient ? 'Salvar alteracoes' : 'Cadastrar paciente'}
        </Button>
        <Link href="/pacientes">
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </Link>
      </div>
    </form>
  );
}
