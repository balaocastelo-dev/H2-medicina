'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, GraduationCap, X } from 'lucide-react';
import { Button } from '@/components/ui';
import type { PassoDoGuia, Roteiro } from '@/modules/guide/roteiros';

interface Recorte {
  top: number;
  left: number;
  width: number;
  height: number;
}

const MARGEM = 8;
const LARGURA_BALAO = 340;

/**
 * Balao de ensino ancorado no elemento da tela.
 *
 * Desenha um recorte claro sobre o escurecido (o "holofote") e encosta o
 * balao no lado com mais espaco. Passo sem alvo aparece centralizado — e o
 * que abre e fecha o roteiro.
 */
export function BalaoDoGuia({
  roteiro,
  indice,
  onAnterior,
  onProximo,
  onFechar,
}: {
  roteiro: Roteiro;
  indice: number;
  onAnterior: () => void;
  onProximo: () => void;
  onFechar: () => void;
}) {
  const passo: PassoDoGuia | undefined = roteiro.passos[indice];
  const [recorte, setRecorte] = useState<Recorte | null>(null);
  const [montado, setMontado] = useState(false);

  // O portal só pode existir depois que o documento existe.
  useEffect(() => {
    const quadro = requestAnimationFrame(() => setMontado(true));
    return () => cancelAnimationFrame(quadro);
  }, []);

  const medir = useCallback(() => {
    if (!passo?.alvo) {
      setRecorte(null);
      return;
    }
    const elemento = document.querySelector<HTMLElement>(`[data-guia="${passo.alvo}"]`);
    if (!elemento) {
      // Alvo ausente nesta tela (permissao, modulo desligado, lista vazia):
      // o passo continua valendo, so perde o holofote.
      setRecorte(null);
      return;
    }

    elemento.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const r = elemento.getBoundingClientRect();
    setRecorte({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [passo]);

  useLayoutEffect(() => {
    // A medicao espera o proximo quadro: no mesmo tick o elemento pode
    // ainda nao ter posicao final, e o holofote sairia torto.
    const quadro = requestAnimationFrame(medir);
    // A rolagem suave leva alguns quadros a mais; remedir evita o holofote
    // parado no lugar antigo.
    const t = window.setTimeout(medir, 320);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      cancelAnimationFrame(quadro);
      window.clearTimeout(t);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [medir]);

  useEffect(() => {
    const teclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === 'ArrowRight') onProximo();
      if (e.key === 'ArrowLeft') onAnterior();
    };
    window.addEventListener('keydown', teclado);
    return () => window.removeEventListener('keydown', teclado);
  }, [onFechar, onProximo, onAnterior]);

  if (!montado || !passo) return null;

  const ultimo = indice === roteiro.passos.length - 1;

  // Posiciona o balao: abaixo do alvo quando cabe, acima quando nao cabe.
  let estilo: React.CSSProperties = {
    position: 'fixed',
    width: LARGURA_BALAO,
    maxWidth: 'calc(100vw - 24px)',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
  };

  if (recorte) {
    const espacoAbaixo = window.innerHeight - (recorte.top + recorte.height);
    const acima = espacoAbaixo < 240 && recorte.top > 240;
    const left = Math.min(
      Math.max(12, recorte.left + recorte.width / 2 - LARGURA_BALAO / 2),
      window.innerWidth - LARGURA_BALAO - 12,
    );
    estilo = {
      position: 'fixed',
      width: LARGURA_BALAO,
      maxWidth: 'calc(100vw - 24px)',
      left,
      ...(acima
        ? { bottom: window.innerHeight - recorte.top + MARGEM + 4 }
        : { top: recorte.top + recorte.height + MARGEM + 4 }),
    };
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label={roteiro.titulo}>
      {/* Escurecido com recorte. Clicar fora fecha. */}
      <div className="absolute inset-0 bg-slate-900/55" onClick={onFechar} />

      {recorte && (
        <div
          className="pointer-events-none absolute rounded-xl ring-4 ring-white/90"
          style={{
            top: recorte.top - MARGEM,
            left: recorte.left - MARGEM,
            width: recorte.width + MARGEM * 2,
            height: recorte.height + MARGEM * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
          }}
        />
      )}

      <div
        style={estilo}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            <GraduationCap className="h-3 w-3" />
            {roteiro.titulo}
          </span>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar o guia"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="text-base font-semibold text-slate-900">{passo.titulo}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{passo.texto}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {roteiro.passos.map((_, i) => (
              <span
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === indice ? 18 : 6,
                  backgroundColor: i === indice ? 'var(--brand-primary)' : '#CBD5E1',
                }}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {indice > 0 && (
              <Button size="sm" variant="ghost" onClick={onAnterior}>
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar
              </Button>
            )}
            <Button size="sm" onClick={onProximo}>
              {ultimo ? 'Entendi' : 'Próximo'}
              {!ultimo && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-slate-400">
          Passo {indice + 1} de {roteiro.passos.length} · use as setas do teclado
        </p>
      </div>
    </div>,
    document.body,
  );
}
