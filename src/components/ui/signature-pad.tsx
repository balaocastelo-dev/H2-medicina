'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * Quadro de assinatura para coleta na tela.
 *
 * Funciona com dedo, caneta e mouse — a recepcao usa monitor comum e as
 * telas de atendimento sao touch. Devolve PNG com fundo transparente para
 * o traco cair bem sobre a linha do PDF.
 */
export function SignaturePad({
  onChange,
  height = 180,
  disabled = false,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const desenhou = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  // O canvas precisa da resolucao real do dispositivo, senao o traco sai
  // serrilhado em tela retina e borrado no PDF.
  const ajustarResolucao = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    if (largura === 0) return;
    canvas.width = largura * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
  }, [height]);

  useEffect(() => {
    ajustarResolucao();
    window.addEventListener('resize', ajustarResolucao);
    return () => window.removeEventListener('resize', ajustarResolucao);
  }, [ajustarResolucao]);

  const posicao = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const iniciar = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = posicao(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const mover = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    desenhou.current = true;
    if (!temTraco) setTemTraco(true);
  };

  const encerrar = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Um toque sem arrastar nao e assinatura: sem traco, nada e devolvido.
    onChange(desenhou.current ? canvas.toDataURL('image/png') : null);
  };

  const limpar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    desenhou.current = false;
    setTemTraco(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div
        className={`relative rounded-xl border-2 border-dashed bg-white ${
          disabled ? 'border-slate-200 opacity-60' : 'border-slate-300'
        }`}
      >
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className="w-full cursor-crosshair"
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={encerrar}
          onPointerLeave={encerrar}
          onPointerCancel={encerrar}
        />
        {!temTraco && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-slate-400">Assine aqui</span>
          </div>
        )}
        <div className="pointer-events-none absolute right-6 bottom-6 left-6 border-b border-slate-300" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {temTraco ? 'Assinatura capturada.' : 'Use o dedo, a caneta ou o mouse.'}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={limpar} disabled={disabled}>
          <Eraser className="h-3.5 w-3.5" /> Limpar
        </Button>
      </div>
    </div>
  );
}
