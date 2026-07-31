import { describe, expect, it } from 'vitest';
import { calcAge, formatCNPJ, formatCPF, formatDuration, formatMoney, partialName, slugify } from '@/lib/format';

describe('formatadores', () => {
  it('formata CPF e CNPJ', () => {
    expect(formatCPF('52998224725')).toBe('529.982.247-25');
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('formata moeda em BRL', () => {
    expect(formatMoney(1234.5)).toContain('1.234,50');
  });

  it('formata duracao', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(300)).toBe('5min');
    expect(formatDuration(3720)).toBe('1h 02min');
    expect(formatDuration(null)).toBe('—');
  });

  it('calcula idade', () => {
    const year = new Date().getFullYear();
    expect(calcAge(`${year - 30}-01-01`)).toBeGreaterThanOrEqual(29);
    expect(calcAge(null)).toBeNull();
  });

  it('gera nome parcial para o painel de TV', () => {
    expect(partialName('Maria Aparecida Souza')).toBe('Maria S.');
    expect(partialName('Joao')).toBe('Joao');
  });

  it('gera slug', () => {
    expect(slugify('Pacote Admissional Completo')).toBe('pacote-admissional-completo');
  });
});
