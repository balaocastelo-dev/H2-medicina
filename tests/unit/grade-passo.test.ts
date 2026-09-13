import { describe, expect, it } from 'vitest';
import {
  FAIXAS_PADRAO,
  GRADE_PADRAO,
  PASSO_PADRAO,
  gerarGrade,
  lerConfiguracao,
} from '@/modules/scheduling/grade-publica';

describe('gerarGrade', () => {
  it('expande a faixa de 5 em 5 minutos', () => {
    expect(gerarGrade([{ inicio: '08:00', fim: '08:20' }], 5)).toEqual([
      '08:00',
      '08:05',
      '08:10',
      '08:15',
      '08:20',
    ]);
  });

  it('inclui o fim da faixa', () => {
    const g = gerarGrade([{ inicio: '07:00', fim: '11:30' }], 5);
    expect(g[0]).toBe('07:00');
    expect(g[g.length - 1]).toBe('11:30');
  });

  it('junta faixas e devolve em ordem', () => {
    const g = gerarGrade(
      [
        { inicio: '13:30', fim: '13:40' },
        { inicio: '07:00', fim: '07:10' },
      ],
      5,
    );
    expect(g).toEqual(['07:00', '07:05', '07:10', '13:30', '13:35', '13:40']);
  });

  it('nao repete horario quando as faixas se sobrepoem', () => {
    const g = gerarGrade(
      [
        { inicio: '08:00', fim: '08:10' },
        { inicio: '08:05', fim: '08:15' },
      ],
      5,
    );
    expect(g).toEqual(['08:00', '08:05', '08:10', '08:15']);
  });

  it('aceita outros passos', () => {
    expect(gerarGrade([{ inicio: '08:00', fim: '09:00' }], 30)).toEqual(['08:00', '08:30', '09:00']);
  });

  it('ignora faixa invertida ou invalida', () => {
    expect(gerarGrade([{ inicio: '10:00', fim: '09:00' }], 5)).toEqual([]);
    expect(gerarGrade([{ inicio: '25:99', fim: '26:00' }], 5)).toEqual([]);
  });

  it('cai no passo de 5 quando o valor nao faz sentido', () => {
    expect(gerarGrade([{ inicio: '08:00', fim: '08:10' }], 0)).toHaveLength(3);
    expect(gerarGrade([{ inicio: '08:00', fim: '08:10' }], Number.NaN)).toHaveLength(3);
  });
});

describe('grade padrao', () => {
  it('usa passo de 5 minutos', () => {
    expect(PASSO_PADRAO).toBe(5);
    expect(GRADE_PADRAO.grade).toContain('08:05');
    expect(GRADE_PADRAO.grade).toContain('08:20');
  });

  it('cobre manha e tarde', () => {
    expect(GRADE_PADRAO.grade[0]).toBe('07:00');
    expect(GRADE_PADRAO.grade.at(-1)).toBe('17:00');
  });

  it('tem o tamanho das faixas informadas', () => {
    expect(GRADE_PADRAO.grade).toEqual(gerarGrade(FAIXAS_PADRAO, PASSO_PADRAO));
  });
});

describe('lerConfiguracao', () => {
  it('monta a grade a partir de faixas e passo', () => {
    const c = lerConfiguracao({
      faixas: [{ inicio: '08:00', fim: '08:15' }],
      passo_minutos: 5,
    });
    expect(c.grade).toEqual(['08:00', '08:05', '08:10', '08:15']);
  });

  it('respeita a lista explicita quando existe', () => {
    const c = lerConfiguracao({ grade: ['09:00', '10:00'] });
    expect(c.grade).toEqual(['09:00', '10:00']);
  });

  it('sem nada configurado, entrega o padrao de 5 minutos', () => {
    expect(lerConfiguracao({}).grade).toEqual(GRADE_PADRAO.grade);
    expect(lerConfiguracao(null).grade).toEqual(GRADE_PADRAO.grade);
  });

  it('passo invalido nao quebra a grade', () => {
    const c = lerConfiguracao({ faixas: [{ inicio: '08:00', fim: '08:10' }], passo_minutos: 'oi' });
    expect(c.grade).toEqual(['08:00', '08:05', '08:10']);
  });
});
