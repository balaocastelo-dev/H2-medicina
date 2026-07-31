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
}

export interface PdfSection {
  title?: string;
  lines: { label?: string; value: string }[];
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
  signatureName?: string | null;
  signatureRole?: string | null;
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
  page.drawText(input.brand.systemName, { x: margin, y, size: 16, font: bold, color: brandColor });
  y -= 16;
  page.drawText(input.brand.legalName, {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 12;

  for (const line of [input.brand.document, input.brand.address, input.brand.contact].filter(
    Boolean,
  )) {
    page.drawText(String(line), { x: margin, y, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
    y -= 10;
  }

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
