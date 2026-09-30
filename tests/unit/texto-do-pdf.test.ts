import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { cabeNoPdf, protegerPagina, textoSeguroParaPdf } from '@/modules/documents/texto-do-pdf';

/**
 * Um caractere colado num campo nao pode impedir a emissao do documento.
 *
 * As fontes padrao do PDF usam a tabela WinAnsi, e a `pdf-lib` LANCA ao
 * encontrar o que esta fora dela -- derrubando a geracao inteira, com um
 * "Erro inesperado" que nao diz nada. Os literais do codigo sao seguros; o
 * risco e o que a clinica digita e que vai impresso: conclusao do medico,
 * observacoes, restricoes, razao social, rodape.
 */

const c = (n: number) => String.fromCharCode(n);

describe('o que a fonte não tem vira algo que ela tem', () => {
  it.each([
    [0x2264, '<=', 'menor ou igual — aparece em laudo de audiometria'],
    [0x2192, '->', 'seta — aparece em campo de preparo e em observação'],
    [0x00bd, '1/2', 'meio — aparece em posologia'],
    [0x2026, '...', 'reticências de um caractere só'],
    [0x2019, "'", 'apóstrofo curvo, que o Word insere sozinho'],
    [0x201c, '"', 'aspas curvas, idem'],
  ])('o código %s vira "%s" (%s)', (ponto, esperado) => {
    expect(textoSeguroParaPdf(`antes ${c(ponto as number)} depois`)).toBe(
      `antes ${esperado} depois`,
    );
  });

  it('o espaço estreito do Intl vira espaço comum', () => {
    // `Intl.NumberFormat` em pt-BR separa "R$" do número com espaço
    // estreito sem quebra. Ele está em TODO valor em reais do sistema.
    const comEstreito = `R$${c(0x202f)}1.234,56`;
    expect(textoSeguroParaPdf(comEstreito)).toBe('R$ 1.234,56');
  });

  it('emoji some, e o resto da frase fica', () => {
    // Emoji vive acima de U+FFFF e chega em par substituto: o par inteiro
    // precisa sair junto, senão sobra meio caractere quebrado.
    expect(textoSeguroParaPdf('Paciente tranquilo \u{1F642} sem queixas')).toBe(
      'Paciente tranquilo  sem queixas',
    );
  });

  it('o que não é conhecido vira "?", e não some calado', () => {
    // Sumir sem deixar rastro mudaria o sentido sem ninguém perceber. Um
    // "?" visível é o convite para alguém corrigir.
    expect(textoSeguroParaPdf(`teste ${c(0x0416)}`)).toBe('teste ?');
  });
});

describe('o que já cabia não é alterado', () => {
  it.each([
    'José da Silva Ação Ótimo Único',
    'Audiometria — via aérea · 25 dB',
    'R$ 1.234,56',
    'Rua Sacramento, 908 — Vila Itapura',
    'Apto para trabalho em altura (NR-35)',
    'Temperatura 36,5 °C · 1º andar · Nº 12',
  ])('"%s" passa intacto', (texto) => {
    expect(textoSeguroParaPdf(texto)).toBe(texto);
    expect(cabeNoPdf(texto)).toBe(true);
  });

  it('quebra de linha e tabulação sobrevivem', () => {
    expect(textoSeguroParaPdf('linha 1\nlinha 2\tfim')).toBe('linha 1\nlinha 2\tfim');
  });

  it('nulo e indefinido viram vazio, não "null"', () => {
    expect(textoSeguroParaPdf(null)).toBe('');
    expect(textoSeguroParaPdf(undefined)).toBe('');
  });
});

describe('a página protegida não deixa o PDF quebrar', () => {
  it('a pdf-lib LANÇA sem a proteção — é isto que o teste previne', async () => {
    const pdf = await PDFDocument.create();
    const fonte = await pdf.embedFont(StandardFonts.Helvetica);
    const pagina = pdf.addPage([300, 300]);

    // A referência: sem proteção, um caractere derruba tudo.
    expect(() =>
      pagina.drawText(`limiar ${c(0x2264)} 25 dB`, { x: 10, y: 10, size: 10, font: fonte }),
    ).toThrow(/WinAnsi|encode/i);
  });

  it('com a proteção, o mesmo texto passa e o PDF é gerado', async () => {
    const pdf = await PDFDocument.create();
    const fonte = await pdf.embedFont(StandardFonts.Helvetica);
    const pagina = protegerPagina(pdf.addPage([300, 300]));

    expect(() =>
      pagina.drawText(`limiar ${c(0x2264)} 25 dB \u{1F642}`, {
        x: 10,
        y: 10,
        size: 10,
        font: fonte,
      }),
    ).not.toThrow();

    const bytes = await pdf.save();
    expect(bytes.byteLength).toBeGreaterThan(400);
  });
});
