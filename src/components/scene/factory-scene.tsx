'use client';

/**
 * Cena de abertura: médico do trabalho caminhando dentro de uma fábrica.
 *
 * É SVG animado por CSS, não um vídeo: pesa poucos KB, fica nítido em qualquer
 * resolução e o laço é perfeito, sem o "salto" típico de GIF. Também respeita
 * quem pediu menos movimento no sistema operacional — nesse caso a cena
 * congela num quadro composto, em vez de sumir.
 *
 * O ciclo de fundo dura 10 segundos; a passada, 1 segundo.
 */
export function FactoryScene({ cor = '#0F766E' }: { cor?: string }) {
  return (
    <div
      className="cena relative w-full overflow-hidden rounded-2xl"
      style={{ ['--cor' as string]: cor, aspectRatio: '16 / 7' }}
      aria-hidden
    >
      <svg viewBox="0 0 800 350" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0B1220" />
            <stop offset="55%" stopColor="#132033" />
            <stop offset="100%" stopColor="#1B2B40" />
          </linearGradient>
          <linearGradient id="luz" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#FBBF24" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="chao" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#25364D" />
            <stop offset="100%" stopColor="#16212F" />
          </linearGradient>
          <radialGradient id="brilho">
            <stop offset="0%" stopColor="var(--cor)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--cor)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="800" height="350" fill="url(#ceu)" />

        {/* Estrutura do galpão: telhado em dentes de serra */}
        <g opacity="0.5" fill="#0E1826">
          <path d="M0 78 L70 30 L140 78 L210 30 L280 78 L350 30 L420 78 L490 30 L560 78 L630 30 L700 78 L770 30 L800 52 L800 0 L0 0 Z" />
        </g>
        <g stroke="#243449" strokeWidth="2" opacity="0.55">
          <line x1="0" y1="80" x2="800" y2="80" />
          <line x1="0" y1="96" x2="800" y2="96" />
        </g>

        {/* Luminárias suspensas */}
        {[110, 290, 470, 650].map((x, i) => (
          <g key={x}>
            <line x1={x} y1="80" x2={x} y2="104" stroke="#31445C" strokeWidth="2" />
            <path d={`M${x - 16} 104 L${x + 16} 104 L${x + 9} 118 L${x - 9} 118 Z`} fill="#31445C" />
            <ellipse cx={x} cy="120" rx="7" ry="3" fill="#FDE68A" className="lampada" style={{ animationDelay: `${i * 0.7}s` }} />
            <path d={`M${x - 60} 300 L${x - 12} 120 L${x + 12} 120 L${x + 60} 300 Z`} fill="url(#luz)" className="lampada" style={{ animationDelay: `${i * 0.7}s` }} />
          </g>
        ))}

        {/* Fundo distante: rola devagar (paralaxe) */}
        <g className="camadaLonge">
          {[0, 800].map((deslocamento) => (
            <g key={deslocamento} transform={`translate(${deslocamento} 0)`} fill="#16233A">
              <rect x="30" y="150" width="90" height="105" rx="4" />
              <rect x="46" y="120" width="16" height="30" />
              <rect x="88" y="132" width="12" height="18" />
              <rect x="170" y="168" width="130" height="87" rx="4" />
              <rect x="196" y="140" width="20" height="28" />
              <rect x="350" y="145" width="70" height="110" rx="4" />
              <rect x="470" y="172" width="150" height="83" rx="4" />
              <rect x="510" y="146" width="18" height="26" />
              <rect x="670" y="158" width="95" height="97" rx="4" />
              {/* janelinhas acesas */}
              <g fill="#F59E0B" opacity="0.28">
                <rect x="44" y="168" width="10" height="12" />
                <rect x="66" y="168" width="10" height="12" />
                <rect x="90" y="192" width="10" height="12" />
                <rect x="186" y="186" width="12" height="12" />
                <rect x="228" y="186" width="12" height="12" />
                <rect x="270" y="212" width="12" height="12" />
                <rect x="366" y="176" width="10" height="12" />
                <rect x="392" y="200" width="10" height="12" />
                <rect x="496" y="192" width="12" height="12" />
                <rect x="546" y="192" width="12" height="12" />
                <rect x="596" y="216" width="12" height="12" />
                <rect x="690" y="180" width="12" height="12" />
                <rect x="730" y="204" width="12" height="12" />
              </g>
            </g>
          ))}
        </g>

        {/* Plano médio: máquinas e esteira, rolam mais rápido */}
        <g className="camadaMedia">
          {[0, 800].map((deslocamento) => (
            <g key={deslocamento} transform={`translate(${deslocamento} 0)`}>
              <g fill="#1E2E45">
                <rect x="40" y="205" width="120" height="55" rx="6" />
                <rect x="60" y="188" width="26" height="18" rx="3" />
                <circle cx="120" cy="232" r="13" fill="#2A3D58" />
                <rect x="250" y="196" width="150" height="64" rx="6" />
                <rect x="276" y="176" width="34" height="21" rx="3" />
                <rect x="330" y="212" width="46" height="30" rx="3" fill="#2A3D58" />
                <rect x="480" y="210" width="110" height="50" rx="6" />
                <circle cx="530" cy="234" r="12" fill="#2A3D58" />
                <rect x="660" y="200" width="120" height="60" rx="6" />
                <rect x="690" y="182" width="30" height="19" rx="3" />
              </g>
              {/* dutos */}
              <g stroke="#243449" strokeWidth="7" fill="none" strokeLinecap="round">
                <path d="M0 140 L800 140" opacity="0.7" />
                <path d="M150 140 L150 168" opacity="0.7" />
                <path d="M520 140 L520 176" opacity="0.7" />
              </g>
              {/* esteira */}
              <rect x="0" y="262" width="800" height="10" fill="#22334A" />
            </g>
          ))}
        </g>

        {/* Piso */}
        <rect x="0" y="272" width="800" height="78" fill="url(#chao)" />
        <g className="camadaPiso" stroke="#31455F" strokeWidth="2" opacity="0.5">
          {[0, 800].map((d) =>
            Array.from({ length: 17 }).map((_, i) => (
              <line key={`${d}-${i}`} x1={d + i * 50} y1="272" x2={d + i * 50 - 26} y2="350" />
            )),
          )}
        </g>
        {/* faixa de segurança */}
        <rect x="0" y="286" width="800" height="3" fill="#FBBF24" opacity="0.35" />

        {/* Brilho sob o médico, para descolá-lo do fundo */}
        <ellipse cx="400" cy="300" rx="120" ry="26" fill="url(#brilho)" />

        {/* ---------------- Médico ---------------- */}
        <g className="medico" transform="translate(400 300)">
          {/* sombra */}
          <ellipse cx="0" cy="2" rx="26" ry="5" fill="#0B1220" opacity="0.5" />

          <g className="corpo">
            {/* perna de trás */}
            <g className="pernaTras">
              <path d="M-3 -52 L-6 -26 L-9 -4" stroke="#334155" strokeWidth="9" strokeLinecap="round" fill="none" />
              <path d="M-9 -4 L-17 -1" stroke="#1E293B" strokeWidth="7" strokeLinecap="round" />
            </g>
            {/* perna da frente */}
            <g className="pernaFrente">
              <path d="M3 -52 L7 -26 L10 -4" stroke="#475569" strokeWidth="9" strokeLinecap="round" fill="none" />
              <path d="M10 -4 L19 -1" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
            </g>

            {/* jaleco */}
            <path
              d="M-15 -100 Q-19 -78 -17 -50 L17 -50 Q19 -78 15 -100 Z"
              fill="#F8FAFC"
            />
            <path d="M-15 -100 Q-19 -78 -17 -50 L0 -50 L0 -100 Z" fill="#E2E8F0" />
            {/* abertura do jaleco */}
            <path d="M0 -100 L0 -52" stroke="#CBD5E1" strokeWidth="1.5" />
            {/* camisa */}
            <path d="M-7 -102 L7 -102 L5 -88 L-5 -88 Z" fill="var(--cor)" />

            {/* braço de trás */}
            <g className="bracoTras">
              <path d="M-13 -96 L-20 -76 L-22 -60" stroke="#E2E8F0" strokeWidth="8" strokeLinecap="round" fill="none" />
              <circle cx="-22" cy="-58" r="4" fill="#F1C9A5" />
            </g>

            {/* estetoscópio */}
            <path
              d="M-8 -100 Q-11 -86 -4 -80 Q3 -86 0 -100"
              stroke="var(--cor)"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="-4" cy="-78" r="3" fill="var(--cor)" />

            {/* cabeça */}
            <g className="cabeca">
              <circle cx="0" cy="-114" r="11" fill="#F1C9A5" />
              <path d="M-11 -118 Q0 -130 11 -118 Q6 -124 0 -124 Q-6 -124 -11 -118 Z" fill="#1E293B" />
              <circle cx="5" cy="-114" r="1.4" fill="#0F172A" />
            </g>

            {/* braço da frente, com prancheta */}
            <g className="bracoFrente">
              <path d="M13 -96 L21 -78 L19 -62" stroke="#F8FAFC" strokeWidth="8" strokeLinecap="round" fill="none" />
              <g transform="translate(19 -62)">
                <rect x="-9" y="-11" width="18" height="23" rx="2" fill="#CBD5E1" />
                <rect x="-6" y="-7" width="12" height="2" fill="#94A3B8" />
                <rect x="-6" y="-2" width="12" height="2" fill="#94A3B8" />
                <rect x="-6" y="3" width="8" height="2" fill="#94A3B8" />
                <rect x="-4" y="-13" width="8" height="3" rx="1" fill="var(--cor)" />
              </g>
              <circle cx="19" cy="-62" r="4" fill="#F1C9A5" />
            </g>
          </g>
        </g>

        {/* Vapor saindo das máquinas */}
        {[150, 470].map((x, i) => (
          <circle key={x} className="vapor" cx={x} cy="180" r="9" fill="#CBD5E1" opacity="0.12" style={{ animationDelay: `${i * 2.4}s` }} />
        ))}

        {/* Vinheta, para o texto por cima respirar */}
        <rect width="800" height="350" fill="url(#vinheta)" />
        <defs>
          <radialGradient id="vinheta" cx="50%" cy="45%" r="75%">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
          </radialGradient>
        </defs>
      </svg>

      <style>{`
        .cena { background: #0B1220; }

        /* Laço de 10s: as camadas percorrem exatamente 800 e reiniciam. */
        .camadaLonge { animation: correr 10s linear infinite; }
        .camadaMedia { animation: correr 6s linear infinite; }
        .camadaPiso  { animation: correr 3.2s linear infinite; }
        @keyframes correr {
          from { transform: translateX(0); }
          to   { transform: translateX(-800px); }
        }

        /* Passada de 1s: o corpo sobe e desce meio ciclo a cada perna. */
        .corpo      { animation: passo 1s ease-in-out infinite; }
        .pernaFrente{ animation: perna 1s ease-in-out infinite; transform-origin: 3px -52px; }
        .pernaTras  { animation: perna 1s ease-in-out infinite reverse; transform-origin: -3px -52px; }
        .bracoFrente{ animation: braco 1s ease-in-out infinite reverse; transform-origin: 13px -96px; }
        .bracoTras  { animation: braco 1s ease-in-out infinite; transform-origin: -13px -96px; }
        .cabeca     { animation: cabeca 1s ease-in-out infinite; transform-origin: 0 -104px; }

        @keyframes passo  { 0%,100% { transform: translateY(0); } 25% { transform: translateY(-3px); } 50% { transform: translateY(0); } 75% { transform: translateY(-3px); } }
        @keyframes perna  { 0%,100% { transform: rotate(22deg); } 50% { transform: rotate(-22deg); } }
        @keyframes braco  { 0%,100% { transform: rotate(16deg); } 50% { transform: rotate(-16deg); } }
        @keyframes cabeca { 0%,100% { transform: rotate(-1.5deg); } 50% { transform: rotate(1.5deg); } }

        .lampada { animation: piscar 4s ease-in-out infinite; }
        @keyframes piscar { 0%,100% { opacity: 1; } 47% { opacity: 1; } 50% { opacity: .55; } 53% { opacity: 1; } }

        .vapor { animation: subir 6s ease-out infinite; }
        @keyframes subir {
          0%   { transform: translateY(0) scale(.5); opacity: .18; }
          100% { transform: translateY(-90px) scale(2.6); opacity: 0; }
        }

        /* Quem pediu menos movimento vê a cena parada, não uma tela vazia. */
        @media (prefers-reduced-motion: reduce) {
          .camadaLonge, .camadaMedia, .camadaPiso,
          .corpo, .pernaFrente, .pernaTras, .bracoFrente, .bracoTras,
          .cabeca, .lampada, .vapor { animation: none; }
        }
      `}</style>
    </div>
  );
}
