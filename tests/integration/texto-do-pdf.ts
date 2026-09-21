/**
 * Le o texto de um PDF gerado pelo proprio sistema, sem dependencia nova.
 *
 * Existe para que o teste consiga afirmar "a data de nascimento impressa e
 * esta". Conferir os dados que entram no gerador nao prova nada: o defeito
 * de 21/09 estava justamente entre o banco e o papel. So olhando o que saiu
 * impresso a afirmacao vale.
 *
 * Nao e um leitor de PDF completo — e nem precisa ser. Os documentos daqui
 * sao escritos por pdf-lib com fontes padrao WinAnsi, que grava o texto como
 * string hexadecimal `<48324D>` e, em alguns casos, como literal `(...)`.
 * Os dois casos estao tratados; nenhum outro.
 */
import { inflateSync } from 'node:zlib';

/** Bytes de `stream` ... `endstream`, ja descomprimidos quando der. */
function fluxos(bytes: Uint8Array): Buffer[] {
  const buf = Buffer.from(bytes);
  const saida: Buffer[] = [];
  const ABRE = Buffer.from('stream');
  const FECHA = Buffer.from('endstream');

  let i = 0;
  while (i < buf.length) {
    const a = buf.indexOf(ABRE, i);
    if (a < 0) break;
    // "endstream" tambem casa com "stream": pula para nao contar duas vezes.
    if (a >= 3 && buf.subarray(a - 3, a + 6).toString('latin1') === 'endstream') {
      i = a + 6;
      continue;
    }
    let inicio = a + ABRE.length;
    if (buf[inicio] === 0x0d) inicio++;
    if (buf[inicio] === 0x0a) inicio++;

    const f = buf.indexOf(FECHA, inicio);
    if (f < 0) break;

    const bruto = buf.subarray(inicio, f);
    try {
      saida.push(inflateSync(bruto));
    } catch {
      saida.push(bruto);
    }
    i = f + FECHA.length;
  }
  return saida;
}

/** Desfaz os escapes de um literal de texto do PDF. */
function literal(texto: string): string {
  return texto
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => {
      const m: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      return m[c] ?? c;
    })
    .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
}

/** `<48324D>` e uma string em hexadecimal; cada par e um byte WinAnsi. */
function hexadecimal(texto: string): string {
  const limpo = texto.replace(/\s+/g, '');
  const par = limpo.length % 2 === 0 ? limpo : `${limpo}0`;
  const bytes = par.match(/../g) ?? [];
  return Buffer.from(
    bytes.map((h) => parseInt(h, 16)),
  ).toString('latin1');
}

/**
 * Todo o texto do PDF, com as pecas separadas por espaco.
 *
 * A ordem e a de escrita, nao a de leitura humana — serve para procurar um
 * valor, nao para reconstruir o documento.
 */
export function textoDoPdf(bytes: Uint8Array): string {
  const pedacos: string[] = [];
  for (const fluxo of fluxos(bytes)) {
    const conteudo = fluxo.toString('latin1');
    for (const m of conteudo.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj/g)) {
      pedacos.push(hexadecimal(m[1] ?? ''));
    }
    for (const m of conteudo.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      pedacos.push(literal(m[1] ?? ''));
    }
    for (const m of conteudo.matchAll(/\[([^\][]*)\]\s*TJ/g)) {
      const bloco = m[1] ?? '';
      for (const p of bloco.matchAll(/<([0-9A-Fa-f\s]*)>/g)) pedacos.push(hexadecimal(p[1] ?? ''));
      for (const p of bloco.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) pedacos.push(literal(p[1] ?? ''));
    }
  }
  return pedacos.join(' ');
}

/** O PDF imprime este texto? Compara sem acento e sem caixa. */
export function imprime(bytes: Uint8Array, procurado: string): boolean {
  const normaliza = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ');
  return normaliza(textoDoPdf(bytes)).includes(normaliza(procurado));
}
