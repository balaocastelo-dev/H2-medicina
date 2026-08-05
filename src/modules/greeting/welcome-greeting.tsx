'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { montarSaudacao } from './phrases';

/**
 * Saudacao de boas-vindas ao entrar no sistema.
 *
 * Fala a frase com a melhor voz pt-BR disponivel no dispositivo e mostra um
 * cartao animado. Aparece uma vez por sessao de navegacao.
 *
 * Navegadores bloqueiam audio sem interacao do usuario; quando isso acontece,
 * o cartao continua visivel com um botao para ouvir.
 */
export function WelcomeGreeting({
  nome,
  tratamento,
  ativa = true,
  corPrimaria,
}: {
  nome: string;
  tratamento?: string | null;
  ativa?: boolean;
  corPrimaria: string;
}) {
  const [frase, setFrase] = useState('');
  const [visivel, setVisivel] = useState(false);
  const [falando, setFalando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const jaTentou = useRef(false);

  const falar = useCallback(
    (texto: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setBloqueado(true);
        return;
      }
      const sintese = window.speechSynthesis;
      const vozes = sintese.getVoices();

      // Prefere vozes neurais/naturais pt-BR; cai para qualquer pt disponivel.
      const preferidas = [
        (v: SpeechSynthesisVoice) => /pt[-_]BR/i.test(v.lang) && /natural|neural|google/i.test(v.name),
        (v: SpeechSynthesisVoice) => /pt[-_]BR/i.test(v.lang) && /luciana|francisca|maria|thalita/i.test(v.name),
        (v: SpeechSynthesisVoice) => /pt[-_]BR/i.test(v.lang),
        (v: SpeechSynthesisVoice) => /^pt/i.test(v.lang),
      ];
      let voz: SpeechSynthesisVoice | undefined;
      for (const criterio of preferidas) {
        voz = vozes.find(criterio);
        if (voz) break;
      }

      const fala = new SpeechSynthesisUtterance(texto);
      fala.lang = voz?.lang ?? 'pt-BR';
      if (voz) fala.voice = voz;
      fala.rate = 1.02;   // ritmo de conversa
      fala.pitch = 1.08;  // levemente animado
      fala.volume = 1;
      fala.onstart = () => {
        setFalando(true);
        setBloqueado(false);
      };
      fala.onend = () => setFalando(false);
      fala.onerror = () => {
        setFalando(false);
        setBloqueado(true);
      };

      sintese.cancel();
      sintese.speak(fala);

      // Se nada comecou a tocar, o navegador barrou o audio automatico.
      window.setTimeout(() => {
        if (!sintese.speaking && !sintese.pending) setBloqueado(true);
      }, 700);
    },
    [],
  );

  useEffect(() => {
    if (!ativa || jaTentou.current) return;
    if (sessionStorage.getItem('saudacao-exibida') === '1') return;
    jaTentou.current = true;
    sessionStorage.setItem('saudacao-exibida', '1');

    const texto = montarSaudacao({ nome, tratamento, hora: new Date().getHours() });

    // O estado so pode ser definido depois da montagem: a frase depende do
    // relogio e do sessionStorage, que nao existem na renderizacao do servidor.
    // Calcular isso durante o render causaria divergencia de hidratacao.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrase(texto);
    setVisivel(true);

    // As vozes carregam de forma assincrona na primeira visita.
    const disparar = () => falar(texto);
    if (window.speechSynthesis?.getVoices().length) {
      window.setTimeout(disparar, 350);
    } else {
      window.speechSynthesis?.addEventListener('voiceschanged', disparar, { once: true });
      window.setTimeout(disparar, 1200);
    }

    const sumir = window.setTimeout(() => setVisivel(false), 14000);
    return () => window.clearTimeout(sumir);
  }, [ativa, nome, tratamento, falar]);

  if (!visivel || !frase) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-[surge_.5s_ease-out] relative mb-5 overflow-hidden rounded-2xl p-5 text-white shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${corPrimaria} 0%, color-mix(in srgb, ${corPrimaria} 60%, #0f172a) 100%)`,
      }}
    >
      <style>{`
        @keyframes surge { from { opacity:0; transform: translateY(-8px) scale(.985) } to { opacity:1; transform:none } }
        @keyframes wave { 0%,100% { transform: scaleY(.4) } 50% { transform: scaleY(1) } }
      `}</style>

      <button
        type="button"
        onClick={() => {
          window.speechSynthesis?.cancel();
          setVisivel(false);
        }}
        aria-label="Fechar saudacao"
        className="absolute top-3 right-3 rounded-lg p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
          {falando ? (
            <span className="flex items-end gap-[3px]" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="block h-4 w-[3px] rounded-full bg-white"
                  style={{ animation: `wave .9s ease-in-out ${i * 0.15}s infinite` }}
                />
              ))}
            </span>
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0">
          <p className="text-[15px] leading-relaxed font-medium">{frase}</p>

          <div className="mt-3 flex items-center gap-2">
            {bloqueado ? (
              <button
                type="button"
                onClick={() => falar(frase)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium transition hover:bg-white/30"
              >
                <Volume2 className="h-3.5 w-3.5" /> Ouvir
              </button>
            ) : falando ? (
              <button
                type="button"
                onClick={() => {
                  window.speechSynthesis?.cancel();
                  setFalando(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium transition hover:bg-white/30"
              >
                <VolumeX className="h-3.5 w-3.5" /> Silenciar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => falar(frase)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium transition hover:bg-white/30"
              >
                <Volume2 className="h-3.5 w-3.5" /> Repetir
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
