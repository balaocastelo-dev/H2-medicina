import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS,
  SEM_RISCO_RELEVANTE,
  dividirPorCategoria,
  idadeNaData,
  montarRiscos,
  perfilParaCargo,
  temRiscoRelevante,
  type PerfilDeRisco,
} from '@/modules/documents/riscos';

/**
 * Risco escrito por categoria no cadastro do paciente.
 *
 * "precisa arrumar uma forma de essa divisão que eu coloquei de riscos
 *  fisicos e quimicos ficarem subdividos certo no ASO final"
 *                                              -- Isabella, 23/09.
 *
 * Ela escreveu duas linhas e as duas saíram juntas na casa de Físicos.
 */
describe('risco escrito por categoria', () => {
  it('o caso exato que a clínica mandou', () => {
    const r = montarRiscos(null, 'Fisicos = Ruido\nQuimicos = Poeira / Amianto');
    expect(r.fisicos).toBe('Ruido');
    expect(r.quimicos).toBe('Poeira / Amianto');
    expect(r.biologicos).toBe(SEM_RISCO_RELEVANTE);
    expect(r.ergonomicos).toBe(SEM_RISCO_RELEVANTE);
    expect(r.acidentes).toBe(SEM_RISCO_RELEVANTE);
  });

  it('aceita acento, dois-pontos, singular e caixa alta', () => {
    const r = montarRiscos(
      null,
      'FÍSICOS: Ruído\nquímico = Solvente\nErgonômicos = Postura em pé\nMecânicos = Queda',
    );
    expect(r.fisicos).toBe('Ruído');
    expect(r.quimicos).toBe('Solvente');
    expect(r.ergonomicos).toBe('Postura em pé');
    // "Mecânicos" é como a NR chama a categoria de acidentes.
    expect(r.acidentes).toBe('Queda');
  });

  it('linha sem categoria continua a anterior', () => {
    const r = montarRiscos(
      null,
      'Químicos = Poeira mineral\ne vapores de solvente na cabine de pintura',
    );
    expect(r.quimicos).toBe('Poeira mineral e vapores de solvente na cabine de pintura');
    expect(r.fisicos).toBe(SEM_RISCO_RELEVANTE);
  });

  it('todas as cinco de uma vez', () => {
    const r = montarRiscos(
      null,
      [
        'Físicos = Ruído',
        'Químicos = Amianto',
        'Biológicos = Material perfurocortante',
        'Ergonômicos = Levantamento de peso',
        'Acidentes = Empilhadeira',
      ].join('\n'),
    );
    for (const { chave } of CATEGORIAS) {
      expect(r[chave]).not.toBe(SEM_RISCO_RELEVANTE);
    }
    expect(r.biologicos).toBe('Material perfurocortante');
  });

  it('texto corrido continua indo inteiro em Físicos — nada mudou para quem já escrevia assim', () => {
    const r = montarRiscos(null, 'Ruído contínuo acima de 85 dB(A); poeira mineral');
    expect(r.fisicos).toBe('Ruído contínuo acima de 85 dB(A); poeira mineral');
    expect(r.quimicos).toBe(SEM_RISCO_RELEVANTE);
  });

  it('frase com igual no meio não vira categoria', () => {
    // "pressão = 4 bar" não é uma categoria: sem isso, um texto comum
    // viraria um quadro em branco.
    const r = montarRiscos(null, 'Trabalha com ar comprimido a pressão = 4 bar');
    expect(r.fisicos).toBe('Trabalha com ar comprimido a pressão = 4 bar');
  });

  it('dividirPorCategoria devolve nulo quando não há categoria escrita', () => {
    expect(dividirPorCategoria('Ruído e poeira')).toBeNull();
    expect(dividirPorCategoria('')).toBeNull();
  });

  it('categoria escrita e deixada vazia sai com a frase padrão', () => {
    const r = montarRiscos(null, 'Físicos = Ruído\nQuímicos =');
    expect(r.fisicos).toBe('Ruído');
    expect(r.quimicos).toBe(SEM_RISCO_RELEVANTE);
  });

  it('o risco do paciente continua vencendo o perfil do cargo', () => {
    const r = montarRiscos(MOTORISTA, 'Físicos = Ruído de turbina');
    expect(r.fisicos).toBe('Ruído de turbina');
    // O perfil do cargo não se mistura: seria um A.S.O. que ninguém escreveu.
    expect(r.ergonomicos).toBe(SEM_RISCO_RELEVANTE);
    expect(r.acidentes).toBe(SEM_RISCO_RELEVANTE);
  });
});

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
