import { describe, expect, it } from 'vitest';
import { calcAge, formatDate } from '@/lib/format';

/**
 * Data pura: dia, sem hora e sem fuso.
 *
 * "as guias de exames geradas estao saindo com a data de nascimento
 *  errado do paciente" -- Isabella, 21/09.
 *
 * Nascimento, admissao e vencimento sao colunas `date` no banco e chegam
 * como "1963-12-02". `new Date("1963-12-02")` le isso como meia-noite em
 * UTC; convertido para Sao Paulo (UTC-3), devolve o DIA ANTERIOR.
 *
 * Isso nao afetava so a guia: afetava toda data de nascimento impressa,
 * inclusive no A.S.O.
 */

describe('formatDate com data pura', () => {
  it('o dia sai exatamente como esta gravado', () => {
    expect(formatDate('1963-12-02')).toBe('02/12/1963');
    expect(formatDate('1985-11-25')).toBe('25/11/1985');
  });

  it('nao volta um dia — era o defeito', () => {
    // Em Sao Paulo (UTC-3), a conversao devolvia 31/12 do ano anterior.
    expect(formatDate('2000-01-01')).toBe('01/01/2000');
    expect(formatDate('1970-01-01')).toBe('01/01/1970');
  });

  it('funciona em qualquer dia do ano, inclusive nas trocas de horario', () => {
    // O Brasil nao tem mais horario de verao, mas datas antigas caem
    // dentro de periodos em que tinha.
    for (const data of ['2017-10-15', '2018-02-17', '2018-11-04', '2019-02-16']) {
      const [ano, mes, dia] = data.split('-');
      expect(formatDate(data)).toBe(`${dia}/${mes}/${ano}`);
    }
  });

  it('aceita data com hora junto e usa a parte do dia', () => {
    expect(formatDate('2026-09-21T14:30:00Z')).not.toBe('—');
  });

  it('recusa dia que nao existe em vez de deslizar para o mes seguinte', () => {
    expect(formatDate('2026-02-31')).toBe('—');
    expect(formatDate('2026-13-01')).toBe('—');
  });

  it('vazio e invalido devolvem travessao', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('nao e data')).toBe('—');
  });

  it('continua funcionando com Date de verdade', () => {
    expect(formatDate(new Date('2026-09-21T15:00:00Z'))).toBe('21/09/2026');
  });
});

describe('calcAge', () => {
  /** Data de hoje no fuso da clinica, para montar casos relativos. */
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(new Date())
    .split('-')
    .map(Number) as [number, number, number];

  const dataDe = (anosAtras: number, mes: number, dia: number) =>
    `${hoje[0] - anosAtras}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

  it('no dia do aniversario a idade ja conta', () => {
    // Era o caso que falhava: quem faz aniversario hoje aparecia com um
    // ano a menos, porque a data voltava um dia.
    expect(calcAge(dataDe(40, hoje[1], hoje[2]))).toBe(40);
  });

  it('um dia antes do aniversario ainda nao conta', () => {
    const ontem = new Date(Date.UTC(hoje[0], hoje[1] - 1, hoje[2]));
    ontem.setUTCDate(ontem.getUTCDate() + 1);
    const amanha = `${hoje[0] - 30}-${String(ontem.getUTCMonth() + 1).padStart(2, '0')}-${String(
      ontem.getUTCDate(),
    ).padStart(2, '0')}`;
    // Nascido "amanha" 30 anos atras: ainda tem 29.
    expect(calcAge(amanha)).toBe(29);
  });

  it('vazio e invalido devolvem null', () => {
    expect(calcAge(null)).toBeNull();
    expect(calcAge('')).toBeNull();
    expect(calcAge('nao e data')).toBeNull();
  });

  it('data absurda nao vira idade', () => {
    expect(calcAge('1500-01-01')).toBeNull();
    expect(calcAge(`${hoje[0] + 5}-01-01`)).toBeNull();
  });
});
