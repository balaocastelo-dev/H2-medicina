'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Copy, FileCheck2, QrCode } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { elapsedFrom, formatCPF, formatMoney } from '@/lib/format';
import {
  gerarPixDoAtendimento,
  liberarDocumentos,
  quitarAtendimento,
  type PixGerado,
} from '@/modules/finance/attendance-actions';

export interface LinhaPagamento {
  id: string;
  stage_code: string;
  checkin_at: string;
  payment_status: string;
  patients: { id: string; full_name: string; cpf: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
  payments: { id: string; description: string | null; net_amount: number; status: string; method: string }[];
  patient_exams: { status: string; exam_types: { name: string; price: number | null } | null }[];
}

export function PainelPagamentos({
  linhas,
  podeCobrar,
}: {
  linhas: LinhaPagamento[];
  podeCobrar: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pix, setPix] = useState<Record<string, PixGerado>>({});
  const [pendente, startTransition] = useTransition();

  const rodar = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, texto: r.ok ? (r.message ?? 'Feito.') : (r.error ?? 'Erro.') });
    });

  return (
    <div className="space-y-3">
      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.texto}</Alert>}

      {linhas.map((l) => {
        const pendentes = (l.payments ?? []).filter((p) => p.status === 'pendente');
        const pagos = (l.payments ?? []).filter((p) => p.status === 'pago');
        const total = pendentes.reduce((s, p) => s + Number(p.net_amount), 0);
        const jaPago = pendentes.length === 0;
        const liberado = l.stage_code === 'aguardando_documentos';
        const exames = l.patient_exams.filter((e) => e.status === 'concluido');
        const dados = pix[l.id];

        return (
          <Card key={l.id}>
            <CardHeader
              title={l.patients?.full_name ?? 'Paciente'}
              description={[
                l.patients?.cpf ? formatCPF(l.patients.cpf) : null,
                l.companies?.trade_name ?? l.companies?.legal_name,
                `na clínica há ${elapsedFrom(l.checkin_at)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              action={
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xl font-bold">
                    {l.queue_tickets?.[0]?.code ?? '—'}
                  </span>
                  {liberado ? (
                    <Badge color="#22C55E">liberado</Badge>
                  ) : jaPago ? (
                    <Badge color="#0EA5E9">pago</Badge>
                  ) : (
                    <Badge color="#F59E0B">aguardando</Badge>
                  )}
                </div>
              }
            />

            <CardBody className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="text-sm">
                  <p className="text-xs tracking-wide text-slate-500 uppercase">
                    Exames realizados
                  </p>
                  {exames.length === 0 ? (
                    <p className="text-slate-500">Nenhum exame concluído.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-slate-700">
                      {exames.map((e, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">{e.exam_types?.name}</span>
                          <span className="tabular-nums text-slate-500">
                            {formatMoney(e.exam_types?.price ?? 0)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="text-sm">
                  <p className="text-xs tracking-wide text-slate-500 uppercase">Financeiro</p>
                  {pagos.length > 0 && (
                    <p className="text-emerald-700">
                      Pago: {formatMoney(pagos.reduce((s, p) => s + Number(p.net_amount), 0))}
                    </p>
                  )}
                  {pendentes.length > 0 ? (
                    <p className="text-lg font-bold text-amber-600">
                      Em aberto: {formatMoney(total)}
                    </p>
                  ) : (
                    <p className="text-emerald-700">Sem valores em aberto.</p>
                  )}
                </div>
              </div>

              {dados && (
                <div className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {dados.qrcode && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={dados.qrcode}
                      alt="QR Code do Pix"
                      className="h-36 w-36 rounded border border-slate-200 bg-white p-1"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatMoney(dados.valor)}</p>
                    <textarea
                      readOnly
                      value={dados.payload}
                      className="mt-1 h-14 w-full rounded border border-slate-200 p-2 font-mono text-[10px]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => void navigator.clipboard.writeText(dados.payload)}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copiar código
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {podeCobrar && !jaPago && (
                  <>
                    <Button
                      variant="outline"
                      loading={pendente}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await gerarPixDoAtendimento(l.id);
                          if (r.ok && r.data) setPix((p) => ({ ...p, [l.id]: r.data! }));
                          else if (!r.ok) setMsg({ ok: false, texto: r.error });
                        })
                      }
                    >
                      <QrCode className="h-4 w-4" /> Gerar Pix
                    </Button>
                    <Button
                      variant="success"
                      loading={pendente}
                      onClick={() => rodar(() => quitarAtendimento(l.id))}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Confirmar pagamento
                    </Button>
                  </>
                )}

                {!liberado && (
                  <Button
                    loading={pendente}
                    disabled={!podeCobrar}
                    onClick={() => rodar(() => liberarDocumentos(l.id))}
                  >
                    <FileCheck2 className="h-4 w-4" /> Liberar documentos
                  </Button>
                )}

                {liberado && (
                  <span className="self-center text-sm text-slate-500">
                    Documentos liberados — siga em Documentos.
                  </span>
                )}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
