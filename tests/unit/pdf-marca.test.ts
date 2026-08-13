import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildDocumentPdf, type PdfBrand } from '@/modules/documents/pdf';

/** PNG 1x1 opaco — suficiente para exercitar a incorporacao do logo. */
const PNG_MINIMO = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const marca: PdfBrand = {
  systemName: 'H2 Medicina Ocupacional',
  legalName: 'H2 Medicina Ocupacional Ltda',
  document: 'CNPJ 52.830.198/0001-34',
  address: 'Rua Sacramento, 908, Vila Itapura, Campinas, SP',
  contact: '(19) 0000-0000 · contato@h2.com.br',
  headerText: null,
  footerText: 'Documento emitido eletronicamente',
  primaryColor: '#045B6F',
};

describe('documento em PDF', () => {
  it('gera um PDF válido sem logo', async () => {
    const bytes = await buildDocumentPdf({
      brand: marca,
      title: 'Comprovante de comparecimento',
      sections: [{ title: 'Identificação', lines: [{ label: 'Paciente', value: 'Maria Silva' }] }],
    });

    expect(bytes.byteLength).toBeGreaterThan(500);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('incorpora o logo quando ele vem na marca', async () => {
    const semLogo = await buildDocumentPdf({ brand: marca, title: 'Termo', sections: [] });
    const comLogo = await buildDocumentPdf({
      brand: { ...marca, logo: { bytes: PNG_MINIMO, format: 'png' } },
      title: 'Termo',
      sections: [],
    });

    // O PDF com imagem carrega um objeto a mais; comparar tamanhos é
    // suficiente para saber que o logo entrou no arquivo.
    expect(comLogo.byteLength).toBeGreaterThan(semLogo.byteLength);
    await expect(PDFDocument.load(comLogo)).resolves.toBeDefined();
  });

  it('não deixa um logo corrompido derrubar a emissão', async () => {
    // Documento que não sai atrapalha o atendimento; documento sem logo, não.
    const bytes = await buildDocumentPdf({
      brand: { ...marca, logo: { bytes: Uint8Array.from([1, 2, 3, 4]), format: 'png' } },
      title: 'Recibo de pagamento',
      sections: [],
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it('quebra o contrato longo em várias páginas', async () => {
    const paragrafos = Array.from({ length: 60 }, (_, i) =>
      i % 6 === 0
        ? `Cláusula ${i / 6 + 1}ª – DAS OBRIGAÇÕES`
        : 'Parágrafo de texto corrido com extensão suficiente para ocupar mais de uma linha na página, repetido para forçar a paginação do documento gerado.',
    );

    const bytes = await buildDocumentPdf({
      brand: marca,
      title: 'Contrato de prestação de serviços',
      sections: [],
      paragraphs: paragrafos,
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it('desenha o bloco de assinatura com o traço coletado na tela', async () => {
    const bytes = await buildDocumentPdf({
      brand: marca,
      title: 'Autorização para entrega de prontuário à empresa',
      sections: [],
      paragraphs: ['Ciente do exposto acima, eu, Maria Silva, AUTORIZO...'],
      signatureBlocks: [
        {
          caption: 'Assinatura do funcionário autorizado',
          name: 'Maria Silva',
          imagePng: PNG_MINIMO,
          lines: ['RG 12.345.678-9', 'CPF 390.533.447-05'],
        },
      ],
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
