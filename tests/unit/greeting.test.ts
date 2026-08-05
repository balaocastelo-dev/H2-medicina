import { describe, expect, it } from 'vitest';
import {
  montarSaudacao,
  periodoDoDia,
  primeiroNome,
  saudacaoAtiva,
  SAUDACAO,
} from '@/modules/greeting/phrases';

describe('periodo do dia', () => {
  it('classifica manha, tarde e noite', () => {
    expect(periodoDoDia(5)).toBe('manha');
    expect(periodoDoDia(11)).toBe('manha');
    expect(periodoDoDia(12)).toBe('tarde');
    expect(periodoDoDia(17)).toBe('tarde');
    expect(periodoDoDia(18)).toBe('noite');
    expect(periodoDoDia(3)).toBe('noite');
  });

  it('usa a saudacao correspondente', () => {
    expect(SAUDACAO.manha).toBe('bom dia');
    expect(SAUDACAO.tarde).toBe('boa tarde');
    expect(SAUDACAO.noite).toBe('boa noite');
  });
});

describe('primeiro nome', () => {
  it('extrai e capitaliza', () => {
    expect(primeiroNome('wania sanches picasso')).toBe('Wania');
    expect(primeiroNome('  MARIA  DE SOUZA ')).toBe('Maria');
    expect(primeiroNome('')).toBe('');
  });
});

describe('frase de boas-vindas', () => {
  it('usa tratamento e primeiro nome pela manha', () => {
    const f = montarSaudacao({ nome: 'Wania Sanches', tratamento: 'Dra.', hora: 8, semente: 0 });
    expect(f.startsWith('Olá, bom dia, Dra. Wania!')).toBe(true);
    expect(f).toContain('conte comigo');
  });

  it('funciona sem tratamento', () => {
    const f = montarSaudacao({ nome: 'Paulo Cesar', hora: 14, semente: 0 });
    expect(f.startsWith('Olá, boa tarde, Paulo!')).toBe(true);
  });

  it('funciona sem nome', () => {
    const f = montarSaudacao({ nome: '', hora: 20, semente: 0 });
    expect(f.startsWith('Olá, boa noite!')).toBe(true);
  });

  it('e estavel para a mesma semente e varia entre sementes', () => {
    const a = montarSaudacao({ nome: 'Ana', hora: 9, semente: 1 });
    const b = montarSaudacao({ nome: 'Ana', hora: 9, semente: 1 });
    const c = montarSaudacao({ nome: 'Ana', hora: 9, semente: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('ativacao da saudacao', () => {
  it('vem ligada por padrao', () => {
    expect(saudacaoAtiva(undefined)).toBe(true);
    expect(saudacaoAtiva('')).toBe(true);
    expect(saudacaoAtiva('sim')).toBe(true);
    expect(saudacaoAtiva(true)).toBe(true);
  });

  it('aceita desligar por texto do painel', () => {
    expect(saudacaoAtiva('nao')).toBe(false);
    expect(saudacaoAtiva('não')).toBe(false);
    expect(saudacaoAtiva('false')).toBe(false);
    expect(saudacaoAtiva(false)).toBe(false);
  });
});
