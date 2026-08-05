'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { montarSaudacao } from './phrases';
import { dividirEmTrechos, escolherVoz } from './voice';

/**
 * Saudacao de boas-vindas ao entrar no sistema.
 *
 * Fala a frase com a voz mais natural disponivel no dispositivo e mostra um
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
  voz,
  velocidade,
}: {
  nome: string;
  tratamento?: string | null;
  ativa?: boolean;
  corPrimaria: string;
  /** Trecho do nome da voz preferida, definido em Configuracoes. */
  voz?: string | null;
  velocidade?: number | null;
}) {
  // A frase depende do relogio, entao e calculada uma unica vez na montagem
  // (inicializador preguicoso do useState) em vez de dentro de um efeito.
  const [frase] = useState(() => montarSaudacao({ nome, tratamento, hora: new Date().getHours() }));
  const [visivel, setVisivel] = useState(true);
  const [falando, setFalando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const montado = useRef(false);
  const jaFalouSozinho = useRef(false);

  const falar = useCallback(
    (texto: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setBloqueado(true);
        return;
      }
      const sintese = window.speechSynthesis;
      const escolhida = escolherVoz(sintese.getVoices(), voz);
      const trechos = dividirEmTrechos(texto);

      sintese.cancel();

      trechos.forEach((trecho, indice) => {
        const fala = new SpeechSynthesisUtterance(trecho);
        if (escolhida) fala.voice = escolhida;
        fala.lang = escolhida?.lang ?? 'pt-BR';
        // Ritmo de conversa. Tom neutro: acima de 1 soa artificial.
        fala.rate = velocidade ?? 0.97;
        fala.pitch = 1;
        fala.volume = 1;

        if (indice === 0) {
          fala.onstart = () => {
            setFalando(true);
            setBloqueado(false);
          };
        }
        if (indice === trechos.length - 1) {
          fala.onend = () => setFalando(false);
        }
        fala.onerror = () => {
          setFalando(false);
          setBloqueado(true);
        };

        sintese.speak(fala);
      });

      // Se nada comecou a tocar, o navegador barrou o audio automatico.
      window.setTimeout(() => {
        if (!sintese.speaking && !sintese.pending) setBloqueado(true);
      }, 800);
    },
    [voz, velocidade],
  );

  useEffect(() => {
    if (!ativa || montado.current) return;
    montado.current = true;

    // Uma vez por sessao de navegacao. O sessionStorage so existe no
    // navegador, entao a verificacao precisa acontecer depois da montagem —
    // fazer isso durante o render quebraria a hidratacao.
    if (sessionStorage.getItem('saudacao-exibida') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisivel(false);
      return;
    }
    sessionStorage.setItem('saudacao-exibida', '1');
    const texto = frase;

    // As vozes carregam de forma assincrona. Havia dois gatilhos concorrentes
    // aqui (o evento e o temporizador de seguranca), e os dois disparavam —
    // por isso a saudacao chegava a ser falada duas vezes. Agora so o primeiro
    // que chegar fala, e o outro e descartado.
    const falarUmaVezSo = () => {
      if (jaFalouSozinho.current) return;
      jaFalouSozinho.current = true;
      falar(texto);
    };

    const sintese = window.speechSynthesis;
    const reserva = window.setTimeout(falarUmaVezSo, 1200);

    if (sintese?.getVoices().length) {
      window.setTimeout(falarUmaVezSo, 300);
    } else {
      sintese?.addEventListener('voiceschanged', falarUmaVezSo, { once: true });
    }

    const sumir = window.setTimeout(() => setVisivel(false), 15000);
    return () => {
      window.clearTimeout(reserva);
      window.clearTimeout(sumir);
      sintese?.removeEventListener('voiceschanged', falarUmaVezSo);
    };
  }, [ativa, frase, falar]);

  if (!ativa || !visivel || !frase) return null;

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
            {falando ? (
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium transition hover:bg-white/30"
              >
                <Volume2 className="h-3.5 w-3.5" /> {bloqueado ? 'Ouvir' : 'Repetir'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
