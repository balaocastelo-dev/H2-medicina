import 'server-only';
import { rgb, type PDFDocument, type PDFFont } from 'pdf-lib';

/**
 * Rodape com codigo de verificacao e numeracao, em TODAS as paginas.
 *
 * ---------------------------------------------------------------------
 * Por que vale um modulo proprio
 * ---------------------------------------------------------------------
 * `buildDocumentPdf` fazia isso certo: percorria `pdf.getPages()` e
 * escrevia o rodape em cada uma. O A.S.O. e o laudo de ficha nao —
 * escreviam na variavel `pagina`, que depois de uma quebra aponta para a
 * ULTIMA folha.
 *
 * Resultado no papel: num A.S.O. de duas paginas, a folha 1 saia sem
 * codigo de verificacao e sem o rodape da clinica, e a folha 2 saia sem
 * nada que a ligasse a folha 1. No laudo de ficha era pior: a pagina nova
 * recebia apenas a barra de cor — sem nome da clinica, sem nome do
 * paciente, sem titulo do exame. Uma folha anonima.
 *
 * Papel solto sem identificacao nao serve para fiscalizacao, e nem para o
 * RH que recebe o A.S.O. conferir se recebeu o documento inteiro.
 *
 * Escrever o rodape no fim, de uma vez, e a unica forma de acertar: so
 * depois de montar o documento se sabe quantas paginas ele tem.
 */
export interface Rodape {
  /** Texto configurado pela clinica, quando houver. */
  texto?: string | null;
  codigoVerificacao?: string | null;
  /** Endereco da pagina publica de verificacao. */
  url?: string | null;
  margem: number;
  fonte: PDFFont;
  /** Largura util da folha, para quebrar o texto do rodape. */
  largura: number;
  /** Onde a primeira linha do rodape comeca. Padrao 38. */
  base?: number;
  tamanho?: number;
}

/** Quebra o texto na largura disponivel, palavra por palavra. */
function quebrarEm(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/)) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(teste, tamanho) > largura && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length > 0 ? linhas : [''];
}

export function escreverRodapeEmTodasAsPaginas(pdf: PDFDocument, r: Rodape): void {
  const paginas = pdf.getPages();
  const cinza = rgb(0.5, 0.5, 0.5);
  const tamanho = r.tamanho ?? 6.8;
  const base = r.base ?? 38;

  paginas.forEach((pagina, indice) => {
    const partes = [
      r.texto,
      r.codigoVerificacao
        ? `Código de verificação: ${r.codigoVerificacao}${r.url ? ` — ${r.url}` : ''}`
        : null,
      // Numeracao so quando ha mais de uma folha: "Pagina 1 de 1" num
      // documento de uma pagina e ruido.
      paginas.length > 1 ? `Página ${indice + 1} de ${paginas.length}` : null,
    ].filter((p): p is string => Boolean(p && p.trim()));

    let y = base;
    // De baixo para cima: a ultima parte da lista fica na linha de baixo.
    //
    // Cada parte e quebrada pela largura da folha. O A.S.O. fazia isso antes
    // deste modulo existir, e ao centralizar o rodape eu perdi a quebra: o
    // texto configurado pela clinica (endereco + CNPJ + telefones + e-mail
    // passa facil de 160 caracteres) saia pela margem direita em vez de
    // descer uma linha.
    for (const parte of [...partes].reverse()) {
      for (const linha of quebrarEm(parte, r.fonte, tamanho, r.largura).reverse()) {
        pagina.drawText(linha, { x: r.margem, y, size: tamanho, font: r.fonte, color: cinza });
        y += 9;
      }
    }
  });
}
