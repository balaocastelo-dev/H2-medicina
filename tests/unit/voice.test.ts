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

describe('preparacao do texto falado', () => {
  it('escreve abreviacoes por extenso para nao virar pausa', async () => {
    const { prepararParaFala } = await import('@/modules/greeting/voice');
    expect(prepararParaFala('Olá, bom dia, Sr. Herrera!')).toBe('Olá, bom dia, Senhor Herrera!');
    expect(prepararParaFala('Olá, boa tarde, Dra. Wania!')).toBe('Olá, boa tarde, Doutora Wania!');
    expect(prepararParaFala('Sra. Ana e Dr. Miguel')).toBe('Senhora Ana e Doutor Miguel');
  });

  it('nao quebra a fala dentro da abreviacao', () => {
    const trechos = dividirEmTrechos('Olá, bom dia, Sr. Herrera! Hoje é um lindo dia.');
    expect(trechos[0]).toBe('Olá, bom dia, Senhor Herrera!');
    expect(trechos).toHaveLength(2);
  });

  it('mantem a quebra entre frases de verdade', () => {
    const trechos = dividirEmTrechos('Primeira frase. Segunda frase. Terceira!');
    expect(trechos).toHaveLength(3);
  });
});

describe('anúncio da sala no painel', () => {
  // Espelha a regra do painel: a chamada anuncia o número, não o nome inteiro.
  const apenasNumero = (nome: string) => {
    const m = nome.match(/sala\s*0*(\d+)/i);
    return m ? `Sala ${m[1]}` : nome;
  };

  it('reduz o nome da sala ao número', () => {
    expect(apenasNumero('Sala 7 — Eletrocardiograma e Espirometria')).toBe('Sala 7');
    expect(apenasNumero('Sala 1 — Triagem')).toBe('Sala 1');
    expect(apenasNumero('Sala 06 — Audiometria')).toBe('Sala 6');
  });

  it('mantém o nome quando não há número', () => {
    expect(apenasNumero('Recepção')).toBe('Recepção');
    expect(apenasNumero('Consultório Médico')).toBe('Consultório Médico');
  });
});
