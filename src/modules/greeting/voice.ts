/**
 * Escolha da melhor voz pt-BR disponivel no dispositivo.
 *
 * A qualidade varia muito: as vozes antigas do Windows (SAPI) soam metalicas,
 * enquanto as neurais da Microsoft ("Natural"/"Online") e a do Google soam
 * proximas de fala humana. Este ranking prioriza as boas.
 */

export interface VozCandidata {
  name: string;
  lang: string;
  localService: boolean;
}

/** Vozes neurais pt-BR conhecidas, das mais naturais para as menos. */
const NOMES_PREMIADOS = [
  'francisca', // Microsoft Francisca Online (Natural)
  'thalita',
  'brenda',
  'elza',
  'giovanna',
  'leila',
  'leticia',
  'manuela',
  'yara',
  'antonio',
  'donato',
  'fabio',
  'humberto',
];

export function pontuarVoz(voz: VozCandidata, preferida?: string | null): number {
  const nome = voz.name.toLowerCase();
  const lang = voz.lang.replace('_', '-').toLowerCase();

  // Fora do portugues, nem entra na disputa.
  if (!lang.startsWith('pt')) return -1;

  let pontos = 0;
  if (lang === 'pt-br') pontos += 40;

  // Escolha explicita do administrador vence tudo.
  if (preferida && nome.includes(preferida.trim().toLowerCase())) pontos += 500;

  // Neurais se identificam no proprio nome.
  if (/natural|neural/.test(nome)) pontos += 120;
  // Vozes remotas costumam ser as neurais da nuvem.
  if (!voz.localService) pontos += 70;
  if (/google/.test(nome)) pontos += 60;
  if (/online/.test(nome)) pontos += 40;

  const posicao = NOMES_PREMIADOS.findIndex((n) => nome.includes(n));
  if (posicao >= 0) pontos += 40 - posicao;

  // As antigas do Windows sao justamente as que soam roboticas.
  if (/desktop|sapi|microsoft (maria|daniel)\b/.test(nome)) pontos -= 60;
  if (/espeak|festival|pico/.test(nome)) pontos -= 80;

  return pontos;
}

export function escolherVoz<T extends VozCandidata>(vozes: T[], preferida?: string | null): T | null {
  let melhor: T | null = null;
  let melhorPonto = Number.NEGATIVE_INFINITY;

  for (const voz of vozes) {
    const pontos = pontuarVoz(voz, preferida);
    // -1 significa "nao e portugues": nunca entra na disputa.
    if (pontos === -1) continue;
    if (pontos > melhorPonto) {
      melhorPonto = pontos;
      melhor = voz;
    }
  }

  // Se so houver voz ruim, ainda assim e melhor falar do que ficar mudo.
  return melhor;
}

/**
 * Quebra a frase em trechos curtos.
 *
 * Falar tudo de uma vez deixa a entonacao plana; enviar frase a frase faz o
 * sintetizador respirar entre elas, o que soa bem mais natural.
 */
export function dividirEmTrechos(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
