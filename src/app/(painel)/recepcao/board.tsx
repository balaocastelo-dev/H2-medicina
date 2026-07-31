'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Select,
  Textarea,
} from '@/components/ui';
import { elapsedFrom, formatCPF, formatTime } from '@/lib/format';
import { finishReception, startReception } from '@/modules/queue/reception-actions';
import type { ReceptionRow } from './types';

export function ReceptionBoard({
  rows,
  examTypes,
  canRegisterPayment,
}: {
  rows: ReceptionRow[];
  examTypes: { id: string; name: string; code: string }[];
  canRegisterPayment: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Fila da recepcao" description={`${rows.length} paciente(s)`} />
        <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-slate-50 ${
                selectedId === r.id ? 'bg-slate-100' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.patients?.full_name ?? '—'}</p>
                <p className="text-xs text-slate-500">
                  {r.companies?.trade_name ?? r.companies?.legal_name ?? 'Sem empresa'} ·{' '}
                  {formatTime(r.checkin_at)}
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono text-lg font-bold">
                  {r.queue_tickets[0]?.code ?? '—'}
                </span>
                {r.priority !== 'normal' && (
                  <Badge className="block" color="#EF4444">
                    {r.priority}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="lg:col-span-2">
        {selected ? (
          <ReceptionDetail
            key={selected.id}
            row={selected}
            examTypes={examTypes}
            canRegisterPayment={canRegisterPayment}
          />
        ) : (
          <Card>
            <CardBody>Selecione um paciente na fila.</CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function ReceptionDetail({
  row,
  examTypes,
  canRegisterPayment,
}: {
  row: ReceptionRow;
  examTypes: { id: string; name: string; code: string }[];
  canRegisterPayment: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [needsTriage, setNeedsTriage] = useState(row.needs_triage);
  const [priority, setPriority] = useState(row.priority);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [selectedExams, setSelectedExams] = useState<string[]>(
    row.patient_exams.map((e) => e.exam_type_id),
  );

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage({
        ok: result.ok,
        text: result.ok ? (result.message ?? 'Concluido.') : (result.error ?? 'Erro.'),
      });
    });

  return (
    <Card>
      <CardHeader
        title={row.patients?.full_name ?? 'Paciente'}
        description={[
          row.patients?.cpf ? formatCPF(row.patients.cpf) : null,
          row.companies?.trade_name ?? row.companies?.legal_name,
          row.patients?.job_title,
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <div className="text-right">
            <p className="font-mono text-2xl font-bold">{row.queue_tickets[0]?.code ?? '—'}</p>
            <p className="text-xs text-slate-500">Espera: {elapsedFrom(row.checkin_at)}</p>
          </div>
        }
      />

      <CardBody className="space-y-4">
        {message && <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>}

        {row.order_id && (
          <Alert variant="info" title="Pedido da loja">
            Este atendimento tem origem em uma compra online. Confira os itens antes de liberar.
          </Alert>
        )}

        {row.stage_code === 'aguardando_recepcao' && (
          <Button loading={pending} onClick={() => run(() => startReception(row.id))}>
            <Play className="h-4 w-4" /> Iniciar atendimento
          </Button>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Exames confirmados</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {examTypes.map((e) => (
              <label
                key={e.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedExams.includes(e.id)}
                  onChange={(ev) =>
                    setSelectedExams((prev) =>
                      ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                    )
                  }
                />
                {e.name}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Prioridade</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="prioritario">Prioritario</option>
              <option value="encaixe">Encaixe</option>
            </Select>
          </label>
          <label className="flex items-end gap-2 text-sm">
            <input
              type="checkbox"
              checked={needsTriage}
              onChange={(e) => setNeedsTriage(e.target.checked)}
              className="mb-3"
            />
            <span className="mb-3">Encaminhar para triagem</span>
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Observacoes</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>

        {canRegisterPayment && (
          <Alert variant="info">
            Status financeiro: <strong>{row.payment_status}</strong>. Cobrancas sao registradas no
            modulo Financeiro.
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            loading={pending}
            disabled={selectedExams.length === 0 && !needsTriage}
            onClick={() =>
              run(() =>
                finishReception({
                  attendanceId: row.id,
                  needsTriage,
                  priority: priority as 'normal' | 'prioritario' | 'encaixe',
                  examTypeIds: selectedExams,
                  notes,
                }),
              )
            }
          >
            {needsTriage ? 'Enviar para triagem' : 'Liberar para exames'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
