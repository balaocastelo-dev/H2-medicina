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
  Textarea,
} from '@/components/ui';
import { calcAge, elapsedFrom, formatTime } from '@/lib/format';
import { saveTriage } from '@/modules/clinical/actions';
import type { ActionResult } from '@/lib/action-result';
import type { TriageRow } from './types';

export function TriageWorkspace({ rows }: { rows: TriageRow[] }) {
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
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

      <div className="lg:col-span-2">
        {selected ? <TriageForm key={selected.id} row={selected} /> : null}
      </div>
    </div>
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
        action={row.priority !== 'normal' ? <Badge color="#EF4444">{row.priority}</Badge> : null}
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sintomas">
              <Textarea name="symptoms" defaultValue={triage?.symptoms ?? ''} rows={2} />
            </Field>
            <Field label="Alertas">
              <Textarea name="alerts" defaultValue={triage?.alerts ?? ''} rows={2} />
            </Field>
            <Field label="Restricoes">
              <Textarea name="restrictions" defaultValue={triage?.restrictions ?? ''} rows={2} />
            </Field>
            <Field label="Observacoes">
              <Textarea name="observations" defaultValue={triage?.observations ?? ''} rows={2} />
            </Field>
          </div>

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
