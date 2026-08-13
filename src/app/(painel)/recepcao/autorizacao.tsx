'use client';

import { useRef, useState, useTransition } from 'react';
import { CheckCircle2, ExternalLink, FileSignature, Paperclip, Printer } from 'lucide-react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { SignaturePad } from '@/components/ui/signature-pad';
import { abrirDocumentoEmNovaAba } from '@/lib/abrir-documento';
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
  document_id: string | null;
}

const FINALIDADE = 'autorizacao_envio_resultados';

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
  const doTermo = assinaturas.filter((a) => a.purpose === FINALIDADE);
  const jaAssinado = doTermo.find((a) => a.status === 'assinado');
  const pendentePapel = doTermo.find((a) => a.status === 'pendente');

  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(pacienteNome);
  const [rg, setRg] = useState(pacienteRg ?? '');
  const [cpf, setCpf] = useState(pacienteCpf ?? '');
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  // Guardado para o caso de o navegador barrar a aba: vira link visivel.
  const [linkDireto, setLinkDireto] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const abrir = (documentId: string) =>
    startTransition(async () => {
      const r = await abrirDocumentoEmNovaAba(documentId);
      if (!r.ok) {
        setMensagem({ ok: false, texto: r.error });
        return;
      }
      setLinkDireto(r.abriu ? null : r.url);
      if (!r.abriu) {
        setMensagem({
          ok: true,
          texto: 'O navegador bloqueou a aba. Use o link abaixo para abrir o termo.',
        });
      }
    });

  const emitir = (method: 'tela' | 'papel') =>
    startTransition(async () => {
      setLinkDireto(null);
      const r = await emitirTermoAutorizacao({
        attendanceId,
        method,
        signerName: nome,
        signerRg: rg,
        signerCpf: cpf,
        signatureDataUrl: method === 'tela' ? assinatura : null,
      });

      if (!r.ok) {
        setMensagem({ ok: false, texto: r.error });
        return;
      }

      setMensagem({ ok: true, texto: r.message ?? 'Concluído.' });

      if (method === 'papel' && r.data) {
        // Abre direto; se o navegador barrar, o link fica na tela.
        const aberto = await abrirDocumentoEmNovaAba(r.data.documentId);
        if (aberto.ok && !aberto.abriu) setLinkDireto(aberto.url);
      } else {
        setAberto(false);
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

  const avisos = (
    <>
      {mensagem && (
        <div className="mb-3">
          <Alert variant={mensagem.ok ? 'success' : 'error'}>{mensagem.texto}</Alert>
        </div>
      )}
      {linkDireto && (
        <div className="mb-3">
          <a
            href={linkDireto}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir o termo em PDF
          </a>
        </div>
      )}
    </>
  );

  // ---- Já assinado: continua sendo possível reimprimir a via ------------
  if (jaAssinado) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        {avisos}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            Autorização de envio de resultados assinada
            <span className="text-xs font-normal text-emerald-700">
              ({jaAssinado.method === 'tela' ? 'assinada na tela' : 'assinada em papel'})
            </span>
          </p>

          <div className="flex flex-wrap gap-2">
            {jaAssinado.document_id && (
              <Button
                size="sm"
                variant="outline"
                loading={pendente}
                onClick={() => abrir(jaAssinado.document_id as string)}
              >
                <Printer className="h-3.5 w-3.5" /> Abrir / imprimir
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAberto((v) => !v)}>
              <FileSignature className="h-3.5 w-3.5" /> Emitir nova via
            </Button>
          </div>
        </div>

        {aberto && (
          <div className="mt-3 border-t border-emerald-200 pt-3">
            <Formulario
              nome={nome}
              rg={rg}
              cpf={cpf}
              setNome={setNome}
              setRg={setRg}
              setCpf={setCpf}
              assinatura={assinatura}
              setAssinatura={setAssinatura}
              pendente={pendente}
              onAssinar={() => emitir('tela')}
              onImprimir={() => emitir('papel')}
            />
          </div>
        )}
      </div>
    );
  }

  // ---- Ainda sem assinatura --------------------------------------------
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      {avisos}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            Autorização de envio de resultados à empresa
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            {pendentePapel
              ? 'Via em papel já emitida. Reimprima quantas vezes precisar ou anexe o termo assinado.'
              : `Obrigatória para todo paciente particular. Sem ela, o prontuário não pode ser entregue ao RH${
                  empresaNome ? ` da ${empresaNome}` : ''
                }.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {pendentePapel?.document_id && (
            <Button
              size="sm"
              variant="outline"
              loading={pendente}
              onClick={() => abrir(pendentePapel.document_id as string)}
            >
              <Printer className="h-3.5 w-3.5" /> Reimprimir
            </Button>
          )}

          {pendentePapel && (
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
                variant="success"
                loading={pendente}
                onClick={() => inputArquivo.current?.click()}
              >
                <Paperclip className="h-3.5 w-3.5" /> Anexar assinado
              </Button>
            </>
          )}

          <Button size="sm" onClick={() => setAberto((v) => !v)}>
            <FileSignature className="h-3.5 w-3.5" />
            {aberto ? 'Fechar' : pendentePapel ? 'Assinar na tela' : 'Coletar autorização'}
          </Button>
        </div>
      </div>

      {aberto && (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <Formulario
            nome={nome}
            rg={rg}
            cpf={cpf}
            setNome={setNome}
            setRg={setRg}
            setCpf={setCpf}
            assinatura={assinatura}
            setAssinatura={setAssinatura}
            pendente={pendente}
            onAssinar={() => emitir('tela')}
            onImprimir={() => emitir('papel')}
          />
        </div>
      )}
    </div>
  );
}

/** Dados de quem assina, quadro de assinatura e as duas saidas. */
function Formulario({
  nome,
  rg,
  cpf,
  setNome,
  setRg,
  setCpf,
  assinatura,
  setAssinatura,
  pendente,
  onAssinar,
  onImprimir,
}: {
  nome: string;
  rg: string;
  cpf: string;
  setNome: (v: string) => void;
  setRg: (v: string) => void;
  setCpf: (v: string) => void;
  assinatura: string | null;
  setAssinatura: (v: string | null) => void;
  pendente: boolean;
  onAssinar: () => void;
  onImprimir: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nome de quem assina">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="RG">
          <Input value={rg} onChange={(e) => setRg(e.target.value)} placeholder="00.000.000-0" />
        </Field>
        <Field label="CPF">
          <Input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
        </Field>
      </div>

      <SignaturePad onChange={setAssinatura} disabled={pendente} />

      <div className="flex flex-wrap gap-2">
        <Button loading={pendente} disabled={!assinatura} onClick={onAssinar}>
          <CheckCircle2 className="h-4 w-4" /> Assinar e arquivar
        </Button>
        <Button variant="outline" loading={pendente} onClick={onImprimir}>
          <Printer className="h-4 w-4" /> Gerar via para assinar no papel
        </Button>
      </div>

      <p className="text-xs text-slate-600">
        A via em papel pode ser gerada quantas vezes for necessário — cada emissão fica registrada.
      </p>
    </div>
  );
}
