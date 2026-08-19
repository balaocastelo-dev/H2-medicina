import { describe, expect, it } from 'vitest';
import {
  apareceNoPainel,
  destinoDaSala,
  ehPainelValido,
} from '@/modules/queue/tv-destino';

describe('destinoDaSala', () => {
  it('recepcao e guiche vao para o painel da entrada', () => {
    expect(destinoDaSala('recepcao')).toBe('recepcao');
    expect(destinoDaSala('guiche')).toBe('recepcao');
  });

  it('triagem tem destino proprio', () => {
    expect(destinoDaSala('triagem')).toBe('triagem');
  });

  it('exame e consultorio caem em sala', () => {
    expect(destinoDaSala('exame')).toBe('sala');
    expect(destinoDaSala('consultorio')).toBe('sala');
    expect(destinoDaSala(null)).toBe('sala');
    expect(destinoDaSala('qualquer_coisa')).toBe('sala');
  });
});

describe('apareceNoPainel', () => {
  it('a TV da recepcao mostra recepcao e triagem', () => {
    expect(apareceNoPainel('recepcao', 'recepcao')).toBe(true);
    expect(apareceNoPainel('triagem', 'recepcao')).toBe(true);
    expect(apareceNoPainel('sala', 'recepcao')).toBe(false);
  });

  it('a TV das salas mostra so as salas', () => {
    expect(apareceNoPainel('sala', 'salas')).toBe(true);
    expect(apareceNoPainel('recepcao', 'salas')).toBe(false);
    expect(apareceNoPainel('triagem', 'salas')).toBe(false);
  });

  it('chamada antiga sem destino conta como sala', () => {
    expect(apareceNoPainel(null, 'salas')).toBe(true);
    expect(apareceNoPainel(undefined, 'salas')).toBe(true);
    expect(apareceNoPainel(null, 'recepcao')).toBe(false);
  });
});

describe('ehPainelValido', () => {
  it('aceita so os dois paineis', () => {
    expect(ehPainelValido('recepcao')).toBe(true);
    expect(ehPainelValido('salas')).toBe(true);
    expect(ehPainelValido('tudo')).toBe(false);
    expect(ehPainelValido(undefined)).toBe(false);
  });
});
