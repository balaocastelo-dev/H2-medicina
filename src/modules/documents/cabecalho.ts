import 'server-only';
import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SessionContext } from '@/lib/auth';
import { carregarLogo } from './pdf';

/**
 * Cabecalho comum a todo papel que sai da clinica.
 *
 * Os documentos genericos (comprovante, recibo, ficha) sempre tiveram um
 * cabecalho completo, montado pelo `buildDocumentPdf`. Os PDFs desenhados a
 * mao -- guia de exame, laudo de audiometria, relatorio financeiro -- cada
 * um trazia o seu, e os tres divergiam: um sem CNPJ, outro sem endereco,
 * outro sem logo.
 *
 * Papel que vai para empresa cliente ou fiscal precisa dizer de onde veio.
 * Agora e um so: mudou aqui, muda em todos.
 */

export interface DadosDoCabecalho {
  nome: string;
  razaoSocial: string | null;
  cnpj: string | null;
  endereco: string | null;
  contato: string | null;
  cor: string;
  logo: { bytes: Uint8Array; format: 'png' | 'jpg' } | null;
}

/** Monta os dados do cabecalho a partir da sessao. */
export async function cabecalhoDaClinica(ctx: SessionContext): Promise<DadosDoCabecalho> {
  const empresa = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
  const contato = (ctx.settings.contato ?? {}) as Record<string, string | null>;

  const endereco = [
    contato.logradouro,
    contato.numero,
    contato.complemento,
    contato.bairro,
    contato.cidade,
    contato.estado,
  ]
    .filter(Boolean)
    .join(', ');

  const linhaContato = [contato.telefone_fixo ?? contato.telefone, contato.whatsapp, contato.email]
    .filter(Boolean)
    .join(' · ');

  return {
    nome: ctx.branding.system_name,
    razaoSocial: empresa.razao_social ?? ctx.tenant.legal_name,
    cnpj: empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
    endereco: endereco || null,
    contato: linhaContato || null,
    cor: ctx.branding.color_primary,
    logo: await carregarLogo(ctx.branding.logo_url),
  };
}

export function corDaMarca(hex: string) {
  const limpo = (hex ?? '').replace('#', '');
  const cheio = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  const n = (i: number) => parseInt(cheio.slice(i, i + 2), 16) / 255;
  const [r, g, b] = [n(0), n(2), n(4)];
  return rgb(
    Number.isFinite(r) ? r : 0.06,
    Number.isFinite(g) ? g : 0.46,
    Number.isFinite(b) ? b : 0.43,
  );
}

/**
 * Desenha o cabecalho e devolve o `y` onde o conteudo pode comecar.
 *
 * O titulo vai a direita, na mesma altura do nome da clinica: e assim que
 * o modelo em papel da clinica e diagramado.
 */
export async function desenharCabecalho(
  pdf: PDFDocument,
  pagina: PDFPage,
  d: DadosDoCabecalho,
  opcoes: {
    titulo: string;
    fonte: PDFFont;
    negrito: PDFFont;
    margem: number;
    largura: number;
    alturaDaPagina: number;
  },
): Promise<number> {
  const { titulo, fonte, negrito, margem, largura, alturaDaPagina } = opcoes;
  const cor = corDaMarca(d.cor);
  const cinza = rgb(0.45, 0.47, 0.5);

  pagina.drawRectangle({ x: 0, y: alturaDaPagina - 5, width: largura, height: 5, color: cor });

  let y = alturaDaPagina - margem;

  // Logo a esquerda, quando houver.
  let alturaLogo = 0;
  let recuo = margem;
  if (d.logo && d.logo.bytes.byteLength > 0) {
    try {
      const img =
        d.logo.format === 'jpg' ? await pdf.embedJpg(d.logo.bytes) : await pdf.embedPng(d.logo.bytes);
      const escala = Math.min(40 / img.height, 110 / img.width);
      alturaLogo = img.height * escala;
      pagina.drawImage(img, {
        x: margem,
        y: y - alturaLogo + 8,
        width: img.width * escala,
        height: alturaLogo,
      });
      recuo = margem + img.width * escala + 10;
    } catch {
      // Logo corrompida nunca impede a emissao: o paciente esta esperando.
      alturaLogo = 0;
    }
  }

  // Titulo do documento, a direita.
  pagina.drawText(titulo, {
    x: largura - margem - negrito.widthOfTextAtSize(titulo, 15),
    y: y - 4,
    size: 15,
    font: negrito,
    color: rgb(0.11, 0.12, 0.14),
  });

  // Identificacao da clinica, a esquerda do titulo.
  pagina.drawText(d.nome, { x: recuo, y: y - 2, size: 9.5, font: negrito, color: cor });
  let yTexto = y - 14;
  for (const linha of [d.razaoSocial, d.cnpj, d.endereco, d.contato].filter(Boolean) as string[]) {
    // Corta em vez de invadir o titulo.
    let texto = linha;
    const disponivel = largura - margem * 2 - (recuo - margem) - 150;
    while (fonte.widthOfTextAtSize(texto, 7.2) > disponivel && texto.length > 8) {
      texto = texto.slice(0, -2);
    }
    pagina.drawText(texto, { x: recuo, y: yTexto, size: 7.2, font: fonte, color: cinza });
    yTexto -= 9.2;
  }

  // Desce depois do mais alto entre o logo e o texto.
  const baseLogo = y - alturaLogo - 2;
  return Math.min(yTexto, baseLogo) - 12;
}
