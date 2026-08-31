import { describe, expect, it } from 'vitest';
import {
  alertasDaFicha,
  FICHAS_DE_EXAME,
  fichaDoExame,
  preenchidos,
} from '@/modules/clinical/fichas-de-exame';
import {
  alertasPsicossociais,
  BLOCO_PSICOSSOCIAL,
  lerBlocos,
} from '@/modules/clinical/ficha-estrutura';

describe('fichas de exame', () => {
  it('cobre os exames que a clinica pediu na lista de 27/08', () => {
    const codigos = FICHAS_DE_EXAME.map((f) => f.codigo);
    for (const esperado of [
      'ACUIDADE',
      'ISHIHARA',
      'PSICO',
      'ROMBERG',
      'FADIGA',
      'DINAMO_PAL',
      'DINAMO_ESC',
      'DINAMO_LOM',
      'AUDIO',
    ]) {
      expect(codigos).toContain(esperado);
    }
  });

  it('nao tem chave repetida dentro da mesma ficha', () => {
    for (const ficha of FICHAS_DE_EXAME) {
      const chaves = ficha.campos.map((c) => c.chave);
      expect(new Set(chaves).size, `chave repetida em ${ficha.codigo}`).toBe(chaves.length);
    }
  });

  it('devolve null para exame sem ficha propria', () => {
    expect(fichaDoExame('CLINICO')).toBeNull();
    expect(fichaDoExame(null)).toBeNull();
  });

  it('marca resultado alterado quando o Romberg da positivo', () => {
    const romberg = fichaDoExame('ROMBERG')!;
    expect(alertasDaFicha(romberg, { resultado: 'sem alteração' })).toEqual([]);
    expect(alertasDaFicha(romberg, { resultado: 'positivo' })).toHaveLength(1);
  });

  it('nao alerta com a ficha vazia', () => {
    const fadiga = fichaDoExame('FADIGA')!;
    expect(alertasDaFicha(fadiga, {})).toEqual([]);
    expect(alertasDaFicha(fadiga, null)).toEqual([]);
  });

  it('lista so o que foi preenchido, com a unidade', () => {
    const palmar = fichaDoExame('DINAMO_PAL')!;
    const linhas = preenchidos(palmar, { palmar_direita: '38' });
    expect(linhas).toEqual([{ rotulo: 'Palmar direita', valor: '38 kg' }]);
  });

  it('ignora os titulos de secao no resumo', () => {
    const audio = fichaDoExame('AUDIO')!;
    const linhas = preenchidos(audio, { od_1000: '15' });
    expect(linhas).toEqual([{ rotulo: '1 kHz', valor: '15 dB' }]);
  });
});

describe('bloco psicossocial da ficha clinica', () => {
  it('destaca ideacao suicida mesmo quando a resposta e "as vezes"', () => {
    expect(alertasPsicossociais({ ideacao: 'às vezes' })).toHaveLength(1);
    expect(alertasPsicossociais({ ideacao: 'não' })).toEqual([]);
  });

  it('destaca desorientacao no tempo e no espaco', () => {
    expect(alertasPsicossociais({ orientacao: 'não' })).toHaveLength(1);
    expect(alertasPsicossociais({ orientacao: 'sim' })).toEqual([]);
  });

  it('nao alerta quando nada foi respondido', () => {
    expect(alertasPsicossociais({})).toEqual([]);
    expect(alertasPsicossociais(null)).toEqual([]);
  });

  it('grava as respostas quando o bloco aparece na tela', () => {
    const form = new FormData();
    for (const campo of BLOCO_PSICOSSOCIAL.campos) {
      form.set(`psicossocial.${campo.chave}`, '');
    }
    form.set('psicossocial.triste', 'sim');

    expect(lerBlocos(form).psicossocial).toEqual({ triste: 'sim' });
  });

  it('nao apaga o psicossocial ja gravado quando o bloco nao aparece', () => {
    // Consulta de paciente sem o exame: nenhum campo do bloco chega no envio.
    const form = new FormData();
    form.set('estilo_vida.tabagismo', 'não');

    expect(lerBlocos(form)).not.toHaveProperty('psicossocial');
  });
});
