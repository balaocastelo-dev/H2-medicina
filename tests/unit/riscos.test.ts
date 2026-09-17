import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS,
  SEM_RISCO_RELEVANTE,
  idadeNaData,
  montarRiscos,
  perfilParaCargo,
  temRiscoRelevante,
  type PerfilDeRisco,
} from '@/modules/documents/riscos';

const GERAL: PerfilDeRisco = {
  cargo: null,
  fisicos: 'Ruído contínuo acima de 85 dB',
  quimicos: null,
  biologicos: null,
  ergonomicos: null,
  acidentes: null,
};

const MOTORISTA: PerfilDeRisco = {
  cargo: 'Motorista/Entregador',
  fisicos: 'Vibração de corpo inteiro',
  quimicos: null,
  biologicos: null,
  ergonomicos: 'Permanência sentado por longos períodos',
  acidentes: 'Trânsito',
};

describe('perfilParaCargo', () => {
  it('o cargo exato ganha do perfil geral', () => {
    expect(perfilParaCargo([GERAL, MOTORISTA], 'Motorista/Entregador')?.cargo).toBe(
      'Motorista/Entregador',
    );
  });

  it('ignora acento e caixa ao comparar o cargo', () => {
    expect(perfilParaCargo([MOTORISTA], 'MOTORISTA/ENTREGADOR')?.cargo).toBe('Motorista/Entregador');
    expect(perfilParaCargo([{ ...MOTORISTA, cargo: 'Mecânico' }], 'mecanico')?.cargo).toBe(
      'Mecânico',
    );
  });

  it('cai no perfil geral quando o cargo nao tem o seu', () => {
    expect(perfilParaCargo([GERAL, MOTORISTA], 'Auxiliar de limpeza')?.cargo).toBeNull();
  });

  it('devolve null quando a empresa nao tem perfil nenhum', () => {
    expect(perfilParaCargo([], 'Motorista')).toBeNull();
    expect(perfilParaCargo([MOTORISTA], 'Auxiliar')).toBeNull();
  });

  it('sem cargo informado, usa o perfil geral', () => {
    expect(perfilParaCargo([GERAL, MOTORISTA], null)?.cargo).toBeNull();
    expect(perfilParaCargo([GERAL, MOTORISTA], '')?.cargo).toBeNull();
  });
});

describe('montarRiscos', () => {
  it('completa o que nao foi preenchido com a frase padrao', () => {
    const r = montarRiscos(MOTORISTA);
    expect(r.fisicos).toBe('Vibração de corpo inteiro');
    expect(r.quimicos).toBe(SEM_RISCO_RELEVANTE);
    expect(r.biologicos).toBe(SEM_RISCO_RELEVANTE);
  });

  it('sem perfil nenhum, todas as categorias saem com a frase padrao', () => {
    const r = montarRiscos(null);
    for (const { chave } of CATEGORIAS) expect(r[chave]).toBe(SEM_RISCO_RELEVANTE);
  });

  it('texto so com espaco conta como vazio', () => {
    expect(montarRiscos({ ...GERAL, fisicos: '   ' }).fisicos).toBe(SEM_RISCO_RELEVANTE);
  });

  it('nunca deixa categoria em branco: campo vazio no A.S.O. sugere avaliacao nao feita', () => {
    const r = montarRiscos(null);
    for (const { chave } of CATEGORIAS) expect(r[chave].length).toBeGreaterThan(10);
  });

  // "deve existir um campo onde podemos colocar o risco ocupacional do
  //  empregado da empresa" -- Isabella, 15/09.
  describe('risco anotado no cadastro do empregado', () => {
    it('vence o perfil do cargo', () => {
      const r = montarRiscos(MOTORISTA, 'Ruído contínuo acima de 85 dB(A)');
      expect(r.fisicos).toBe('Ruído contínuo acima de 85 dB(A)');
    });

    it('nao mistura com o perfil: o resto sai com a frase padrao', () => {
      // Misturar produziria um A.S.O. que ninguem escreveu.
      const r = montarRiscos(MOTORISTA, 'Poeira mineral');
      expect(r.fisicos).toBe('Poeira mineral');
      for (const chave of ['quimicos', 'biologicos', 'ergonomicos', 'acidentes'] as const) {
        expect(r[chave]).toBe(SEM_RISCO_RELEVANTE);
      }
    });

    it('campo vazio ou so com espaco cai de volta no perfil do cargo', () => {
      expect(montarRiscos(MOTORISTA, '').fisicos).toBe('Vibração de corpo inteiro');
      expect(montarRiscos(MOTORISTA, '   ').fisicos).toBe('Vibração de corpo inteiro');
      expect(montarRiscos(MOTORISTA, null).fisicos).toBe('Vibração de corpo inteiro');
      expect(montarRiscos(MOTORISTA, undefined).fisicos).toBe('Vibração de corpo inteiro');
    });

    it('funciona mesmo sem perfil de empresa nenhum', () => {
      const r = montarRiscos(null, 'Trabalho em altura');
      expect(r.fisicos).toBe('Trabalho em altura');
    });
  });
});

describe('temRiscoRelevante', () => {
  it('reconhece quando ha risco de verdade', () => {
    expect(temRiscoRelevante(montarRiscos(MOTORISTA))).toBe(true);
  });

  it('e falso quando tudo caiu no padrao', () => {
    expect(temRiscoRelevante(montarRiscos(null))).toBe(false);
  });
});

describe('idadeNaData', () => {
  const exame = new Date('2026-08-20T14:00:00Z');

  it('conta anos completos', () => {
    expect(idadeNaData('1985-11-25', exame)).toBe(40);
  });

  it('nao conta o aniversario que ainda nao chegou', () => {
    expect(idadeNaData('1985-08-21', exame)).toBe(40);
    expect(idadeNaData('1985-08-20', exame)).toBe(41);
  });

  it('a idade e a do dia do exame, nao a de hoje', () => {
    const antes = new Date('2020-01-01T12:00:00Z');
    expect(idadeNaData('1985-11-25', antes)).toBe(34);
  });

  it('devolve null sem nascimento ou com data impossivel', () => {
    expect(idadeNaData(null, exame)).toBeNull();
    expect(idadeNaData('', exame)).toBeNull();
    expect(idadeNaData('1800-01-01', exame)).toBeNull();
  });
});
