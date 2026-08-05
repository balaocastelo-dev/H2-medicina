'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, CheckCircle2, Copy, Play, QrCode } from 'lucide-react';
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
import {
  confirmarPagamentoRecepcao,
  finishReception,
  gerarCobrancaRecepcao,
  startReception,
  type CobrancaRecepcao,
} from '@/modules/queue/reception-actions';
import { formatCNPJ, formatMoney } from '@/lib/format';
import type { ReceptionRow } from './types';

export function ReceptionBoard({
  rows,
  examTypes,
  canRegisterPayment,
}: {
  rows: ReceptionRow[];
  examTypes: { id: string; name: string; code: string; price: number | null }[];
  canRegisterPayment: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Fila da recepção" description={`${rows.length} paciente(s)`} />
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
  examTypes: { id: string; name: string; code: string; price: number | null }[];
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
  const [cobranca, setCobranca] = useState<CobrancaRecepcao | null>(null);
  const [pago, setPago] = useState(row.payment_status === 'pago');

  const total = examTypes
    .filter((e) => selectedExams.includes(e.id))
    .reduce((soma, e) => soma + Number(e.price ?? 0), 0);

  // Mudou a seleção: a cobrança anterior não vale mais.
  const alternarExame = (id: string, marcado: boolean) => {
    setSelectedExams((prev) => (marcado ? [...prev, id] : prev.filter((x) => x !== id)));
    setCobranca(null);
  };

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
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedExams.includes(e.id)}
                    onChange={(ev) => alternarExame(e.id, ev.target.checked)}
                  />
                  <span className="truncate">{e.name}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                  {formatMoney(e.price ?? 0)}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Prioridade</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="prioritario">Prioritário</option>
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
          <span className="mb-1 block font-medium text-slate-700">Observações</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>

        {/* ---- Cobrança dos exames, antes de seguir para a triagem ---- */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs tracking-wide text-slate-500 uppercase">
                Total do atendimento
              </p>
              <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--brand-primary)' }}>
                {formatMoney(total)}
              </p>
              <p className="text-xs text-slate-500">
                {selectedExams.length} exame(s) selecionado(s)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {pago ? (
                <Badge color="#22C55E">pagamento confirmado</Badge>
              ) : (
                <Badge color="#FB923C">aguardando pagamento</Badge>
              )}

              {canRegisterPayment && !pago && (
                <Button
                  loading={pending}
                  disabled={selectedExams.length === 0 || total <= 0}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await gerarCobrancaRecepcao(row.id, selectedExams);
                      if (r.ok && r.data) {
                        setCobranca(r.data);
                        setPago(r.data.jaPago);
                        setMessage(null);
                      } else if (!r.ok) {
                        setMessage({ ok: false, text: r.error });
                      }
                    })
                  }
                >
                  <QrCode className="h-4 w-4" /> Gerar Pix
                </Button>
              )}
            </div>
          </div>

          {cobranca && !pago && (
            <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 md:grid-cols-[auto_1fr]">
              {cobranca.qrcode ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cobranca.qrcode}
                  alt="QR Code do Pix"
                  className="h-44 w-44 rounded-lg border border-slate-200 bg-white p-1"
                />
              ) : (
                <Alert variant="warning">
                  Chave Pix não configurada. Cadastre em Configurações → Pagamento e Pix.
                </Alert>
              )}

              <div className="min-w-0 space-y-2 text-sm">
                <div>
                  <p className="text-xs tracking-wide text-slate-500 uppercase">Recebedor</p>
                  <p className="font-medium">{cobranca.recebedor.razaoSocial}</p>
                  {cobranca.recebedor.cnpj && (
                    <p className="text-xs text-slate-600">
                      CNPJ {formatCNPJ(cobranca.recebedor.cnpj)}
                    </p>
                  )}
                  {cobranca.recebedor.endereco && (
                    <p className="text-xs text-slate-600">
                      {cobranca.recebedor.endereco}
                      {cobranca.recebedor.cidade ? ` — ${cobranca.recebedor.cidade}` : ''}
                    </p>
                  )}
                </div>

                <ul className="space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-600">
                  {cobranca.itens.map((i) => (
                    <li key={i.nome} className="flex justify-between gap-2">
                      <span className="truncate">{i.nome}</span>
                      <span className="tabular-nums">{formatMoney(i.valor)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-2 border-t border-slate-200 pt-1 font-semibold text-slate-800">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMoney(cobranca.valor)}</span>
                  </li>
                </ul>

                {cobranca.payload && (
                  <div>
                    <p className="text-xs tracking-wide text-slate-500 uppercase">
                      Pix copia e cola
                    </p>
                    <textarea
                      readOnly
                      value={cobranca.payload}
                      className="mt-1 h-16 w-full rounded border border-slate-200 p-2 font-mono text-[10px]"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void navigator.clipboard.writeText(cobranca.payload)}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copiar código
                      </Button>
                      <Button
                        size="sm"
                        variant="success"
                        loading={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const r = await confirmarPagamentoRecepcao(cobranca.paymentId, row.id);
                            if (r.ok) setPago(true);
                            setMessage({
                              ok: r.ok,
                              text: r.ok ? 'Pagamento confirmado.' : r.error,
                            });
                          })
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar recebimento
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            loading={pending}
            disabled={selectedExams.length === 0 && !needsTriage}
            onClick={() => {
              if (!pago && total > 0) {
                const seguir = window.confirm(
                  `Este atendimento tem ${formatMoney(total)} em aberto.\n\n` +
                    'Liberar mesmo assim? O valor continua registrado no Financeiro.',
                );
                if (!seguir) return;
              }
              run(() =>
                finishReception({
                  attendanceId: row.id,
                  needsTriage,
                  priority: priority as 'normal' | 'prioritario' | 'encaixe',
                  examTypeIds: selectedExams,
                  notes,
                }),
              );
            }}
          >
            {needsTriage ? 'Enviar para triagem' : 'Liberar para exames'}
            <ArrowRight className="h-4 w-4" />
          </Button>

          {!pago && total > 0 && (
            <span className="text-xs text-amber-700">
              Pagamento pendente — o sistema pede confirmação antes de liberar.
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
