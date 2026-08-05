import { describe, expect, it } from 'vitest';
import { dividirEmTrechos, escolherVoz, pontuarVoz } from '@/modules/greeting/voice';

const v = (name: string, lang = 'pt-BR', localService = true) => ({ name, lang, localService });

describe('escolha da voz', () => {
  it('descarta vozes que nao sao em portugues', () => {
    expect(pontuarVoz(v('Microsoft Zira', 'en-US'))).toBe(-1);
    expect(escolherVoz([v('Microsoft Zira', 'en-US')])).toBeNull();
  });

  it('prefere neural a voz antiga do Windows', () => {
    const escolhida = escolherVoz([
      v('Microsoft Maria Desktop - Portuguese(Brazil)'),
      v('Microsoft Francisca Online (Natural) - Portuguese (Brazil)', 'pt-BR', false),
    ]);
    expect(escolhida?.name).toContain('Francisca');
  });

  it('prefere Google a voz local generica', () => {
    const escolhida = escolherVoz([
      v('Portuguese Brazil'),
      v('Google português do Brasil', 'pt-BR', false),
    ]);
    expect(escolhida?.name).toContain('Google');
  });

  it('prefere pt-BR a pt-PT', () => {
    const escolhida = escolherVoz([v('Joana', 'pt-PT'), v('Luciana', 'pt-BR')]);
    expect(escolhida?.name).toBe('Luciana');
  });

  it('respeita a voz escolhida no painel', () => {
    const escolhida = escolherVoz(
      [v('Google português do Brasil', 'pt-BR', false), v('Microsoft Thalita')],
      'thalita',
    );
    expect(escolhida?.name).toContain('Thalita');
  });

  it('usa a unica disponivel mesmo sendo ruim', () => {
    const escolhida = escolherVoz([v('Microsoft Maria Desktop')]);
    expect(escolhida?.name).toContain('Maria');
  });
});

describe('divisao em trechos', () => {
  it('quebra por frase para dar respiro na entonacao', () => {
    const t = dividirEmTrechos(
      'Olá, bom dia, Dra. Wania! Hoje é um lindo dia. Conte comigo!',
    );
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0]).toContain('bom dia');
    expect(t.join(' ')).toContain('Conte comigo');
  });

  it('ignora espacos vazios', () => {
    expect(dividirEmTrechos('   ')).toHaveLength(0);
  });
});
