import { describe, expect, it } from 'vitest';
import {
  cpfParaConferencia,
  podeVincularCpf,
  precisaGravar,
} from '@/modules/queue/vinculo-cpf';

// CPFs validos gerados so para teste.
const CPF_A = '52998224725';
const CPF_B = '11144477735';

describe('podeVincularCpf', () => {
  it('aceita cadastro que veio sem CPF', () => {
    expect(podeVincularCpf({ id: 'p1', cpf: null }, CPF_A)).toEqual({ pode: true });
  });

  it('aceita quando o CPF ja gravado e o mesmo, com ou sem mascara', () => {
    expect(podeVincularCpf({ id: 'p1', cpf: CPF_A }, CPF_A).pode).toBe(true);
    expect(podeVincularCpf({ id: 'p1', cpf: '529.982.247-25' }, CPF_A).pode).toBe(true);
  });

  it('recusa CPF invalido', () => {
    const r = podeVincularCpf({ id: 'p1', cpf: null }, '11111111111');
    expect(r.pode).toBe(false);
    if (!r.pode) expect(r.codigo).toBe('cpf_invalido');
  });

  it('recusa quando o cadastro ja tem outro CPF: sinal de nome errado na lista', () => {
    const r = podeVincularCpf({ id: 'p1', cpf: CPF_B }, CPF_A);
    expect(r.pode).toBe(false);
    if (!r.pode) expect(r.codigo).toBe('ja_tem_outro');
  });

  it('recusa CPF que ja pertence a outra pessoa: juntaria dois prontuarios', () => {
    const r = podeVincularCpf({ id: 'p1', cpf: null }, CPF_A, { id: 'p2' });
    expect(r.pode).toBe(false);
    if (!r.pode) expect(r.codigo).toBe('em_uso');
  });

  it('aceita quando o dono do CPF e o proprio cadastro', () => {
    expect(podeVincularCpf({ id: 'p1', cpf: CPF_A }, CPF_A, { id: 'p1' }).pode).toBe(true);
  });

  it('cada recusa explica o que fazer', () => {
    for (const r of [
      podeVincularCpf({ id: 'p1', cpf: null }, '00000000000'),
      podeVincularCpf({ id: 'p1', cpf: CPF_B }, CPF_A),
      podeVincularCpf({ id: 'p1', cpf: null }, CPF_A, { id: 'p2' }),
    ]) {
      expect(r.pode).toBe(false);
      if (!r.pode) expect(r.motivo.length).toBeGreaterThan(15);
    }
  });
});

describe('precisaGravar', () => {
  it('grava quando o cadastro esta sem CPF', () => {
    expect(precisaGravar({ id: 'p1', cpf: null }, CPF_A)).toBe(true);
  });

  it('nao mexe no cadastro que ja esta certo', () => {
    expect(precisaGravar({ id: 'p1', cpf: CPF_A }, CPF_A)).toBe(false);
    expect(precisaGravar({ id: 'p1', cpf: '529.982.247-25' }, CPF_A)).toBe(false);
  });

  it('nao grava CPF incompleto', () => {
    expect(precisaGravar({ id: 'p1', cpf: null }, '5299822')).toBe(false);
  });
});

describe('cpfParaConferencia', () => {
  it('mostra com mascara para o paciente conferir', () => {
    expect(cpfParaConferencia(CPF_A)).toBe('529.982.247-25');
  });

  it('devolve o que recebeu quando nao da para formatar', () => {
    expect(cpfParaConferencia('123')).toBe('123');
    expect(cpfParaConferencia('')).toBe('');
  });
});
