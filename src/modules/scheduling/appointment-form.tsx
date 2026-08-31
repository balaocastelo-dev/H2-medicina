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
import { BuscaSelecao } from '@/components/ui/busca-selecao';
import { formatCPF } from '@/lib/format';
import type { ActionResult } from '@/lib/action-result';
import type { Appointment } from '@/types/entities';

interface PatientOption {
  id: string;
  full_name: string;
  cpf: string | null;
  company_id: string | null;
}

export interface ValoresIniciais {
  id?: string;
  patient_id?: string;
  company_id?: string | null;
  /** AAAA-MM-DDTHH:MM, no fuso da clinica. */
  scheduled_at?: string;
  attendance_kind?: string;
  priority?: string;
  professional_id?: string | null;
  exam_type_ids?: string[];
  notes?: string | null;
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
  iniciais,
  rotuloBotao = 'Criar agendamento',
  intervaloMinutos = 10,
}: {
  action: Action;
  patients: PatientOption[];
  companies: { id: string; label: string }[];
  examTypes: { id: string; name: string; code: string; average_minutes: number }[];
  professionals: { id: string; full_name: string }[];
  /** Preenchido na edicao. */
  iniciais?: ValoresIniciais;
  rotuloBotao?: string;
  /**
   * Passo do relogio, em minutos.
   * "opcao de agendamento a cada 10 minutos" — configuravel em
   * Configuracoes -> Agenda, porque a clinica ja pediu 5 e depois 10.
   */
  intervaloMinutos?: number;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<Appointment> | null, FormData>(
    action,
    null,
  );
  const [patientId, setPatientId] = useState(iniciais?.patient_id ?? '');
  const [selectedExams, setSelectedExams] = useState<string[]>(iniciais?.exam_type_ids ?? []);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const patient = patients.find((p) => p.id === patientId);

  /**
   * Escolher o paciente ja traz a empresa dele.
   *
   * A recepcao cadastra o vinculo uma vez, no paciente; repetir a escolha a
   * cada agendamento so cria oportunidade de errar.
   *
   * Guardamos apenas a escolha manual, e a empresa em uso e calculada no
   * render. Fosse um estado sincronizado por efeito, haveria um instante em
   * que a tela mostra a empresa do paciente anterior.
   */
  const [empresaManual, setEmpresaManual] = useState<string | null>(
    iniciais?.company_id ?? null,
  );
  const companyId = empresaManual ?? patient?.company_id ?? '';
  const veioDoPaciente = empresaManual === null && !!patient?.company_id;

  const opcoesPacientes = patients.map((p) => ({
    id: p.id,
    rotulo: p.full_name,
    detalhe: p.cpf ? formatCPF(p.cpf) : null,
    busca: p.cpf ?? '',
  }));

  const opcoesEmpresas = companies.map((c) => ({ id: c.id, rotulo: c.label }));

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

      {iniciais?.id && <input type="hidden" name="id" value={iniciais.id} />}

      <Card>
        <CardHeader title="Paciente e empresa" />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Paciente" required error={errors?.patient_id}>
            <BuscaSelecao
              name="patient_id"
              opcoes={opcoesPacientes}
              valor={patientId}
              onChange={(id) => {
                setPatientId(id);
                // Paciente novo volta a mandar na empresa.
                setEmpresaManual(null);
              }}
              placeholder="Buscar por nome ou CPF"
              vazioRotulo="Nenhum paciente com esse nome ou CPF"
              required
            />
          </Field>
          <Field
            label="Empresa"
            error={errors?.company_id}
            hint={
              veioDoPaciente ? 'Puxada do cadastro do paciente' : 'Busque pelo nome da empresa'
            }
          >
            <BuscaSelecao
              name="company_id"
              opcoes={opcoesEmpresas}
              valor={companyId}
              onChange={(id) => setEmpresaManual(id)}
              placeholder="Sem empresa"
              vazioRotulo="Nenhuma empresa com esse nome"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Data e características" />
        <CardBody className="grid gap-4 md:grid-cols-3">
          <Field
            label="Data e hora"
            required
            error={errors?.scheduled_at}
            hint={`Horários de ${intervaloMinutos} em ${intervaloMinutos} minutos`}
          >
            <Input
              type="datetime-local"
              name="scheduled_at"
              required
              step={Math.max(1, intervaloMinutos) * 60}
              defaultValue={iniciais?.scheduled_at ?? ''}
            />
          </Field>
          <Field label="Prioridade" error={errors?.priority}>
            <Select name="priority" defaultValue={iniciais?.priority ?? 'normal'}>
              <option value="normal">Normal</option>
              <option value="prioritario">Prioritário</option>
              <option value="encaixe">Encaixe</option>
            </Select>
          </Field>
          <Field label="Tipo de atendimento" error={errors?.attendance_kind}>
            <Select name="attendance_kind" defaultValue={iniciais?.attendance_kind ?? 'admissional'}>
              <option value="admissional">Admissional</option>
              <option value="periodico">Periódico</option>
              <option value="demissional">Demissional</option>
              <option value="mudanca_funcao">Mudança de função</option>
              <option value="retorno_trabalho">Retorno ao trabalho</option>
              <option value="consulta">Consulta</option>
              <option value="outro">Outro</option>
            </Select>
          </Field>
          <Field label="Profissional" error={errors?.professional_id} className="md:col-span-3">
            <Select name="professional_id" defaultValue={iniciais?.professional_id ?? ''}>
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
        <CardHeader title="Exames previstos" />
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
              <span>{e.name}</span>
            </label>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Observações" />
        <CardBody>
          <Textarea name="notes" defaultValue={iniciais?.notes ?? ''} />
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {rotuloBotao}
        </Button>
        <Link href="/agenda">
          <Button type="button" variant="outline">
            Voltar
          </Button>
        </Link>
      </div>
    </form>
  );
}
