import { describe, expect, it } from 'vitest';
import { chaveDoNome, mesmoNome, pacienteJaNaAgenda } from '@/modules/import/mesma-pessoa';

/**
 * Reconhecer a mesma pessoa na lista colada de novo.
 *
 * "na hr de incluir a agenda pelo robozinho ele esta duplicando os
 *  atendimentos que ja foram inclusos" -- Isabella, 28/09.
 *
 * Os dois lados importam igualmente: nao duplicar quem ja esta, e NAO
 * juntar duas pessoas diferentes. O segundo erro e pior, porque nao se
 * desfaz -- o exame de um sai no papel do outro.
 */

describe('chaveDoNome', () => {
  it('ignora acento, caixa e espaço sobrando', () => {
    expect(chaveDoNome('  JOSÉ  DA   SILVA ')).toBe(chaveDoNome('José da Silva'));
  });

  it('nome vazio não vira chave', () => {
    expect(chaveDoNome('   ')).toBe('');
  });
});

describe('mesmoNome', () => {
  it.each([
    ['JOSE DA SILVA', 'José da Silva'],
    ['Maria  Aparecida', 'maria aparecida'],
    ['ANTÔNIO CARLOS', 'Antonio Carlos'],
  ])('%s e %s são a mesma pessoa', (a, b) => {
    expect(mesmoNome(a, b)).toBe(true);
  });

  it.each([
    ['José da Silva', 'José da Silva Júnior'],
    ['Maria Aparecida', 'Maria Aparecido'],
    ['Ana Souza', 'Ana Sousa'],
  ])('%s e %s NÃO são a mesma pessoa', (a, b) => {
    // Um sobrenome a mais e outra pessoa. Errar para o lado de duplicar e
    // recuperavel; errar para o lado de juntar, nao.
    expect(mesmoNome(a, b)).toBe(false);
  });

  it('dois nomes vazios não se tornam a mesma pessoa', () => {
    expect(mesmoNome('', '')).toBe(false);
    expect(mesmoNome('  ', '---')).toBe(false);
  });
});

describe('pacienteJaNaAgenda', () => {
  const agenda = [
    { patientId: 'p1', nome: 'JOSÉ DA SILVA' },
    { patientId: 'p2', nome: 'Maria Aparecida Gomes' },
  ];

  it('acha a mesma pessoa escrita de outro jeito', () => {
    expect(pacienteJaNaAgenda('jose da silva', agenda)).toBe('p1');
  });

  it('não acha quem não está na agenda', () => {
    expect(pacienteJaNaAgenda('Carlos Pereira', agenda)).toBeNull();
  });

  it('dois homônimos no mesmo dia: não escolhe nenhum', () => {
    // Sem como decidir, e melhor o registro cair em "ignorados", onde
    // alguem olha, do que o exame ir para o prontuario errado.
    const comHomonimo = [...agenda, { patientId: 'p3', nome: 'Jose da Silva' }];
    expect(pacienteJaNaAgenda('JOSÉ DA SILVA', comHomonimo)).toBeNull();
  });

  it('nome em branco não casa com ninguém', () => {
    expect(pacienteJaNaAgenda('  ', agenda)).toBeNull();
  });

  it('agenda vazia não casa com ninguém', () => {
    expect(pacienteJaNaAgenda('José da Silva', [])).toBeNull();
  });
});
