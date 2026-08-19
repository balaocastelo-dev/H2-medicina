import { describe, expect, it } from 'vitest';
import {
  apareceNaLista,
  podeExcluirDaLista,
  podeMarcarAusente,
} from '@/modules/scheduling/regras-lista';

describe('podeExcluirDaLista', () => {
  it('deixa remover quem ainda nao chegou', () => {
    expect(podeExcluirDaLista('agendado')).toBe(true);
    expect(podeExcluirDaLista('confirmado')).toBe(true);
    expect(podeExcluirDaLista('ausente')).toBe(true);
  });

  it('protege quem ja iniciou o atendimento', () => {
    expect(podeExcluirDaLista('checkin')).toBe(false);
    expect(podeExcluirDaLista('em_atendimento')).toBe(false);
    expect(podeExcluirDaLista('realizado')).toBe(false);
  });
});

describe('apareceNaLista', () => {
  it('mostra agendado e ausente', () => {
    expect(apareceNaLista('agendado', null)).toBe(true);
    expect(apareceNaLista('ausente', null)).toBe(true);
  });

  it('esconde cancelado, remarcado e removido', () => {
    expect(apareceNaLista('cancelado', null)).toBe(false);
    expect(apareceNaLista('remarcado', null)).toBe(false);
    expect(apareceNaLista('agendado', '2026-08-19T10:00:00Z')).toBe(false);
  });
});

describe('podeMarcarAusente', () => {
  it('vale antes do atendimento', () => {
    expect(podeMarcarAusente('agendado')).toBe(true);
    expect(podeMarcarAusente('confirmado')).toBe(true);
    expect(podeMarcarAusente('checkin')).toBe(true);
  });

  it('nao vale depois, nem duas vezes', () => {
    expect(podeMarcarAusente('realizado')).toBe(false);
    expect(podeMarcarAusente('em_atendimento')).toBe(false);
    expect(podeMarcarAusente('ausente')).toBe(false);
  });
});
