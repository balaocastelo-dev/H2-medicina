'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Download, FileText, PackageCheck } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, Field, Select } from '@/components/ui';
import { emitirDocumentosDeSaida, generateAttendanceDocument } from '@/modules/documents/actions';
import { abrirDocumentoEmNovaAba } from '@/lib/abrir-documento';
import { encerrarAtendimento } from '@/modules/finance/attendance-actions';
import { formatDateTime } from '@/lib/format';
import type { DocumentKind } from '@/types/entities';

const KINDS: { value: DocumentKind; label: string }[] = [
  { value: 'atestado_comparecimento', label: 'Atestado de comparecimento médico' },
  { value: 'comprovante_comparecimento', label: 'Comprovante de comparecimento' },
  { value: 'resumo_atendimento', label: 'Resumo do atendimento' },
  { value: 'relacao_exames', label: 'Relacao dos exames' },
  { value: 'ficha_clinica', label: 'Ficha clínica' },
  { value: 'documento_final', label: 'Documento final consolidado' },
  { value: 'recibo', label: 'Recibo de pagamento' },
  { value: 'comprovante_agendamento', label: 'Comprovante de agendamento' },
];

export interface AtendimentoParaEmissao {
  id: string;
  checkin_at: string;
  patients: { full_name: string } | null;
  /** Falso em pericia, junta medica, SISPER e empresa so com A.S.O. */
  emiteFicha: boolean;
  /** Explicacao curta, mostrada quando a ficha nao esta disponivel. */
  motivoSemFicha: string | null;
}

export function GenerateDocumentCard({
  attendances,
}: {
  attendances: AtendimentoParaEmissao[];
}) {
  const [attendanceId, setAttendanceId] = useState('');
  const [kind, setKind] = useState<DocumentKind>('atestado_comparecimento');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // "emitir ficha clinica exceto para pericia, acl, sisper e empresa agape":
  // a opcao some da lista em vez de deixar a recepcao emitir e tomar erro.
  const atendimento = attendances.find((a) => a.id === attendanceId) ?? null;
  const tipos = KINDS.filter(
    (k) => k.value !== 'ficha_clinica' || !atendimento || atendimento.emiteFicha,
  );
  const tipoEscolhido = tipos.some((k) => k.value === kind) ? kind : (tipos[0]?.value ?? kind);

  return (
    <Card>
      <CardHeader
        title="Emitir documento"
        description="Selecione o atendimento e o tipo de documento"
      />
      <CardBody className="space-y-3">
        {message && <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Atendimento" className="md:col-span-2">
            <Select value={attendanceId} onChange={(e) => setAttendanceId(e.target.value)}>
              <option value="">Selecione</option>
              {attendances.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.patients?.full_name ?? 'Paciente'} — {formatDateTime(a.checkin_at)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Tipo"
            hint={atendimento && !atendimento.emiteFicha ? (atendimento.motivoSemFicha ?? undefined) : undefined}
          >
            <Select
              value={tipoEscolhido}
              onChange={(e) => setKind(e.target.value as DocumentKind)}
            >
              {tipos.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            loading={pending}
            disabled={!attendanceId}
            onClick={() =>
              startTransition(async () => {
                const result = await generateAttendanceDocument(attendanceId, tipoEscolhido);
                setMessage({
                  ok: result.ok,
                  text: result.ok ? (result.message ?? 'Gerado.') : result.error,
                });
              })
            }
          >
            <FileText className="h-4 w-4" /> Gerar documento
          </Button>

          <Button
            variant="outline"
            loading={pending}
            disabled={!attendanceId}
            onClick={() =>
              startTransition(async () => {
                const r = await emitirDocumentosDeSaida(attendanceId);
                setMessage({ ok: r.ok, text: r.ok ? (r.message ?? 'Emitidos.') : r.error });
              })
            }
          >
            <PackageCheck className="h-4 w-4" /> Kit de saída
          </Button>

          <Button
            variant="success"
            loading={pending}
            disabled={!attendanceId}
            onClick={() => {
              if (
                !window.confirm(
                  'Encerrar o atendimento deste paciente?\n\nO kit de saída (comprovante, recibo e agendamento) é emitido automaticamente.',
                )
              )
                return;
              startTransition(async () => {
                const r = await encerrarAtendimento(attendanceId);
                setMessage({ ok: r.ok, text: r.ok ? (r.message ?? 'Encerrado.') : r.error });
              });
            }}
          >
            <CheckCircle2 className="h-4 w-4" /> Encerrar atendimento
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function DocumentActions({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  // Quando o navegador barra a aba, o botao vira link: o clique direto no
  // link nao passa pela mesma checagem de popup.
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium underline"
      >
        <Download className="h-4 w-4" /> Abrir documento
      </a>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await abrirDocumentoEmNovaAba(documentId);
          if (!r.ok) window.alert(r.error);
          else if (!r.abriu) setUrl(r.url);
        })
      }
    >
      <Download className="h-4 w-4" /> Abrir
    </Button>
  );
}
