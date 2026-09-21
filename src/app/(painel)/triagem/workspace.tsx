'use client';

import { useActionState, useState, useTransition } from 'react';
import { PhoneCall } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Textarea,
} from '@/components/ui';
import { calcAge, elapsedFrom, formatTime } from '@/lib/format';
import { saveTriage } from '@/modules/clinical/actions';
import { chamarParaTriagem, repetirChamadaDaTriagem } from '@/modules/clinical/triagem-actions';
import { FichaDeExameForm } from '@/modules/clinical/ficha-de-exame';
import type { ActionResult } from '@/lib/action-result';
import type { ExameDeBancada, TriageRow } from './types';

export function TriageWorkspace({
  rows,
  bancada,
  salas,
}: {
  rows: TriageRow[];
  bancada: ExameDeBancada[];
  salas: { id: string; name: string }[];
}) {
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const examesDoPaciente = bancada.filter((e) => e.attendance_id === selectedId);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card data-guia="fila-triagem">
        <CardHeader title="Fila da triagem" description={`${rows.length} paciente(s)`} />
        <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`flex w-full items-center justify-between p-3 text-left hover:bg-slate-50 ${
                selectedId === r.id ? 'bg-slate-100' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.patients?.full_name ?? '—'}</p>
                <p className="text-xs text-slate-500">
                  {formatTime(r.checkin_at)} · espera {elapsedFrom(r.checkin_at)}
                </p>
              </div>
              <span className="font-mono font-bold">{r.queue_tickets[0]?.code ?? '—'}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {selected && <ChamarParaTriagem key={`chamar-${selected.id}`} row={selected} salas={salas} />}

        {selected ? <TriageForm key={selected.id} row={selected} /> : null}

        {/*
          Exames de bancada, na mesma tela.

          Antes o paciente saía da triagem, aparecia na fila da Sala 1 e
          voltava para cá. "Fluxo deve ser contínuo de recepção depois
          triagem onde se preenche todas as informações de triagem."
        */}
        {selected && examesDoPaciente.length > 0 && (
          <Card>
            <CardHeader
              title="Exames feitos aqui na triagem"
              description="Preencha antes de encaminhar — o paciente não precisa entrar em outra fila"
            />
            <CardBody className="space-y-6">
              {examesDoPaciente.map((exame) => (
                <div key={exame.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="mb-2 text-sm font-medium text-slate-800">
                    {exame.exam_types?.name ?? 'Exame'}
                  </p>
                  <FichaDeExameForm
                    // Aqui nao ha chamada de sala nem botao de concluir:
                    // preencher a ficha e fazer o exame. Sem isto ele ficava
                    // pendente para sempre e prendia o paciente.
                    concluirAoSalvar
                    patientExamId={exame.id}
                    codigoExame={exame.exam_types?.code}
                    valoresIniciais={exame.exam_results?.[0]?.values ?? {}}
                    conclusaoInicial={exame.exam_results?.[0]?.conclusion ?? ''}
                  />
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Chamada do paciente para a triagem.
 *
 * A senha aparece na TV da sala de espera e o atendimento entra em
 * triagem. Sem isto a tela virava só um formulário: dava para preencher,
 * mas não para avisar o paciente de que era a vez dele.
 */
function ChamarParaTriagem({
  row,
  salas,
}: {
  row: TriageRow;
  salas: { id: string; name: string }[];
}) {
  const [sala, setSala] = useState(salas[0]?.id ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  const jaChamado = row.stage_code === 'em_triagem';

  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {row.queue_tickets[0]?.code ?? '—'} · {row.patients?.full_name ?? 'Paciente'}
          </p>
          <p className="text-xs text-slate-500">
            {jaChamado ? 'Já chamado — em triagem' : 'Aguardando ser chamado'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {salas.length > 1 && (
            <select
              value={sala}
              onChange={(e) => setSala(e.target.value)}
              aria-label="Sala de triagem"
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            >
              {salas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <Button
            loading={pendente}
            variant={jaChamado ? 'outline' : 'primary'}
            onClick={() =>
              iniciar(async () => {
                const r = jaChamado
                  ? await repetirChamadaDaTriagem(row.id)
                  : await chamarParaTriagem(row.id, sala || null);
                setMsg({ ok: r.ok, texto: r.ok ? (r.message ?? 'Chamado.') : r.error });
              })
            }
          >
            <PhoneCall className="h-4 w-4" />
            {jaChamado ? 'Repetir chamada' : 'Chamar paciente'}
          </Button>
        </div>

        {msg && (
          <div className="w-full">
            <Alert variant={msg.ok ? 'success' : 'error'}>{msg.texto}</Alert>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TriageForm({ row }: { row: TriageRow }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveTriage,
    null,
  );
  const triage = row.triages?.[0];
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader
        title={row.patients?.full_name ?? 'Paciente'}
        description={[
          row.companies?.trade_name ?? row.companies?.legal_name,
          calcAge(row.patients?.birth_date ?? null) !== null
            ? `${calcAge(row.patients?.birth_date ?? null)} anos`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <CardBody>
        <form action={formAction} className="space-y-4" data-guia="formulario-triagem">
          {state?.ok && <Alert variant="success">{state.message}</Alert>}
          {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

          <input type="hidden" name="attendance_id" value={row.id} />

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="PA sistolica" error={errors?.blood_pressure_systolic}>
              <Input
                type="number"
                name="blood_pressure_systolic"
                defaultValue={triage?.blood_pressure_systolic ?? ''}
              />
            </Field>
            <Field label="PA diastolica" error={errors?.blood_pressure_diastolic}>
              <Input
                type="number"
                name="blood_pressure_diastolic"
                defaultValue={triage?.blood_pressure_diastolic ?? ''}
              />
            </Field>
            <Field label="Temperatura (C)" error={errors?.temperature_c}>
              <Input
                type="number"
                step="0.1"
                name="temperature_c"
                defaultValue={triage?.temperature_c ?? ''}
              />
            </Field>
            <Field label="FC (bpm)" error={errors?.heart_rate}>
              <Input type="number" name="heart_rate" defaultValue={triage?.heart_rate ?? ''} />
            </Field>
            <Field label="Peso (kg)" error={errors?.weight_kg}>
              <Input
                type="number"
                step="0.1"
                name="weight_kg"
                defaultValue={triage?.weight_kg ?? ''}
              />
            </Field>
            <Field label="Altura (cm)" error={errors?.height_cm}>
              <Input
                type="number"
                step="0.1"
                name="height_cm"
                defaultValue={triage?.height_cm ?? ''}
              />
            </Field>
            <Field label="FR (irpm)" error={errors?.respiratory_rate}>
              <Input
                type="number"
                name="respiratory_rate"
                defaultValue={triage?.respiratory_rate ?? ''}
              />
            </Field>
            <Field label="SpO2 (%)" error={errors?.oxygen_saturation}>
              <Input
                type="number"
                name="oxygen_saturation"
                defaultValue={triage?.oxygen_saturation ?? ''}
              />
            </Field>
          </div>

          {triage?.bmi != null && (
            <Alert variant="info">
              IMC calculado: <strong>{triage.bmi}</strong>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Acuidade O.D." hint="Olho direito" error={errors?.acuidade_od}>
              <Input name="acuidade_od" defaultValue={triage?.acuidade_od ?? ''} placeholder="20/20" />
            </Field>
            <Field label="Acuidade O.E." hint="Olho esquerdo" error={errors?.acuidade_oe}>
              <Input name="acuidade_oe" defaultValue={triage?.acuidade_oe ?? ''} placeholder="20/20" />
            </Field>

            <Field label="Diabetes">
              <div className="flex h-10 items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="diabetes" value="sim" defaultChecked={triage?.diabetes === true} />
                  Sim
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="diabetes" value="nao" defaultChecked={triage?.diabetes !== true} />
                  Não
                </label>
              </div>
            </Field>

            <Field label="Hipertenso">
              <div className="flex h-10 items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="hipertenso" value="sim" defaultChecked={triage?.hipertenso === true} />
                  Sim
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="hipertenso" value="nao" defaultChecked={triage?.hipertenso !== true} />
                  Não
                </label>
              </div>
            </Field>
          </div>

          <Field label="Observações">
            <Textarea name="observations" defaultValue={triage?.observations ?? ''} rows={2} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" variant="outline" loading={pending}>
              Salvar
            </Button>
            <Button type="submit" name="finalizar" value="sim" loading={pending}>
              Concluir triagem
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
