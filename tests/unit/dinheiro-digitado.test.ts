import { describe, expect, it } from 'vitest';
import { dinheiroDigitado, dinheiroOuZero } from '@/lib/dinheiro-digitado';

/**
 * O que a clinica digita num campo de dinheiro.
 *
 * Este teste existe por causa de dois defeitos reais:
 *
 *   1. `<input type="number">` em navegador configurado em ingles recusa a
 *      virgula e devolve STRING VAZIA. Em `painel-valores.tsx` vazio significa
 *      "apagar o valor negociado": a empresa perdia o preco combinado com a
 *      mensagem "Valores salvos.".
 *
 *   2. O `.replace(',', '.')` antigo lia "1.234" como 1,234 e gravava
 *      R$ 1,23 no lugar de R$ 1.234,00 — silenciosamente.
 */
describe('dinheiro digitado por gente', () => {
  it('le o que a clinica digita, nas duas notacoes', () => {
    expect(dinheiroDigitado('1234')).toBe(1234);
    expect(dinheiroDigitado('1234,56')).toBe(1234.56);
    expect(dinheiroDigitado('1234.56')).toBe(1234.56);
    expect(dinheiroDigitado('1.234,56')).toBe(1234.56);
    expect(dinheiroDigitado('1,234.56')).toBe(1234.56);
    expect(dinheiroDigitado('0,01')).toBe(0.01);
    expect(dinheiroDigitado('0')).toBe(0);
  });

  it('"1.234" e mil duzentos e trinta e quatro, nao 1,23', () => {
    // O erro que gravava R$ 1,23 no lugar de R$ 1.234,00.
    expect(dinheiroDigitado('1.234')).toBe(1234);
    expect(dinheiroDigitado('12.345')).toBe(12345);
  });

  it('aceita o que vem colado do teclado do balcao', () => {
    expect(dinheiroDigitado('R$ 1.234,56')).toBe(1234.56);
    expect(dinheiroDigitado('  44,00  ')).toBe(44);
    // Espaco estreito sem quebra, que o Intl do Node produz.
    expect(dinheiroDigitado('R$ 100,00')).toBe(100);
  });

  it('distingue vazio de invalido', () => {
    // Vazio e uma decisao ("usar o valor de tabela"); invalido e um erro.
    expect(dinheiroDigitado('')).toBeNull();
    expect(dinheiroDigitado('   ')).toBeNull();
    expect(dinheiroDigitado(null)).toBeNull();
    expect(dinheiroDigitado(undefined)).toBeNull();

    expect(dinheiroDigitado('abc')).toBeNaN();
    expect(dinheiroDigitado('-')).toBeNaN();
  });

  it('numero negativo passa e quem chama recusa', () => {
    // A funcao le; a regra de negocio e de quem chama.
    expect(dinheiroDigitado('-50')).toBe(-50);
  });

  it('dinheiroOuZero nunca devolve nulo nem NaN', () => {
    expect(dinheiroOuZero('')).toBe(0);
    expect(dinheiroOuZero('abc')).toBe(0);
    expect(dinheiroOuZero('19,90')).toBe(19.9);
  });
});
