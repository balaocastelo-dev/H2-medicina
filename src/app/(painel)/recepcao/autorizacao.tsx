'use client';

import { useRef, useState, useTransition } from 'react';
import { CheckCircle2, FileSignature, Paperclip, Printer } from 'lucide-react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { SignaturePad } from '@/components/ui/signature-pad';
import { getDocumentUrl } from '@/modules/documents/actions';
import {
  anexarTermoAssinado,
  emitirTermoAutorizacao,
} from '@/modules/documents/authorization-actions';

interface AssinaturaExistente {
  id: string;
  purpose: string;
  method: string;
  status: string;
  signed_at: string | null;
}

/**
 * Coleta da autorizacao de envio de resultados a empresa.
 *
 * Sem este termo assinado a clinica nao pode entregar o prontuario ao RH —
 * e o que o Art. 89 do Codigo de Etica Medica exige. Por isso ele aparece
 * como bloco proprio na recepcao, e nao escondido em outra tela.
 */
export function BlocoAutorizacao({
  attendanceId,
  pacienteNome,
  pacienteRg,
  pacienteCpf,
  empresaNome,
  assinaturas,
}: {
  attendanceId: string;
  pacienteNome: string;
  pacienteRg: string | null;
  pacienteCpf: string | null;
  empresaNome: string | null;
  assinaturas: AssinaturaExistente[];
}) {
  const jaAssinado = assinaturas.find(
    (a) => a.purpose === 'autorizacao_envio_resultados' && a.status === 'assinado',
  );
  const pendentePapel = assinaturas.find(
    (a) => a.purpose === 'autorizacao_envio_resultados' && a.status === 'pendente',
  );

  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(pacienteNome);
  const [rg, setRg] = useState(pacienteRg ?? '');
  const [cpf, setCpf] = useState(pacienteCpf ?? '');
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, startTransition] = useTransition();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const abrirDocumento = (documentId: string) =>
    startTransition(async () => {
      const r = await getDocumentUrl(documentId);
      if (r.ok && r.data) window.open(r.data.url, '_blank', 'noopener');
      else if (!r.ok) setMensagem({ ok: false, texto: r.error });
    });

  const emitir = (method: 'tela' | 'papel') =>
    startTransition(async () => {
      const r = await emitirTermoAutorizacao({
        attendanceId,
        method,
        signerName: nome,
        signerRg: rg,
        signerCpf: cpf,
        signatureDataUrl: method === 'tela' ? assinatura : null,
      });
      setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Concluído.') : r.error });
      if (r.ok && r.data) {
        setAberto(false);
        if (method === 'papel') abrirDocumento(r.data.documentId);
      }
    });

  const anexar = (arquivo: File) => {
    if (!pendentePapel) return;
    const leitor = new FileReader();
    leitor.onload = () =>
      startTransition(async () => {
        const r = await anexarTermoAssinado({
          signatureId: pendentePapel.id,
          fileDataUrl: String(leitor.result),
          fileName: arquivo.name,
        });
        setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Anexado.') : r.error });
      });
    leitor.readAsDataURL(arquivo);
  };

  if (jaAssinado) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            Autorização de envio de resultados assinada
          </p>
          <span className="text-xs text-emerald-700">
            {jaAssinado.method === 'tela' ? 'assinada na tela' : 'assinada em papel'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      {mensagem && (
        <div className="mb-3">
          <Alert variant={mensagem.ok ? 'success' : 'error'}>{mensagem.texto}</Alert>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            Autorização de envio de resultados à empresa
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Obrigatória para todo paciente particular. Sem ela, o prontuário não pode ser
            entregue ao RH{empresaNome ? ` da ${empresaNome}` : ''}.
          </p>
        </div>

        {pendentePapel ? (
          <>
            <input
              ref={inputArquivo}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                if (arquivo) anexar(arquivo);
                e.target.value = '';
              }}
            />
            <Button
              size="sm"
              loading={pendente}
              onClick={() => inputArquivo.current?.click()}
              variant="success"
            >
              <Paperclip className="h-3.5 w-3.5" /> Anexar termo assinado
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => setAberto((v) => !v)}>
            <FileSignature className="h-3.5 w-3.5" /> {aberto ? 'Fechar' : 'Coletar autorização'}
          </Button>
        )}
      </div>

      {aberto && !pendentePapel && (
        <div className="mt-3 space-y-3 border-t border-amber-200 pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome de quem assina">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </Field>
            <Field label="RG">
              <Input value={rg} onChange={(e) => setRg(e.target.value)} placeholder="00.000.000-0" />
            </Field>
            <Field label="CPF">
              <Input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                placeholder="000.000.000-00"
              />
            </Field>
          </div>

          <SignaturePad onChange={setAssinatura} disabled={pendente} />

          <div className="flex flex-wrap gap-2">
            <Button loading={pendente} disabled={!assinatura} onClick={() => emitir('tela')}>
              <CheckCircle2 className="h-4 w-4" /> Assinar e arquivar
            </Button>
            <Button variant="outline" loading={pendente} onClick={() => emitir('papel')}>
              <Printer className="h-4 w-4" /> Imprimir para assinar no papel
            </Button>
          </div>

          {!assinatura && (
            <p className="text-xs text-amber-800">
              Peça ao paciente para assinar no quadro acima, ou imprima a via em papel.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
