/**
 * Audiograma: o quadro de orelha direita e esquerda do laudo.
 *
 * "Quando fizer exame de audiometria, o proprio sistema deve preencher o
 * quadro de grafico de orelha direita e orelha esquerda, esse grafico deve
 * ser preenchido automaticamente de acordo com as informacoes anexadas."
 *
 * Aqui ficam as contas: quais frequencias existem, onde cada limiar cai no
 * desenho e o que os numeros dizem em linguagem descritiva. A conclusao
 * clinica continua sendo do medico — este modulo nao diagnostica, so
 * organiza o que foi medido.
 *
 * Logica pura: sem banco e sem desenho, testavel direto.
 */

/** Frequencias da audiometria tonal ocupacional, em Hz. */
export const FREQUENCIAS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000] as const;

export type Orelha = 'od' | 'oe';

/** Limiar em dB por frequencia. Frequencia nao medida fica de fora. */
export type Limiares = Partial<Record<number, number>>;

/** Faixa do eixo vertical do audiograma, em dB. */
export const DB_MINIMO = -10;
export const DB_MAXIMO = 120;

/**
 * Limite de normalidade adotado pela NR-7 para triagem ocupacional.
 *
 * Acima disso o limiar e destacado no laudo para o medico olhar. Nao e
 * diagnostico: e o mesmo destaque que o audiologista faz no papel.
 */
export const LIMITE_NORMALIDADE = 25;

/** Frequencias que a NR-7 usa para acompanhar perda induzida por ruido. */
export const FREQUENCIAS_ALTAS = [3000, 4000, 6000] as const;

function limiarValido(valor: unknown): valor is number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= DB_MINIMO && n <= DB_MAXIMO;
}

/**
 * Le os limiares gravados na ficha do exame.
 *
 * Os campos chegam como `od_4000`, `oe_500`. Valor vazio, texto ou fora da
 * escala e descartado: ponto errado no grafico e pior do que ponto ausente.
 */
export function lerLimiares(valores: Record<string, unknown>, orelha: Orelha): Limiares {
  const saida: Limiares = {};
  for (const hz of FREQUENCIAS) {
    const bruto = valores?.[`${orelha}_${hz}`];
    if (bruto === null || bruto === undefined || bruto === '') continue;
    const n = Number(String(bruto).replace(',', '.'));
    if (limiarValido(n)) saida[hz] = n;
  }
  return saida;
}

/** Alguma frequencia foi medida? Sem isso, nao ha grafico para desenhar. */
export function temMedicao(limiares: Limiares): boolean {
  return FREQUENCIAS.some((hz) => limiares[hz] !== undefined);
}

/**
 * Media quadritonal (500, 1000, 2000 e 3000 Hz).
 *
 * E a media usada para descrever a audicao na faixa da fala. Devolve null
 * se faltar alguma das quatro — media com buraco engana mais do que ajuda.
 */
export function mediaQuadritonal(limiares: Limiares): number | null {
  const faixa = [500, 1000, 2000, 3000];
  const valores: number[] = [];
  for (const hz of faixa) {
    const v = limiares[hz];
    if (v === undefined) return null;
    valores.push(v);
  }
  const soma = valores.reduce((s, v) => s + v, 0);
  return Math.round((soma / faixa.length) * 10) / 10;
}

/** Frequencias acima do limite de normalidade, em ordem. */
export function frequenciasAlteradas(limiares: Limiares): number[] {
  return FREQUENCIAS.filter((hz) => {
    const v = limiares[hz];
    return v !== undefined && v > LIMITE_NORMALIDADE;
  }).map(Number);
}

export interface ResumoDaOrelha {
  media: number | null;
  alteradas: number[];
  /** Alguma das frequencias altas da NR-7 esta alterada. */
  alteracaoEmFrequenciaAlta: boolean;
  /** Todas as frequencias medidas estao dentro do limite. */
  dentroDoLimite: boolean;
}

export function resumirOrelha(limiares: Limiares): ResumoDaOrelha {
  const alteradas = frequenciasAlteradas(limiares);
  return {
    media: mediaQuadritonal(limiares),
    alteradas,
    alteracaoEmFrequenciaAlta: alteradas.some((hz) =>
      (FREQUENCIAS_ALTAS as readonly number[]).includes(hz),
    ),
    dentroDoLimite: temMedicao(limiares) && alteradas.length === 0,
  };
}

// ---------------------------------------------------------------------
// Geometria do desenho
// ---------------------------------------------------------------------

export interface CaixaDoGrafico {
  x: number;
  /** Base da caixa (coordenada do PDF cresce para cima). */
  y: number;
  largura: number;
  altura: number;
}

export interface PontoDoGrafico {
  hz: number;
  db: number;
  x: number;
  y: number;
}

/**
 * Posicao de cada frequencia no eixo horizontal.
 *
 * As frequencias sao distribuidas em passos iguais, como no audiograma de
 * papel — nao em escala logaritmica real. E assim que o audiologista le.
 */
export function xDaFrequencia(hz: number, caixa: CaixaDoGrafico): number {
  const indice = FREQUENCIAS.indexOf(hz as (typeof FREQUENCIAS)[number]);
  if (indice < 0) return caixa.x;
  const passo = caixa.largura / (FREQUENCIAS.length - 1);
  return caixa.x + indice * passo;
}

/**
 * Posicao de um limiar no eixo vertical.
 *
 * O audiograma e invertido: -10 dB no topo, 120 dB embaixo. Audicao pior
 * fica mais baixa no papel.
 */
export function yDoLimiar(db: number, caixa: CaixaDoGrafico): number {
  const faixa = DB_MAXIMO - DB_MINIMO;
  const proporcao = (db - DB_MINIMO) / faixa;
  return caixa.y + caixa.altura - proporcao * caixa.altura;
}

/** Pontos a desenhar, na ordem das frequencias medidas. */
export function pontosDoGrafico(limiares: Limiares, caixa: CaixaDoGrafico): PontoDoGrafico[] {
  return FREQUENCIAS.filter((hz) => limiares[hz] !== undefined).map((hz) => {
    const db = limiares[hz] as number;
    return { hz, db, x: xDaFrequencia(hz, caixa), y: yDoLimiar(db, caixa) };
  });
}

/** Rotulo curto da frequencia, como no eixo do audiograma. */
export function rotuloFrequencia(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** Linhas horizontais do quadriculado, de 10 em 10 dB. */
export function linhasDeDb(): number[] {
  const saida: number[] = [];
  for (let db = DB_MINIMO; db <= DB_MAXIMO; db += 10) saida.push(db);
  return saida;
}
