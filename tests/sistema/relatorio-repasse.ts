/**
 * Relatorio de pagamento dos medicos, em PDF.
 *
 * Monta a folha que a clinica manda para cada medico e para a contabilidade:
 * quantos atendimentos, quanto por procedimento, quanto ja foi pago e quanto
 * esta a pagar.
 *
 * Os numeros saem de `agruparPorMedico`, a MESMA funcao que a tela "Meus
 * ganhos" usa. Se o relatorio e a tela discordassem, um dos dois estaria
 * errado -- e o medico descobriria no fim do mes.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ResumoMedico } from '@/modules/finance/repasse';

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 46;
const LARGURA = A4[0] - MARGEM * 2;

const VERDE = rgb(0.06, 0.46, 0.43);
const PRETO = rgb(0.1, 0.12, 0.15);
const CINZA = rgb(0.42, 0.45, 0.5);
const LINHA = rgb(0.85, 0.87, 0.88);

/**
 * Dinheiro que a fonte padrao do PDF consegue escrever.
 *
 * O `Intl` usa espaco estreito sem quebra e o sinal de menos tipografico;
 * a fonte padrao nao tem esses caracteres e a geracao falha inteira. Um
 * relatorio que nao abre e pior que um sinal feio.
 */
const dinheiro = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(v)
    .replace(/[  ]/g, ' ')
    .replace(/−/g, '-');

export interface DadosDoRepasse {
  clinica: string;
  titulo: string;
  subtitulo: string;
  resumos: ResumoMedico[];
}

export async function construirRelatorioDeRepasse(d: DadosDoRepasse): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  let pagina = pdf.addPage(A4);
  let y = A4[1] - MARGEM;

  /** Abre uma pagina nova quando o que vem nao cabe mais. */
  const espaco = (altura: number) => {
    if (y - altura < MARGEM + 40) {
      pagina = pdf.addPage(A4);
      y = A4[1] - MARGEM;
    }
  };

  const texto = (
    t: string,
    opcoes: { x?: number; size?: number; font?: typeof fonte; color?: typeof PRETO } = {},
  ) => {
    pagina.drawText(t, {
      x: opcoes.x ?? MARGEM,
      y,
      size: opcoes.size ?? 10,
      font: opcoes.font ?? fonte,
      color: opcoes.color ?? PRETO,
    });
  };

  const direita = (t: string, size = 10, font = fonte, color = PRETO) => {
    const largura = font.widthOfTextAtSize(t, size);
    pagina.drawText(t, { x: MARGEM + LARGURA - largura, y, size, font, color });
  };

  const risco = () => {
    pagina.drawLine({
      start: { x: MARGEM, y },
      end: { x: MARGEM + LARGURA, y },
      thickness: 0.5,
      color: LINHA,
    });
  };

  // ---------------------------------------------------------------- capa
  texto(d.clinica.toUpperCase(), { size: 8, font: negrito, color: VERDE });
  y -= 26;
  texto(d.titulo, { size: 18, font: negrito });
  y -= 18;
  texto(d.subtitulo, { size: 9.5, color: CINZA });
  y -= 10;
  risco();
  y -= 22;

  // Aviso que precisa estar em todo lugar: sao dados de teste.
  texto('AMOSTRA DE TESTE — pacientes, empresas e médicos fictícios.', {
    size: 8.5,
    font: negrito,
    color: rgb(0.72, 0.25, 0.05),
  });
  y -= 24;

  // -------------------------------------------------------------- resumo
  const total = d.resumos.reduce((s, r) => s + r.total, 0);
  const aPagar = d.resumos.reduce((s, r) => s + r.aPagar, 0);
  const pago = d.resumos.reduce((s, r) => s + r.pago, 0);
  const atendimentos = d.resumos.reduce((s, r) => s + r.atendimentos, 0);

  const cartoes: [string, string][] = [
    ['Atendimentos', String(atendimentos)],
    ['Total', dinheiro(total)],
    ['A pagar', dinheiro(aPagar)],
    ['Pago', dinheiro(pago)],
  ];
  const col = LARGURA / cartoes.length;
  const base = y;
  cartoes.forEach(([rotulo, valor], i) => {
    const x = MARGEM + col * i;
    pagina.drawText(valor, { x, y: base, size: 14, font: negrito, color: VERDE });
    pagina.drawText(rotulo, { x, y: base - 13, size: 8, font: fonte, color: CINZA });
  });
  y = base - 34;
  risco();
  y -= 24;

  // ------------------------------------------------------------- medicos
  for (const r of d.resumos) {
    espaco(70 + r.porProcedimento.length * 14);

    texto(r.medico, { size: 12, font: negrito });
    direita(dinheiro(r.total), 12, negrito, VERDE);
    y -= 14;

    texto(
      `${r.atendimentos} atendimento(s) · a pagar ${dinheiro(r.aPagar)} · pago ${dinheiro(r.pago)}`,
      { size: 8.5, color: CINZA },
    );
    y -= 16;

    // Cabecalho da tabela por procedimento.
    texto('Procedimento', { size: 8, font: negrito, color: CINZA });
    pagina.drawText('Qtd.', {
      x: MARGEM + LARGURA - 150,
      y,
      size: 8,
      font: negrito,
      color: CINZA,
    });
    direita('Valor', 8, negrito, CINZA);
    y -= 4;
    risco();
    y -= 13;

    for (const p of r.porProcedimento) {
      espaco(16);
      texto(p.nome, { size: 9.5 });
      pagina.drawText(String(p.quantidade), {
        x: MARGEM + LARGURA - 150,
        y,
        size: 9.5,
        font: fonte,
        color: PRETO,
      });
      direita(dinheiro(p.valor), 9.5);
      y -= 14;
    }

    y -= 10;
    risco();
    y -= 22;
  }

  // -------------------------------------------------------------- rodape
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    p.drawText(
      `${d.clinica} · amostra de teste · página ${i + 1} de ${paginas.length}`,
      { x: MARGEM, y: MARGEM - 16, size: 7.5, font: fonte, color: CINZA },
    );
  });

  return pdf.save();
}
