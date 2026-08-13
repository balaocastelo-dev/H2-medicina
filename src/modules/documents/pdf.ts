import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface PdfBrand {
  systemName: string;
  legalName: string;
  document: string | null;
  address: string | null;
  contact: string | null;
  headerText: string | null;
  footerText: string | null;
  primaryColor: string;
  /** Logo do tenant no cabecalho. PNG ou JPEG. */
  logo?: { bytes: Uint8Array; format: 'png' | 'jpg' } | null;
}

/** Base para resolver caminhos relativos do proprio app. */
function baseDoApp(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000'
  );
}

/**
 * Baixa o logo do tenant para carimbar no cabecalho.
 *
 * Falha aqui nunca pode impedir a emissao: sem o logo o documento sai com
 * o nome do sistema em texto, como antes. Documento que nao sai atrapalha
 * o atendimento; documento sem logo, nao.
 */
export async function carregarLogo(
  url: string | null | undefined,
): Promise<{ bytes: Uint8Array; format: 'png' | 'jpg' } | null> {
  if (!url) return null;
  try {
    // Caminho relativo (arquivo servido pelo proprio app) precisa virar
    // absoluto: fetch no servidor nao tem uma "pagina atual" como base.
    const absoluta = url.startsWith('/') ? new URL(url, baseDoApp()).toString() : url;

    const resposta = await fetch(absoluta, { cache: 'force-cache' });
    if (!resposta.ok) return null;

    const tipo = resposta.headers.get('content-type') ?? '';
    const formato: 'png' | 'jpg' =
      tipo.includes('jpeg') || tipo.includes('jpg') || /\.jpe?g($|\?)/i.test(url) ? 'jpg' : 'png';

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 4_000_000) return null;
    return { bytes, format: formato };
  } catch {
    return null;
  }
}

export interface PdfSection {
  title?: string;
  lines: { label?: string; value: string }[];
}

/**
 * Bloco de assinatura no pe do documento.
 *
 * Aceita o traco desenhado na tela (PNG). Quando nao vem imagem, sai a
 * linha em branco de sempre — e o mesmo documento serve para assinar no
 * papel.
 */
export interface PdfSignatureBlock {
  name?: string | null;
  role?: string | null;
  /** Legenda abaixo da linha, tipo "Assinatura do funcionario". */
  caption?: string | null;
  /** PNG do traco coletado na tela. */
  imagePng?: Uint8Array | null;
  /** Linhas complementares: nome legivel, RG, CPF. */
  lines?: string[];
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0.3,
    Number.isFinite(b) ? b : 0.3,
  );
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Gera um PDF A4 com cabecalho/rodape do tenant.
 * Todo o conteudo visual vem das configuracoes — nada e fixado no codigo.
 */
export async function buildDocumentPdf(input: {
  brand: PdfBrand;
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  body?: string;
  /** Texto longo em varios paragrafos — termos, contratos, clausulas. */
  paragraphs?: string[];
  signatureName?: string | null;
  signatureRole?: string | null;
  signatureBlocks?: PdfSignatureBlock[];
  verificationCode?: string | null;
  verificationUrl?: string | null;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brandColor = hexToRgb(input.brand.primaryColor);

  let page: PDFPage = pdf.addPage([595.28, 841.89]); // A4
  const margin = 48;
  const maxWidth = 595.28 - margin * 2;
  let y = 841.89 - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin + 90) {
      page = pdf.addPage([595.28, 841.89]);
      y = 841.89 - margin;
    }
  };

  // Cabecalho
  page.drawRectangle({ x: 0, y: 841.89 - 8, width: 595.28, height: 8, color: brandColor });

  // Logo a direita, alinhado com o topo do bloco de identificacao.
  let logoAltura = 0;
  if (input.brand.logo && input.brand.logo.bytes.byteLength > 0) {
    try {
      const imagem =
        input.brand.logo.format === 'jpg'
          ? await pdf.embedJpg(input.brand.logo.bytes)
          : await pdf.embedPng(input.brand.logo.bytes);

      const alturaMaxima = 52;
      const larguraMaxima = 150;
      const escala = Math.min(alturaMaxima / imagem.height, larguraMaxima / imagem.width);
      const largura = imagem.width * escala;
      logoAltura = imagem.height * escala;

      page.drawImage(imagem, {
        x: 595.28 - margin - largura,
        y: y - logoAltura + 12,
        width: largura,
        height: logoAltura,
      });
    } catch {
      // Logo corrompido nao derruba a emissao: segue so com o texto.
      logoAltura = 0;
    }
  }

  // Com logo, o nome da empresa carrega o cabecalho; sem ele, o nome do
  // sistema precisa ocupar esse papel.
  const larguraTexto = logoAltura > 0 ? 595.28 - margin * 2 - 165 : 595.28 - margin * 2;

  page.drawText(input.brand.systemName, { x: margin, y, size: 16, font: bold, color: brandColor });
  y -= 16;

  for (const linha of wrap(input.brand.legalName, font, 9, larguraTexto)) {
    page.drawText(linha, { x: margin, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    y -= 12;
  }

  for (const line of [input.brand.document, input.brand.address, input.brand.contact].filter(
    Boolean,
  )) {
    for (const linha of wrap(String(line), font, 8, larguraTexto)) {
      page.drawText(linha, { x: margin, y, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
      y -= 10;
    }
  }

  // O logo pode ser mais alto que o texto ao lado; a regua so desce depois
  // que o maior dos dois termina, senao o titulo entra por baixo dele.
  const baseDoLogo = 841.89 - margin - logoAltura + 6;
  if (logoAltura > 0 && y > baseDoLogo) y = baseDoLogo;

  if (input.brand.headerText) {
    for (const line of wrap(input.brand.headerText, font, 8, maxWidth)) {
      page.drawText(line, { x: margin, y, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
      y -= 10;
    }
  }

  y -= 10;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595.28 - margin, y },
    thickness: 0.8,
    color: rgb(0.85, 0.85, 0.85),
  });
  y -= 28;

  // Titulo
  page.drawText(input.title.toUpperCase(), { x: margin, y, size: 14, font: bold });
  y -= 16;
  if (input.subtitle) {
    page.drawText(input.subtitle, { x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 16;
  }
  y -= 8;

  // Secoes
  for (const section of input.sections) {
    ensureSpace(40);
    if (section.title) {
      page.drawText(section.title, { x: margin, y, size: 10, font: bold, color: brandColor });
      y -= 14;
    }
    for (const line of section.lines) {
      ensureSpace(16);
      if (line.label) {
        page.drawText(`${line.label}:`, { x: margin, y, size: 9, font: bold });
        const labelWidth = bold.widthOfTextAtSize(`${line.label}: `, 9);
        const wrapped = wrap(line.value, font, 9, maxWidth - labelWidth);
        page.drawText(wrapped[0] ?? '', { x: margin + labelWidth, y, size: 9, font });
        y -= 13;
        for (const extra of wrapped.slice(1)) {
          ensureSpace(14);
          page.drawText(extra, { x: margin + labelWidth, y, size: 9, font });
          y -= 13;
        }
      } else {
        for (const wrapped of wrap(line.value, font, 9, maxWidth)) {
          ensureSpace(14);
          page.drawText(wrapped, { x: margin, y, size: 9, font });
          y -= 13;
        }
      }
    }
    y -= 10;
  }

  if (input.body) {
    y -= 6;
    for (const line of wrap(input.body, font, 10, maxWidth)) {
      ensureSpace(16);
      page.drawText(line, { x: margin, y, size: 10, font });
      y -= 15;
    }
  }

  // Paragrafos longos (termos, clausulas contratuais)
  if (input.paragraphs?.length) {
    y -= 6;
    for (const paragraph of input.paragraphs) {
      // Linha vazia no texto vira respiro entre blocos.
      if (!paragraph.trim()) {
        y -= 8;
        continue;
      }
      // Titulo de clausula: curto e sem ponto final, sai em negrito.
      const isHeading = paragraph.length < 90 && /^(Cl[áa]usula|Par[áa]grafo|Art\.|ANEXO|\d+\.)/i.test(paragraph);
      const size = isHeading ? 10 : 9.5;
      const chosen = isHeading ? bold : font;
      for (const line of wrap(paragraph, chosen, size, maxWidth)) {
        ensureSpace(16);
        page.drawText(line, { x: margin, y, size, font: chosen });
        y -= size + 4;
      }
      y -= 6;
    }
  }

  // Blocos de assinatura (paciente, responsavel, testemunha)
  if (input.signatureBlocks?.length) {
    for (const block of input.signatureBlocks) {
      ensureSpace(130);
      y -= 30;

      if (block.imagePng && block.imagePng.byteLength > 0) {
        try {
          const png = await pdf.embedPng(block.imagePng);
          // Largura fixa mantem todas as assinaturas do mesmo tamanho,
          // independente de quanto espaco a pessoa usou no quadro.
          const targetWidth = 200;
          const scale = targetWidth / png.width;
          const height = Math.min(png.height * scale, 60);
          page.drawImage(png, {
            x: margin + 20,
            y: y + 4,
            width: targetWidth,
            height,
          });
        } catch {
          // PNG invalido nao pode derrubar a emissao do documento inteiro:
          // sai a linha em branco e alguem assina no papel.
        }
      }

      page.drawLine({
        start: { x: margin + 20, y },
        end: { x: margin + 280, y },
        thickness: 0.8,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 12;

      if (block.caption) {
        page.drawText(block.caption, {
          x: margin + 20,
          y,
          size: 8,
          font,
          color: rgb(0.45, 0.45, 0.45),
        });
        y -= 12;
      }
      if (block.name) {
        page.drawText(block.name, { x: margin + 20, y, size: 9.5, font: bold });
        y -= 12;
      }
      if (block.role) {
        page.drawText(block.role, { x: margin + 20, y, size: 8.5, font, color: rgb(0.4, 0.4, 0.4) });
        y -= 12;
      }
      for (const extra of block.lines ?? []) {
        ensureSpace(14);
        page.drawText(extra, { x: margin + 20, y, size: 8.5, font, color: rgb(0.35, 0.35, 0.35) });
        y -= 12;
      }
      y -= 10;
    }
  }

  // Assinatura
  if (input.signatureName) {
    ensureSpace(80);
    y -= 40;
    page.drawLine({
      start: { x: margin + 120, y },
      end: { x: 595.28 - margin - 120, y },
      thickness: 0.8,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 12;
    const nameWidth = bold.widthOfTextAtSize(input.signatureName, 10);
    page.drawText(input.signatureName, { x: (595.28 - nameWidth) / 2, y, size: 10, font: bold });
    y -= 12;
    if (input.signatureRole) {
      const roleWidth = font.widthOfTextAtSize(input.signatureRole, 9);
      page.drawText(input.signatureRole, {
        x: (595.28 - roleWidth) / 2,
        y,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }

  // Rodape em todas as paginas
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    const footerParts = [
      input.brand.footerText,
      input.verificationCode
        ? `Codigo de verificacao: ${input.verificationCode}${input.verificationUrl ? ` — ${input.verificationUrl}` : ''}`
        : null,
      `Pagina ${index + 1} de ${pages.length}`,
    ].filter(Boolean) as string[];

    let fy = 42;
    for (const part of footerParts.reverse()) {
      p.drawText(part, { x: margin, y: fy, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
      fy += 10;
    }
  });

  return pdf.save();
}
