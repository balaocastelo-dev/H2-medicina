import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { LinhaPorCategoria, ResumoDoFluxo } from './fluxo-caixa';
import { desenharCabecalho, type DadosDoCabecalho } from '@/modules/documents/cabecalho';

/**
 * Relatorio financeiro do periodo, em PDF.
 *
 * "deve ser possivel tambem emitir relatorio com filtro de data, esse
 * relatorio deve ser exportado em html ou PDF, o que o sistema identificar
 * como melhor e mais rapido sem pesar no sistema."
 *
 * PDF: imprime igual em qualquer maquina, nao depende de navegador e vai
 * anexo em e-mail para o contador sem perder formatacao. HTML abriria
 * diferente em cada tela e ninguem consegue arquivar.
 */

export interface DadosDoRelatorio {
  clinica: DadosDoCabecalho;
  periodo: { rotulo: string; inicio: string; fim: string };
  emitidoEm: Date;
  emitidoPor: string;
  resumo: ResumoDoFluxo;
  despesas: LinhaPorCategoria[];
  receitas: LinhaPorCategoria[];
  rodape: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 46;
const LARGURA = A4[0] - MARGEM * 2;

/**
 * Dinheiro em texto que a fonte do PDF consegue escrever.
 *
 * O `Intl` do Node usa espaco estreito sem quebra (U+00A0/U+202F) entre
 * "R$" e o numero, e o sinal de menos tipografico (U+2212) nos negativos.
 * A fonte padrao do PDF nao tem esses caracteres e a geracao falha inteira
 * — um relatorio que nao abre e pior do que um sinal feio.
 */
const dinheiro = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(v)
    .replace(/[  ]/g, ' ')
    .replace(/−/g, '-');

const dataBr = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

export async function buildRelatorioFinanceiro(d: DadosDoRelatorio): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pagina = pdf.addPage(A4);

  const cinza = rgb(0.42, 0.45, 0.5);
  const preto = rgb(0.1, 0.1, 0.12);
  const verde = rgb(0.13, 0.6, 0.33);
  const vermelho = rgb(0.78, 0.2, 0.2);

  let y = await desenharCabecalho(pdf, pagina, d.clinica, {
    titulo: 'RELATÓRIO FINANCEIRO',
    fonte,
    negrito,
    margem: MARGEM,
    largura: A4[0],
    alturaDaPagina: A4[1],
  });

  pagina.drawText(
    `Período: ${d.periodo.rotulo} — ${dataBr(d.periodo.inicio)} a ${dataBr(d.periodo.fim)}`,
    { x: MARGEM, y, size: 9, font: negrito, color: preto },
  );
  y -= 11;
  const emissao = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d.emitidoEm);
  pagina.drawText(`Emitido em ${emissao} por ${d.emitidoPor}`, {
    x: MARGEM, y, size: 7.5, font: fonte, color: cinza,
  });
  y -= 18;

  const faixa = (titulo: string) => {
    pagina.drawRectangle({ x: MARGEM, y: y - 12, width: LARGURA, height: 15, color: rgb(0.93, 0.94, 0.95) });
    pagina.drawText(titulo, { x: MARGEM + 6, y: y - 8.5, size: 8.5, font: negrito, color: rgb(0.2, 0.22, 0.25) });
    y -= 22;
  };

  const linha = (rotulo: string, valor: number, opcoes: { destaque?: boolean; cor?: typeof preto } = {}) => {
    const f = opcoes.destaque ? negrito : fonte;
    pagina.drawText(rotulo, { x: MARGEM + 6, y, size: opcoes.destaque ? 9.5 : 8.5, font: f, color: opcoes.cor ?? preto });
    const texto = dinheiro(valor);
    pagina.drawText(texto, {
      x: A4[0] - MARGEM - 6 - f.widthOfTextAtSize(texto, opcoes.destaque ? 9.5 : 8.5),
      y,
      size: opcoes.destaque ? 9.5 : 8.5,
      font: f,
      color: opcoes.cor ?? preto,
    });
    y -= opcoes.destaque ? 15 : 12.5;
  };

  const separador = () => {
    pagina.drawLine({
      start: { x: MARGEM + 6, y: y + 4 },
      end: { x: A4[0] - MARGEM - 6, y: y + 4 },
      thickness: 0.6,
      color: rgb(0.85, 0.87, 0.89),
    });
    y -= 4;
  };

  // -------------------------------------------------------------------
  faixa('Resultado do período (competência)');
  linha('Receita faturada', d.resumo.receita);
  linha('(-)Despesas da clínica', d.resumo.despesa);
  linha('(-)Repasse médico', d.resumo.repasse);
  separador();
  linha('Resultado', d.resumo.resultado, {
    destaque: true,
    cor: d.resumo.resultado >= 0 ? verde : vermelho,
  });
  if (d.resumo.margem !== null) {
    pagina.drawText(`Margem sobre a receita: ${d.resumo.margem}%`, {
      x: MARGEM + 6, y, size: 7.5, font: fonte, color: cinza,
    });
    y -= 14;
  }
  y -= 6;

  // -------------------------------------------------------------------
  faixa('Caixa do período');
  linha('Entrou', d.resumo.entradas, { cor: verde });
  linha('Saiu', d.resumo.saidas, { cor: vermelho });
  separador();
  linha('Saldo de caixa', d.resumo.saldoDeCaixa, {
    destaque: true,
    cor: d.resumo.saldoDeCaixa >= 0 ? verde : vermelho,
  });
  y -= 6;

  // -------------------------------------------------------------------
  faixa('Pendente');
  linha('A receber', d.resumo.aReceber);
  linha('A pagar (inclui repasse)', d.resumo.aPagar);
  y -= 6;

  // -------------------------------------------------------------------
  const tabela = (titulo: string, linhas: LinhaPorCategoria[], vazio: string) => {
    faixa(titulo);
    if (linhas.length === 0) {
      pagina.drawText(vazio, { x: MARGEM + 6, y, size: 8, font: fonte, color: cinza });
      y -= 16;
      return;
    }
    for (const l of linhas.slice(0, 12)) {
      pagina.drawText(l.categoria.slice(0, 46), { x: MARGEM + 6, y, size: 8.5, font: fonte, color: preto });
      const fatia = `${l.fatia}%`;
      pagina.drawText(fatia, { x: A4[0] - MARGEM - 110, y, size: 8, font: fonte, color: cinza });
      const texto = dinheiro(l.valor);
      pagina.drawText(texto, {
        x: A4[0] - MARGEM - 6 - fonte.widthOfTextAtSize(texto, 8.5),
        y,
        size: 8.5,
        font: fonte,
        color: preto,
      });
      y -= 12.5;
    }
    y -= 6;
  };

  tabela('Despesas por categoria', d.despesas, 'Nenhuma despesa no período.');
  tabela('Receita por origem', d.receitas, 'Nenhuma receita no período.');

  // -------------------------------------------------------------------
  if (d.resumo.resultado > 0 && d.resumo.saldoDeCaixa < 0) {
    pagina.drawRectangle({
      x: MARGEM, y: y - 26, width: LARGURA, height: 32,
      color: rgb(0.99, 0.96, 0.9), borderColor: rgb(0.85, 0.6, 0.2), borderWidth: 0.8,
    });
    pagina.drawText('Resultado positivo com caixa negativo', {
      x: MARGEM + 8, y: y - 8, size: 8.5, font: negrito, color: rgb(0.6, 0.4, 0.1),
    });
    pagina.drawText(
      'Foi faturado mais do que se gastou, mas o dinheiro ainda não entrou.',
      { x: MARGEM + 8, y: y - 19, size: 7.5, font: fonte, color: cinza },
    );
    y -= 38;
  }

  let yr = 40;
  for (const parte of [
    d.rodape,
    'Relatório gerado pelo sistema a partir das cobranças, contas a pagar e repasses registrados.',
  ].filter(Boolean) as string[]) {
    pagina.drawText(parte.slice(0, 160), { x: MARGEM, y: yr, size: 6.5, font: fonte, color: cinza });
    yr += 9;
  }

  return pdf.save();
}
