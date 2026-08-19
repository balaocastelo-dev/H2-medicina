'use client';

import { useState, useTransition } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { SignaturePad } from '@/components/ui/signature-pad';
import { removerAssinatura, salvarAssinatura } from '@/modules/users/medicos-actions';

/**
 * Registro da assinatura manuscrita do proprio profissional.
 *
 * A tela so aparece para quem esta logado, e a acao de servidor recusa
 * gravar assinatura de outra pessoa. Assinatura desenhada por terceiro
 * nao e assinatura — assinaria documento medico em nome de quem nao
 * esteve ali.
 */
export function MinhaAssinatura({
  profileId,
  previaAtual,
  atualizadaEm,
  temRegistro,
}: {
  profileId: string;
  previaAtual: string | null;
  atualizadaEm: string | null;
  temRegistro: boolean;
}) {
  const [desenho, setDesenho] = useState<string | null>(null);
  const [autorizo, setAutorizo] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [rodando, iniciar] = useTransition();

  const gravar = () => {
    if (!desenho) return;
    iniciar(async () => {
      const r = await salvarAssinatura({ profileId, imagem: desenho, consentimento: autorizo });
      setAviso({ ok: r.ok, texto: r.ok ? (r.message ?? 'Assinatura registrada.') : r.error });
      if (r.ok) {
        setDesenho(null);
        setAutorizo(false);
      }
    });
  };

  return (
    <Card>
      <CardHeader
        title="Minha assinatura"
        description="Usada nos documentos que você assinar: A.S.O., resultados e atestados"
      />
      <CardBody>
        {aviso && <Alert variant={aviso.ok ? 'success' : 'error'}>{aviso.texto}</Alert>}

        {!temRegistro && (
          <Alert variant="info">
            Seu registro no conselho ainda não está cadastrado. Ele é impresso ao lado da
            assinatura nos documentos — peça para quem administra o sistema preencher.
          </Alert>
        )}

        {previaAtual && (
          <div className="mb-4">
            <p className="mb-1 text-xs text-slate-500">
              Assinatura atual{atualizadaEm ? ` · registrada em ${atualizadaEm}` : ''}
            </p>
            <div className="flex items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previaAtual} alt="Sua assinatura" className="h-16 object-contain" />
              <Button
                size="sm"
                variant="outline"
                loading={rodando}
                onClick={() => {
                  if (!window.confirm('Remover sua assinatura dos próximos documentos?')) return;
                  iniciar(async () => {
                    const r = await removerAssinatura();
                    setAviso({ ok: r.ok, texto: r.ok ? (r.message ?? 'Removida.') : r.error });
                  });
                }}
              >
                Remover
              </Button>
            </div>
          </div>
        )}

        <p className="mb-2 text-sm font-medium">
          {previaAtual ? 'Desenhar uma nova assinatura' : 'Desenhe sua assinatura'}
        </p>
        <SignaturePad onChange={setDesenho} height={200} disabled={rodando} />

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            checked={autorizo}
            onChange={(e) => setAutorizo(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Autorizo o uso desta assinatura nos documentos que eu emitir neste sistema, e confirmo
            que fui eu quem a desenhou.
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={gravar} disabled={!desenho || !autorizo} loading={rodando}>
            Salvar assinatura
          </Button>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            só você pode registrar a sua
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
