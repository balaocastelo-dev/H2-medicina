'use client';

import { useEffect, useRef } from 'react';

/**
 * Rede viva: fundo interativo da porta de entrada.
 *
 * Particulas ligadas por linhas, como uma rede de protecao que reage a
 * presenca de quem chega. O cursor empurra; segurar o botao atrai; o
 * clique manda uma onda; a roda do mouse muda o alcance.
 *
 * Tres cuidados que a versao de referencia nao tinha e um site de verdade
 * exige:
 *
 *  - a contagem de particulas acompanha o tamanho da tela, senao o celular
 *    engasga desenhando o mesmo que um monitor grande;
 *  - a animacao para quando a aba sai de vista, para nao gastar bateria
 *    desenhando o que ninguem ve;
 *  - quem pediu menos movimento no sistema ve um quadro parado. Animacao
 *    continua e gatilho conhecido de desconforto vestibular, e isso vale
 *    ainda mais numa clinica.
 */

interface Particula {
  x: number;
  y: number;
  vx: number;
  vy: number;
  raio: number;
  raioBase: number;
  massa: number;
  cor: string;
}

interface Onda {
  x: number;
  y: number;
  raio: number;
  raioMax: number;
}

const CORES = ['#00E5FF', '#00A896', '#02C39A', '#FFFFFF', '#70E0D6'];

/** Distancia maxima entre duas particulas para nascer uma linha. */
const ALCANCE_LINHA = 88;
const ALCANCE_LINHA2 = ALCANCE_LINHA * ALCANCE_LINHA;

export function RedeViva({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const querMenosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let largura = 0;
    let altura = 0;
    let particulas: Particula[] = [];
    const ondas: Onda[] = [];
    let animacao = 0;
    let rodando = true;

    const ponteiro = { x: 0, y: 0, velocidade: 0, alcance: 200, pressionado: false, ativo: false };

    /**
     * Quantas particulas cabem sem travar.
     *
     * Uma a cada ~4.800 pixels reproduz a densidade da referencia num
     * monitor comum. O teto de 260 segura o custo em tela grande — o laco
     * de ligacoes cresce ao quadrado — e o piso de 70 evita celular vazio.
     */
    const quantidadeIdeal = () =>
      Math.max(70, Math.min(260, Math.round((largura * altura) / 4800)));

    function medir() {
      if (!canvas || !ctx) return;
      const escala = Math.min(window.devicePixelRatio || 1, 2);
      largura = canvas.clientWidth;
      altura = canvas.clientHeight;
      canvas.width = Math.floor(largura * escala);
      canvas.height = Math.floor(altura * escala);
      ctx.setTransform(escala, 0, 0, escala, 0, 0);

      const desejadas = quantidadeIdeal();
      while (particulas.length < desejadas) particulas.push(nova());
      if (particulas.length > desejadas) particulas = particulas.slice(0, desejadas);

      ponteiro.x = ponteiro.ativo ? ponteiro.x : largura / 2;
      ponteiro.y = ponteiro.ativo ? ponteiro.y : altura / 2;
    }

    function nova(): Particula {
      const raioBase = Math.random() * 2.2 + 1;
      return {
        x: Math.random() * largura,
        y: Math.random() * altura,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        raio: raioBase,
        raioBase,
        massa: Math.random() * 0.8 + 0.4,
        cor: CORES[Math.floor(Math.random() * CORES.length)] as string,
      };
    }

    function mover(p: Particula) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;

      // Sem este empurrãozinho a rede vai perdendo energia e congela.
      if (Math.abs(p.vx) < 0.2) p.vx += (Math.random() - 0.5) * 0.3;
      if (Math.abs(p.vy) < 0.2) p.vy += (Math.random() - 0.5) * 0.3;

      if (p.x < 0 || p.x > largura) p.vx *= -1;
      if (p.y < 0 || p.y > altura) p.vy *= -1;
      p.x = Math.max(0, Math.min(largura, p.x));
      p.y = Math.max(0, Math.min(altura, p.y));

      const dx = ponteiro.x - p.x;
      const dy = ponteiro.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (ponteiro.ativo && dist < ponteiro.alcance) {
        const forca = (ponteiro.alcance - dist) / ponteiro.alcance;
        if (ponteiro.pressionado) {
          p.vx += (dx / dist) * forca * 3 * p.massa;
          p.vy += (dy / dist) * forca * 3 * p.massa;
          p.raio = p.raioBase * (1 + forca * 2);
        } else {
          const impulso = Math.min(ponteiro.velocidade * 0.08, 6);
          p.vx -= (dx / dist) * forca * (1.5 + impulso) * p.massa;
          p.vy -= (dy / dist) * forca * (1.5 + impulso) * p.massa;
          p.raio = p.raioBase * (1 + forca * 1.2);
        }
      } else {
        p.raio += (p.raioBase - p.raio) * 0.1;
      }

      for (const onda of ondas) {
        const odx = p.x - onda.x;
        const ody = p.y - onda.y;
        const odist = Math.hypot(odx, ody) || 1;
        if (Math.abs(odist - onda.raio) < 40) {
          const forca = (1 - onda.raio / onda.raioMax) * 20;
          p.vx += (odx / odist) * forca;
          p.vy += (ody / odist) * forca;
        }
      }
    }

    function desenhar() {
      if (!ctx) return;

      // Rastro: em vez de limpar, pinta o fundo translúcido por cima.
      ctx.fillStyle = 'rgba(1, 8, 14, 0.22)';
      ctx.fillRect(0, 0, largura, altura);

      ponteiro.velocidade *= 0.9;
      ctx.globalCompositeOperation = 'lighter';

      for (let i = ondas.length - 1; i >= 0; i -= 1) {
        const onda = ondas[i] as Onda;
        onda.raio += 12;
        const opacidade = 1 - onda.raio / onda.raioMax;
        if (opacidade <= 0) {
          ondas.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(onda.x, onda.y, onda.raio, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 229, 255, ${opacidade * 0.8})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      if (ponteiro.ativo) {
        const aura = ctx.createRadialGradient(
          ponteiro.x,
          ponteiro.y,
          0,
          ponteiro.x,
          ponteiro.y,
          ponteiro.alcance,
        );
        aura.addColorStop(
          0,
          ponteiro.pressionado ? 'rgba(0, 229, 255, 0.25)' : 'rgba(0, 168, 150, 0.12)',
        );
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(ponteiro.x, ponteiro.y, ponteiro.alcance, 0, Math.PI * 2);
        ctx.fillStyle = aura;
        ctx.fill();
      }

      const alcance2 = ponteiro.alcance * ponteiro.alcance;

      // Comparar distâncias ao quadrado evita milhares de raízes por quadro.
      for (let i = 0; i < particulas.length; i += 1) {
        const a = particulas[i] as Particula;
        for (let j = i + 1; j < particulas.length; j += 1) {
          const b = particulas[j] as Particula;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= ALCANCE_LINHA2) continue;

          const pdx = ponteiro.x - a.x;
          const pdy = ponteiro.y - a.y;
          const perto = ponteiro.ativo && pdx * pdx + pdy * pdy < alcance2;

          const base = 1 - Math.sqrt(d2) / ALCANCE_LINHA;
          const opacidade = perto ? Math.min(base * 2.2, 1) : base;
          const cor = perto
            ? ponteiro.pressionado
              ? 'rgba(255, 255, 255, '
              : 'rgba(0, 229, 255, '
            : 'rgba(0, 168, 150, ';

          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = cor + opacidade + ')';
          ctx.lineWidth = perto ? 1.2 : 0.4;
          ctx.stroke();
        }
      }

      for (const p of particulas) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.raio, 0, Math.PI * 2);
        ctx.fillStyle = p.cor;
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    }

    function quadro() {
      if (!rodando) return;
      for (const p of particulas) mover(p);
      desenhar();
      animacao = requestAnimationFrame(quadro);
    }

    // ---- Interação ----
    const aoMover = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      ponteiro.velocidade = Math.hypot(x - ponteiro.x, y - ponteiro.y);
      ponteiro.x = x;
      ponteiro.y = y;
      ponteiro.ativo = true;
    };

    const aoPressionar = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ponteiro.pressionado = true;
      ponteiro.ativo = true;
      ondas.push({
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        raio: 0,
        raioMax: 280,
      });
    };

    const aoSoltar = () => {
      ponteiro.pressionado = false;
    };
    const aoSair = () => {
      ponteiro.ativo = false;
      ponteiro.pressionado = false;
    };

    const aoRolar = (e: WheelEvent) => {
      ponteiro.alcance =
        e.deltaY < 0
          ? Math.min(ponteiro.alcance + 25, 400)
          : Math.max(ponteiro.alcance - 25, 80);
    };

    const aoTrocarVisibilidade = () => {
      if (document.hidden) {
        rodando = false;
        cancelAnimationFrame(animacao);
      } else if (!querMenosMovimento) {
        rodando = true;
        animacao = requestAnimationFrame(quadro);
      }
    };

    medir();

    if (querMenosMovimento) {
      // Um quadro só: a rede aparece composta, sem movimento nenhum.
      ctx.fillStyle = '#01080e';
      ctx.fillRect(0, 0, largura, altura);
      desenhar();
      const aoRedimensionar = () => {
        medir();
        ctx.fillStyle = '#01080e';
        ctx.fillRect(0, 0, largura, altura);
        desenhar();
      };
      window.addEventListener('resize', aoRedimensionar);
      return () => window.removeEventListener('resize', aoRedimensionar);
    }

    ctx.fillStyle = '#01080e';
    ctx.fillRect(0, 0, largura, altura);
    animacao = requestAnimationFrame(quadro);

    window.addEventListener('resize', medir);
    window.addEventListener('pointermove', aoMover, { passive: true });
    window.addEventListener('pointerdown', aoPressionar, { passive: true });
    window.addEventListener('pointerup', aoSoltar, { passive: true });
    window.addEventListener('pointercancel', aoSair, { passive: true });
    window.addEventListener('wheel', aoRolar, { passive: true });
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);

    return () => {
      rodando = false;
      cancelAnimationFrame(animacao);
      window.removeEventListener('resize', medir);
      window.removeEventListener('pointermove', aoMover);
      window.removeEventListener('pointerdown', aoPressionar);
      window.removeEventListener('pointerup', aoSoltar);
      window.removeEventListener('pointercancel', aoSair);
      window.removeEventListener('wheel', aoRolar);
      document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
