import 'server-only';
import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  DB_MAXIMO,
  DB_MINIMO,
  FREQUENCIAS,
  LIMITE_NORMALIDADE,
  linhasDeDb,
  pontosDoGrafico,
  rotuloFrequencia,
  xDaFrequencia,
  yDoLimiar,
  type CaixaDoGrafico,
  type Limiares,
  type Orelha,
} from './audiograma';

/**
 * Desenho do audiograma no laudo.
 *
 * Segue a convencao do audiograma de papel, que e o que o audiologista e o
 * medico do trabalho leem sem precisar de legenda:
 *
 *   - eixo vertical invertido, -10 dB no topo e 120 dB embaixo;
 *   - orelha direita em vermelho, marcada com "O";
 *   - orelha esquerda em azul, marcada com "X";
 *   - linha tracejada em 25 dB, o limite de normalidade da NR-7.
 *
 * As cores e os simbolos sao padrao internacional. Trocar por outra coisa
 * mais bonita faria o leitor parar para entender o desenho.
 */

const VERMELHO = rgb(0.78, 0.15, 0.15);
const AZUL = rgb(0.13, 0.34, 0.72);
const GRADE = rgb(0.82, 0.85, 0.88);
const GRADE_FORTE = rgb(0.55, 0.59, 0.63);
const TEXTO = rgb(0.3, 0.33, 0.36);

export const COR_DA_ORELHA: Record<Orelha, ReturnType<typeof rgb>> = {
  od: VERMELHO,
  oe: AZUL,
};

export interface OpcoesDoAudiograma {
  pagina: PDFPage;
  caixa: CaixaDoGrafico;
  fonte: PDFFont;
  negrito: PDFFont;
  titulo: string;
  limiares: Limiares;
  orelha: Orelha;
}

/** Desenha um audiograma completo: grade, eixos, curva e simbolos. */
export function desenharAudiograma({
  pagina,
  caixa,
  fonte,
  negrito,
  titulo,
  limiares,
  orelha,
}: OpcoesDoAudiograma): void {
  const cor = COR_DA_ORELHA[orelha];

  pagina.drawText(titulo, {
    x: caixa.x,
    y: caixa.y + caixa.altura + 14,
    size: 8.5,
    font: negrito,
    color: cor,
  });

  // Linhas horizontais, de 10 em 10 dB.
  for (const db of linhasDeDb()) {
    const y = yDoLimiar(db, caixa);
    const destaque = db === LIMITE_NORMALIDADE;

    pagina.drawLine({
      start: { x: caixa.x, y },
      end: { x: caixa.x + caixa.largura, y },
      thickness: destaque ? 0.9 : 0.4,
      color: destaque ? GRADE_FORTE : GRADE,
      dashArray: destaque ? [2, 2] : undefined,
    });

    // Rotulo em dB a cada 20, para o eixo nao virar uma parede de numeros.
    if (db % 20 === 0) {
      pagina.drawText(String(db), {
        x: caixa.x - 16,
        y: y - 2,
        size: 5.5,
        font: fonte,
        color: TEXTO,
      });
    }
  }

  // Linhas verticais, uma por frequencia.
  for (const hz of FREQUENCIAS) {
    const x = xDaFrequencia(hz, caixa);
    pagina.drawLine({
      start: { x, y: caixa.y },
      end: { x, y: caixa.y + caixa.altura },
      thickness: 0.4,
      color: GRADE,
    });
    pagina.drawText(rotuloFrequencia(hz), {
      x: x - 5,
      y: caixa.y - 9,
      size: 5.5,
      font: fonte,
      color: TEXTO,
    });
  }

  // Moldura.
  pagina.drawRectangle({
    x: caixa.x,
    y: caixa.y,
    width: caixa.largura,
    height: caixa.altura,
    borderColor: GRADE_FORTE,
    borderWidth: 0.8,
  });

  pagina.drawText('dB', { x: caixa.x - 18, y: caixa.y + caixa.altura + 3, size: 5.5, font: fonte, color: TEXTO });
  pagina.drawText('Hz', { x: caixa.x + caixa.largura + 3, y: caixa.y - 9, size: 5.5, font: fonte, color: TEXTO });

  const pontos = pontosDoGrafico(limiares, caixa);
  if (pontos.length === 0) {
    pagina.drawText('sem medição registrada', {
      x: caixa.x + caixa.largura / 2 - 30,
      y: caixa.y + caixa.altura / 2,
      size: 6.5,
      font: fonte,
      color: TEXTO,
    });
    return;
  }

  // Curva ligando os pontos medidos.
  for (let i = 1; i < pontos.length; i += 1) {
    const de = pontos[i - 1]!;
    const para = pontos[i]!;
    pagina.drawLine({
      start: { x: de.x, y: de.y },
      end: { x: para.x, y: para.y },
      thickness: 1,
      color: cor,
    });
  }

  // Simbolo em cada ponto: O para a direita, X para a esquerda.
  for (const ponto of pontos) {
    if (orelha === 'od') {
      pagina.drawCircle({
        x: ponto.x,
        y: ponto.y,
        size: 2.6,
        borderColor: cor,
        borderWidth: 1.1,
      });
    } else {
      const r = 2.4;
      pagina.drawLine({
        start: { x: ponto.x - r, y: ponto.y - r },
        end: { x: ponto.x + r, y: ponto.y + r },
        thickness: 1.1,
        color: cor,
      });
      pagina.drawLine({
        start: { x: ponto.x - r, y: ponto.y + r },
        end: { x: ponto.x + r, y: ponto.y - r },
        thickness: 1.1,
        color: cor,
      });
    }
  }
}

/** Legenda curta, para quem pega o laudo sem conhecer a convencao. */
export function desenharLegenda(
  pagina: PDFPage,
  x: number,
  y: number,
  fonte: PDFFont,
): void {
  pagina.drawCircle({ x: x + 3, y: y + 2, size: 2.6, borderColor: VERMELHO, borderWidth: 1.1 });
  pagina.drawText('Orelha direita', { x: x + 10, y, size: 6.5, font: fonte, color: TEXTO });

  const x2 = x + 78;
  pagina.drawLine({
    start: { x: x2, y: y - 0.4 },
    end: { x: x2 + 5, y: y + 4.6 },
    thickness: 1.1,
    color: AZUL,
  });
  pagina.drawLine({
    start: { x: x2, y: y + 4.6 },
    end: { x: x2 + 5, y: y - 0.4 },
    thickness: 1.1,
    color: AZUL,
  });
  pagina.drawText('Orelha esquerda', { x: x2 + 10, y, size: 6.5, font: fonte, color: TEXTO });

  pagina.drawText(
    `Linha tracejada: ${LIMITE_NORMALIDADE} dB  ·  escala de ${DB_MINIMO} a ${DB_MAXIMO} dB`,
    { x: x + 176, y, size: 6.5, font: fonte, color: TEXTO },
  );
}
