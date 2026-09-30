/**
 * Texto que a fonte do PDF consegue escrever.
 *
 * ---------------------------------------------------------------------
 * Por que isto existe
 * ---------------------------------------------------------------------
 * As fontes padrao do PDF (Helvetica e companhia) usam a tabela WinAnsi,
 * que tem 224 caracteres. A `pdf-lib` NAO ignora o que esta fora dela: ela
 * LANCA. E a excecao nao derruba so aquele trecho -- derruba a geracao do
 * documento inteiro, e a clinica recebe "Erro inesperado" sem saber por que.
 *
 * Os literais escritos no codigo sao seguros; ja foram conferidos um a um.
 * O risco e o que a clinica DIGITA, e que vai impresso: conclusao do
 * medico, observacoes, restricoes, riscos por categoria, nome dos exames na
 * guia, razao social, endereco, rodape das configuracoes.
 *
 * Um "menor ou igual" numa conclusao de audiometria, um emoji colado do
 * WhatsApp numa observacao, uma seta num campo de preparo: hoje qualquer
 * um deles significa zero documento.
 *
 * ---------------------------------------------------------------------
 * Duas escolhas que valem explicacao
 * ---------------------------------------------------------------------
 * 1. TRANSLITERAR, NAO APAGAR. Apagar mudaria o sentido em silencio: o
 *    sinal de "menor ou igual" sumindo de "<= 25 dB" deixa "25 dB", que
 *    diz outra coisa num laudo. Cada simbolo conhecido vira o equivalente
 *    que a fonte tem; o resto vira "?" e os invisiveis somem.
 *
 * 2. NENHUM CARACTERE EXOTICO NESTE ARQUIVO. Tudo e montado a partir do
 *    codigo numerico. Um arquivo que fala sobre caracteres problematicos
 *    nao pode conte-los: eles sao invisiveis no editor, e uma colagem
 *    descuidada quebraria justamente a protecao.
 */

/** Atalho: o caractere daquele ponto de codigo. */
const c = (n: number) => String.fromCharCode(n);

/**
 * O que trocar por que. A chave e o ponto de codigo Unicode.
 * Cresce quando aparecer caractere novo vindo da clinica.
 */
const EQUIVALENTES: [number, string][] = [
  // Setas e sinais matematicos que aparecem em texto tecnico.
  [0x2192, '->'], [0x2190, '<-'], [0x2194, '<->'], [0x21d2, '=>'],
  [0x2264, '<='], [0x2265, '>='], [0x2260, '!='], [0x2248, '~'],
  [0x00b1, '+/-'], [0x221e, 'infinito'], [0x2211, 'soma'], [0x2206, 'delta'],
  [0x00d7, 'x'], [0x00f7, '/'],

  // Temperatura e medidas compostas num caractere so.
  [0x2103, ' C'], [0x2109, ' F'], [0x33a1, 'm2'], [0x339d, 'cm'],

  // Fracoes.
  [0x00bd, '1/2'], [0x00bc, '1/4'], [0x00be, '3/4'],
  [0x2153, '1/3'], [0x2154, '2/3'],

  // Aspas e tracos "inteligentes", que o Word e o WhatsApp inserem sozinhos
  // sem o usuario pedir. Sao a fonte mais comum de caractere inesperado.
  [0x2018, "'"], [0x2019, "'"], [0x201a, "'"], [0x201b, "'"],
  [0x201c, '"'], [0x201d, '"'], [0x201e, '"'], [0x201f, '"'],
  [0x2032, "'"], [0x2033, '"'], [0x2015, '-'], [0x2212, '-'],

  // Espacos que nao sao o espaco comum. O estreito sem quebra vem do
  // `Intl` do Node em TODO valor formatado em reais.
  [0x00a0, ' '], [0x202f, ' '], [0x2007, ' '], [0x2009, ' '], [0x200a, ' '],

  // Marcadores e sinais de conferido.
  [0x2043, '-'], [0x25aa, '-'], [0x25cf, '-'], [0x25e6, '-'],
  [0x2713, 'OK'], [0x2714, 'OK'], [0x2717, 'X'], [0x2718, 'X'],
  [0x2026, '...'],
];

/** Os que a fonte tem apesar de estarem acima de U+00FF. */
const EXTRAS_DA_WINANSI = [0x2013, 0x2014, 0x2022, 0x20ac, 0x0160, 0x0161, 0x017d, 0x017e];

/**
 * Invisiveis que so atrapalham: somem sem deixar "?" no lugar.
 *
 * Testado por ponto de codigo, e nao por expressao regular, pelo motivo 2
 * explicado no topo.
 */
function ehInvisivel(n: number): boolean {
  // Do espaco de largura zero ate a marca de direita-para-esquerda.
  if (n >= 0x200b && n <= 0x200f) return true;
  // Separadores de linha e de paragrafo, marca de ordem de bytes, hifen
  // condicional -- este ultimo o Word insere sozinho em texto justificado.
  return n === 0x2028 || n === 0x2029 || n === 0xfeff || n === 0x00ad;
}

/** O ponto de codigo cabe na fonte padrao do PDF? */
function cabeNaFonte(n: number): boolean {
  // Tabulacao, quebra de linha e retorno: a quebra de paragrafo dos campos.
  if (n === 9 || n === 10 || n === 13) return true;
  // ASCII imprimivel.
  if (n >= 0x20 && n <= 0x7e) return true;
  // Latin-1 imprimivel: os acentos do portugues, o grau, o ordinal.
  if (n >= 0x00a1 && n <= 0x00ff) return true;
  return EXTRAS_DA_WINANSI.includes(n);
}

/**
 * Deixa o texto seguro para `drawText`.
 *
 * Aceita null e undefined porque metade dos campos impressos e opcional --
 * obrigar cada chamador a tratar isso seria convite a esquecer um.
 */
export function textoSeguroParaPdf(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '';

  // Primeiro passo: fora emoji e invisiveis.
  //
  // Emoji vive acima de U+FFFF e chega em pares substitutos; o par inteiro
  // precisa sair junto, senao sobra meio caractere quebrado. Percorrer com
  // `for...of` sobre a string anda por ponto de codigo, e resolve isso.
  let texto = '';
  for (const ch of String(valor)) {
    const n = ch.codePointAt(0) ?? 0;
    if (n > 0xffff) continue;
    if (ehInvisivel(n)) continue;
    texto += ch;
  }

  // Segundo: os conhecidos viram o equivalente que a fonte tem.
  for (const [ponto, troca] of EQUIVALENTES) {
    const alvo = c(ponto);
    if (texto.includes(alvo)) texto = texto.split(alvo).join(troca);
  }

  // Terceiro: acento composto (letra + acento separado, como o Mac manda)
  // vira o caractere unico, que e o que a WinAnsi tem. Sem isto, um nome
  // digitado no Mac perderia os acentos para "?".
  texto = texto.normalize('NFC');

  // Quarto: o que ainda nao couber vira "?" -- visivel, para alguem poder
  // corrigir, em vez de sumir sem deixar rastro.
  let saida = '';
  for (const ch of texto) saida += cabeNaFonte(ch.codePointAt(0) ?? 0) ? ch : '?';
  return saida;
}

/** Verdadeiro quando o texto passaria sem nenhuma troca. */
export function cabeNoPdf(valor: string | null | undefined): boolean {
  return textoSeguroParaPdf(valor) === String(valor ?? '');
}

/* ------------------------------------------------------------------ */

interface PaginaComTexto {
  drawText(texto: string, opcoes?: unknown): void;
}

/**
 * Passa o texto pelo filtro antes de ele chegar ao PDF.
 *
 * A protecao mora AQUI, e nao em cada chamada de `drawText`, porque sao
 * centenas espalhadas por sete geradores. Lembrar de sanitizar em todas e
 * o tipo de coisa que funciona por um tempo e depois falha justamente no
 * campo novo que alguem acrescentou.
 */
export function protegerPagina<T extends PaginaComTexto>(pagina: T): T {
  const original = pagina.drawText.bind(pagina);
  pagina.drawText = (texto: string, opcoes?: unknown) =>
    original(textoSeguroParaPdf(texto), opcoes);
  return pagina;
}

/**
 * Mesma protecao para a fonte, que mede o texto antes de ele ser desenhado.
 *
 * Medir o original e desenhar o filtrado daria largura errada, e a conta de
 * quebra de linha sairia torta -- texto passando da margem ou coluna vazia.
 */
export function protegerFonte<T extends { widthOfTextAtSize(t: string, s: number): number }>(
  fonte: T,
): T {
  const original = fonte.widthOfTextAtSize.bind(fonte);
  fonte.widthOfTextAtSize = (t: string, s: number) => original(textoSeguroParaPdf(t), s);
  return fonte;
}
