'use client';

import { useActionState, useState } from 'react';
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
import { formatCPF } from '@/lib/format';
import type { ActionResult } from '@/lib/action-result';
import type { Appointment } from '@/types/entities';

interface PatientOption {
  id: string;
  full_name: string;
  cpf: string | null;
  company_id: string | null;
}

type Action = (
  prev: ActionResult<Appointment> | null,
  formData: FormData,
) => Promise<ActionResult<Appointment>>;

export function AppointmentForm({
  action,
  patients,
  companies,
  examTypes,
  professionals,
}: {
  action: Action;
  patients: PatientOption[];
  companies: { id: string; label: string }[];
  examTypes: { id: string; name: string; code: string; average_minutes: number }[];
  professionals: { id: string; full_name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionResult<Appointment> | null, FormData>(
    action,
    null,
  );
  const [patientId, setPatientId] = useState('');
  const [selectedExams, setSelectedExams] = useState<string[]>([]);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const patient = patients.find((p) => p.id === patientId);
  const estimated = examTypes
    .filter((e) => selectedExams.includes(e.id))
    .reduce((sum, e) => sum + e.average_minutes, 0);

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

      <Card>
        <CardHeader title="Paciente e empresa" />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Paciente" required error={errors?.patient_id}>
            <Select
              name="patient_id"
              required
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            >
              <option value="">Selecione</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.cpf ? ` — ${formatCPF(p.cpf)}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Empresa" error={errors?.company_id}>
            <Select name="company_id" defaultValue={patient?.company_id ?? ''} key={patientId}>
              <option value="">Sem empresa</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Data e caracteristicas" />
        <CardBody className="grid gap-4 md:grid-cols-4">
          <Field
            label="Data e hora"
            required
            error={errors?.scheduled_at}
            className="md:col-span-2"
          >
            <Input type="datetime-local" name="scheduled_at" required />
          </Field>
          <Field label="Duração (min)" error={errors?.duration_minutes}>
            <Input
              type="number"
              name="duration_minutes"
              min={5}
              max={480}
              defaultValue={estimated || 30}
              key={estimated}
            />
          </Field>
          <Field label="Prioridade" error={errors?.priority}>
            <Select name="priority" defaultValue="normal">
              <option value="normal">Normal</option>
              <option value="prioritario">Prioritário</option>
              <option value="encaixe">Encaixe</option>
            </Select>
          </Field>
          <Field
            label="Tipo de atendimento"
            error={errors?.attendance_kind}
            className="md:col-span-2"
          >
            <Select name="attendance_kind" defaultValue="admissional">
              <option value="admissional">Admissional</option>
              <option value="periodico">Periodico</option>
              <option value="demissional">Demissional</option>
              <option value="mudanca_funcao">Mudanca de função</option>
              <option value="retorno_trabalho">Retorno ao trabalho</option>
              <option value="consulta">Consulta</option>
              <option value="outro">Outro</option>
            </Select>
          </Field>
          <Field label="Profissional" error={errors?.professional_id} className="md:col-span-2">
            <Select name="professional_id" defaultValue="">
              <option value="">A definir</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Exames previstos"
          description={estimated ? `Tempo estimado: ${estimated} minutos` : undefined}
        />
        <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {examTypes.length === 0 && (
            <p className="text-sm text-slate-500">Nenhum tipo de exame cadastrado.</p>
          )}
          {examTypes.map((e) => (
            <label
              key={e.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                name="exam_type_ids"
                value={e.id}
                checked={selectedExams.includes(e.id)}
                onChange={(ev) =>
                  setSelectedExams((prev) =>
                    ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                  )
                }
              />
              <span>
                {e.name}
                <span className="ml-1 text-xs text-slate-400">{e.average_minutes}min</span>
              </span>
            </label>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Observacoes" />
        <CardBody>
          <Textarea name="notes" />
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Criar agendamento
        </Button>
        <Link href="/agenda">
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </Link>
      </div>
    </form>
  );
}
