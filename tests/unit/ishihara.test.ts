import { describe, expect, it } from 'vitest';
import { conferirIshihara, descreverIshihara, LAMINAS } from '@/modules/clinical/ishihara';

/** Gabarito do material da clinica: 12, 74, 2, 26, 45, 3. */
const TODAS_CERTAS = {
  figura_1: '12',
  figura_2: '74',
  figura_3: '2',
  figura_4: '26',
  figura_5: '45',
  figura_6: '3',
};

describe('LAMINAS', () => {
  it('tem as seis laminas do material da clinica', () => {
    expect(LAMINAS.map((l) => l.esperado)).toEqual(['12', '74', '2', '26', '45', '3']);
  });

  it('a figura 1 e a unica de controle', () => {
    expect(LAMINAS.filter((l) => l.controle).map((l) => l.figura)).toEqual([1]);
  });
});

describe('conferirIshihara', () => {
  it('conta cinco acertos quando o paciente acerta tudo', () => {
    const c = conferirIshihara(TODAS_CERTAS);
    // A de controle nao entra na nota: sao 5 que valem, nao 6.
    expect(c.acertos).toBe(5);
    expect(c.total).toBe(5);
    expect(c.controleOk).toBe(true);
  });

  it('ignora espaco, ponto final e caixa', () => {
    const c = conferirIshihara({ ...TODAS_CERTAS, figura_2: ' 74. ', figura_6: '3,' });
    expect(c.acertos).toBe(5);
  });

  it('aponta quais figuras o paciente errou', () => {
    const c = conferirIshihara({ ...TODAS_CERTAS, figura_3: 'não identifica', figura_5: '5' });
    expect(c.acertos).toBe(3);
    expect(c.detalhe.filter((d) => !d.certo).map((d) => d.figura)).toEqual([3, 5]);
  });

  it('erro na lamina de controle nao conta como daltonismo', () => {
    const c = conferirIshihara({ ...TODAS_CERTAS, figura_1: '21' });
    expect(c.acertos).toBe(5); // as que valem continuam certas
    expect(c.controleOk).toBe(false);
  });

  it('campo em branco nao vira acerto', () => {
    const c = conferirIshihara({ figura_1: '12' });
    expect(c.acertos).toBe(0);
    expect(c.aplicadas).toBe(0);
  });

  it('nao quebra com ficha vazia', () => {
    const c = conferirIshihara({});
    expect(c.acertos).toBe(0);
    expect(c.controleRespondido).toBe(false);
  });
});

describe('descreverIshihara', () => {
  it('teste nao aplicado', () => {
    expect(descreverIshihara(conferirIshihara({}))).toBe('Teste não aplicado.');
  });

  it('tudo certo, sem alteracao', () => {
    const texto = descreverIshihara(conferirIshihara(TODAS_CERTAS));
    expect(texto).toContain('as 5 lâminas corretamente');
    expect(texto).toContain('sem alterações');
  });

  it('controle errado manda repetir, e nao conclui daltonismo', () => {
    const texto = descreverIshihara(conferirIshihara({ ...TODAS_CERTAS, figura_1: '8' }));
    expect(texto).toContain('invalida a leitura');
    expect(texto).toContain('repetir o teste');
    expect(texto).not.toContain('oftalmológica');
  });

  it('erro nas laminas que valem sugere avaliacao, sem dar diagnostico', () => {
    const texto = descreverIshihara(
      conferirIshihara({ ...TODAS_CERTAS, figura_2: '21', figura_4: '6' }),
    );
    expect(texto).toContain('3 de 5');
    expect(texto).toContain('figura 2, 4');
    expect(texto).toContain('oftalmológica');
    // O sistema descreve o achado; quem fecha diagnostico e o medico.
    expect(texto.toLowerCase()).not.toContain('daltonismo');
  });
});
