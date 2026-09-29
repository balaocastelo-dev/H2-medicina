import { describe, expect, it } from 'vitest';
import { COM_LAUDO_DESENHADO, qualLaudo } from '@/modules/documents/qual-laudo';
import { fichaDoExame } from '@/modules/clinical/fichas-de-exame';

/**
 * Qual gerador atende cada exame.
 *
 * "nao esta emitindo o laudo da audiometria correto" -- Isabella, 28/09.
 *
 * A audiometria tem laudo desenhado a mao E tem ficha de preenchimento. A
 * escolha dizia "tem ficha? usa o generico", entao o desenhado parou de ser
 * usado no dia em que o generico nasceu -- e o laudo saiu por cinco dias sem
 * os dois audiogramas.
 *
 * O teste que faltava e este: nao basta o desenhado existir, ele precisa ser
 * o escolhido.
 */
describe('qualLaudo', () => {
  it('a audiometria usa o laudo desenhado, mesmo tendo ficha', () => {
    // As duas metades do defeito, uma em cada linha. Se alguem tirar a
    // primeira, a segunda explica por que a escolha nao e obvia.
    expect(qualLaudo('AUDIO')).toBe('desenhado');
    expect(fichaDoExame('AUDIO')).not.toBeNull();
  });

  it.each([...COM_LAUDO_DESENHADO])('%s nunca cai no genérico', (codigo) => {
    expect(qualLaudo(codigo)).toBe('desenhado');
  });

  it.each(['ROMBERG', 'DINAMO_PAL', 'DINAMO_ESC', 'DINAMO_LOM', 'FADIGA', 'PSICO', 'ACUIDADE'])(
    '%s continua saindo pelo genérico',
    (codigo) => {
      // O conserto da audiometria nao pode reverter 23/09: estes exames
      // passaram meses sendo preenchidos sem virar papel nenhum.
      expect(qualLaudo(codigo)).toBe('ficha');
    },
  );

  it.each(['EEG', 'ECG', 'ESPIRO', 'LAB', 'RAIOX'])('%s não tem laudo para emitir', (codigo) => {
    // O resultado vem do aparelho ou do laboratorio; a clinica anexa.
    expect(qualLaudo(codigo)).toBe('nenhum');
  });

  it('código desconhecido não gera papel em branco', () => {
    expect(qualLaudo('')).toBe('nenhum');
    expect(qualLaudo('EXAME_QUE_NAO_EXISTE')).toBe('nenhum');
  });
});
