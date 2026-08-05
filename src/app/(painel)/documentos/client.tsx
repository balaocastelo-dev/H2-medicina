'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Download, FileText } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, Field, Select } from '@/components/ui';
import { generateAttendanceDocument, getDocumentUrl } from '@/modules/documents/actions';
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
];

export function GenerateDocumentCard({
  attendances,
}: {
  attendances: { id: string; checkin_at: string; patients: { full_name: string } | null }[];
}) {
  const [attendanceId, setAttendanceId] = useState('');
  const [kind, setKind] = useState<DocumentKind>('atestado_comparecimento');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

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
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {KINDS.map((k) => (
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
                const result = await generateAttendanceDocument(attendanceId, kind);
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
            variant="success"
            loading={pending}
            disabled={!attendanceId}
            onClick={() => {
              if (!window.confirm('Encerrar o atendimento deste paciente?')) return;
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
  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await getDocumentUrl(documentId);
          if (result.ok && result.data) window.open(result.data.url, '_blank', 'noopener');
          else if (!result.ok) window.alert(result.error);
        })
      }
    >
      <Download className="h-4 w-4" /> Abrir
    </Button>
  );
}
