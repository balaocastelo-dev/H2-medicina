import { describe, expect, it } from 'vitest';
import {
  DB_MAXIMO,
  DB_MINIMO,
  FREQUENCIAS,
  frequenciasAlteradas,
  lerLimiares,
  linhasDeDb,
  mediaQuadritonal,
  pontosDoGrafico,
  resumirOrelha,
  rotuloFrequencia,
  temMedicao,
  xDaFrequencia,
  yDoLimiar,
  type CaixaDoGrafico,
} from '@/modules/documents/audiograma';

const CAIXA: CaixaDoGrafico = { x: 100, y: 200, largura: 140, altura: 130 };

describe('lerLimiares', () => {
  it('le os campos da ficha de cada orelha', () => {
    const valores = { od_500: '15', od_4000: 30, oe_500: '10' };
    expect(lerLimiares(valores, 'od')).toEqual({ 500: 15, 4000: 30 });
    expect(lerLimiares(valores, 'oe')).toEqual({ 500: 10 });
  });

  it('aceita virgula decimal', () => {
    expect(lerLimiares({ od_1000: '12,5' }, 'od')).toEqual({ 1000: 12.5 });
  });

  it('descarta vazio, texto e valor fora da escala', () => {
    const valores = {
      od_250: '',
      od_500: null,
      od_1000: 'nao medido',
      od_2000: 999,
      od_3000: -50,
      od_4000: 20,
    };
    expect(lerLimiares(valores, 'od')).toEqual({ 4000: 20 });
  });

  it('aceita os extremos da escala', () => {
    expect(lerLimiares({ od_500: DB_MINIMO, od_8000: DB_MAXIMO }, 'od')).toEqual({
      500: -10,
      8000: 120,
    });
  });

  it('nao quebra com ficha vazia', () => {
    expect(lerLimiares({}, 'od')).toEqual({});
    expect(temMedicao({})).toBe(false);
  });
});

describe('mediaQuadritonal', () => {
  it('usa 500, 1000, 2000 e 3000 Hz', () => {
    expect(mediaQuadritonal({ 500: 10, 1000: 20, 2000: 20, 3000: 30 })).toBe(20);
  });

  it('arredonda com uma casa', () => {
    expect(mediaQuadritonal({ 500: 10, 1000: 15, 2000: 20, 3000: 20 })).toBe(16.3);
  });

  it('devolve null quando falta alguma: media com buraco engana', () => {
    expect(mediaQuadritonal({ 500: 10, 1000: 20, 2000: 20 })).toBeNull();
    expect(mediaQuadritonal({})).toBeNull();
  });
});

describe('frequenciasAlteradas', () => {
  it('lista o que passa de 25 dB', () => {
    expect(frequenciasAlteradas({ 500: 10, 4000: 35, 6000: 40 })).toEqual([4000, 6000]);
  });

  it('25 dB ainda esta dentro do limite', () => {
    expect(frequenciasAlteradas({ 4000: 25 })).toEqual([]);
  });

  it('devolve em ordem crescente de frequencia', () => {
    expect(frequenciasAlteradas({ 8000: 30, 500: 30, 3000: 30 })).toEqual([500, 3000, 8000]);
  });
});

describe('resumirOrelha', () => {
  it('reconhece audicao dentro do limite', () => {
    const r = resumirOrelha({ 500: 10, 1000: 10, 2000: 15, 3000: 15, 4000: 20 });
    expect(r.dentroDoLimite).toBe(true);
    expect(r.alteradas).toEqual([]);
    expect(r.media).toBe(12.5);
  });

  it('marca alteracao em frequencia alta, que e a que a NR-7 acompanha', () => {
    const r = resumirOrelha({ 500: 10, 1000: 10, 2000: 10, 3000: 10, 4000: 45 });
    expect(r.alteracaoEmFrequenciaAlta).toBe(true);
    expect(r.dentroDoLimite).toBe(false);
  });

  it('alteracao so em frequencia baixa nao marca a faixa da NR-7', () => {
    const r = resumirOrelha({ 250: 40, 500: 10, 1000: 10, 2000: 10, 3000: 10 });
    expect(r.alteradas).toEqual([250]);
    expect(r.alteracaoEmFrequenciaAlta).toBe(false);
  });

  it('orelha sem medicao nao e "dentro do limite"', () => {
    expect(resumirOrelha({}).dentroDoLimite).toBe(false);
  });
});

describe('geometria do grafico', () => {
  it('a primeira frequencia fica na borda esquerda e a ultima na direita', () => {
    expect(xDaFrequencia(250, CAIXA)).toBe(CAIXA.x);
    expect(xDaFrequencia(8000, CAIXA)).toBe(CAIXA.x + CAIXA.largura);
  });

  it('frequencia desconhecida nao sai da caixa', () => {
    expect(xDaFrequencia(12000, CAIXA)).toBe(CAIXA.x);
  });

  it('o audiograma e invertido: -10 dB no topo, 120 dB embaixo', () => {
    const topo = yDoLimiar(DB_MINIMO, CAIXA);
    const base = yDoLimiar(DB_MAXIMO, CAIXA);
    expect(topo).toBeGreaterThan(base);
    expect(topo).toBe(CAIXA.y + CAIXA.altura);
    expect(base).toBe(CAIXA.y);
  });

  it('audicao pior fica mais embaixo no papel', () => {
    expect(yDoLimiar(60, CAIXA)).toBeLessThan(yDoLimiar(20, CAIXA));
  });

  it('desenha so as frequencias medidas, em ordem', () => {
    const pontos = pontosDoGrafico({ 4000: 30, 500: 10 }, CAIXA);
    expect(pontos.map((p) => p.hz)).toEqual([500, 4000]);
    expect(pontos[0]?.x).toBeLessThan(pontos[1]?.x ?? 0);
  });

  it('todos os pontos caem dentro da caixa', () => {
    const limiares = Object.fromEntries(FREQUENCIAS.map((hz) => [hz, 40]));
    for (const p of pontosDoGrafico(limiares, CAIXA)) {
      expect(p.x).toBeGreaterThanOrEqual(CAIXA.x);
      expect(p.x).toBeLessThanOrEqual(CAIXA.x + CAIXA.largura);
      expect(p.y).toBeGreaterThanOrEqual(CAIXA.y);
      expect(p.y).toBeLessThanOrEqual(CAIXA.y + CAIXA.altura);
    }
  });

  it('o quadriculado vai de 10 em 10 dB', () => {
    const linhas = linhasDeDb();
    expect(linhas[0]).toBe(DB_MINIMO);
    expect(linhas.at(-1)).toBe(DB_MAXIMO);
    expect(linhas).toHaveLength(14);
  });
});

describe('rotuloFrequencia', () => {
  it('usa kHz a partir de mil', () => {
    expect(rotuloFrequencia(250)).toBe('250');
    expect(rotuloFrequencia(1000)).toBe('1k');
    expect(rotuloFrequencia(8000)).toBe('8k');
  });
});
