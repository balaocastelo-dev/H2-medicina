import { describe, expect, it } from 'vitest';
import {
  CODIGOS_DO_SISTEMA,
  normalizarCodigo,
  podeDesativarExame,
  podeDesativarSala,
  podeMudarCodigo,
  podeTrocarSala,
} from '@/modules/settings/salas-e-exames';

/**
 * As travas da tela de salas e exames.
 *
 * "sera que tem como a gente ter mais autonomia sobre isso?" -- Isabella,
 * 25/09. A resposta foi sim, e estas regras sao o que torna esse sim
 * seguro: sem elas, desativar uma sala num dia cheio deixaria paciente
 * esperando chamada que nunca vem.
 */

describe('normalizarCodigo', () => {
  it('tira acento, espaço e caixa', () => {
    expect(normalizarCodigo('Dinamometria Palmar')).toBe('DINAMOMETRIA_PALMAR');
    expect(normalizarCodigo('acuidade visual')).toBe('ACUIDADE_VISUAL');
    expect(normalizarCodigo('Raio-X')).toBe('RAIO_X');
  });

  it('não deixa sobrar separador nas pontas', () => {
    expect(normalizarCodigo('  ecg  ')).toBe('ECG');
    expect(normalizarCodigo('--teste--')).toBe('TESTE');
  });

  it('não estoura o tamanho do campo', () => {
    expect(normalizarCodigo('a'.repeat(50)).length).toBeLessThanOrEqual(20);
  });

  it('texto sem letra nenhuma vira vazio, e a ação recusa', () => {
    expect(normalizarCodigo('---')).toBe('');
    expect(normalizarCodigo('')).toBe('');
  });
});

describe('desativar uma sala', () => {
  it('não pode com paciente dentro', () => {
    const v = podeDesativarSala({ examesQueUsam: [], temPacienteDentro: true });
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain('paciente');
  });

  it('não pode enquanto for a sala de um exame ativo', () => {
    // Foi o defeito do primeiro seed: as dinamometrias apontavam para uma
    // sala desativada e nunca apareciam em fila nenhuma.
    const v = podeDesativarSala({
      examesQueUsam: [{ nome: 'Audiometria' }],
      temPacienteDentro: false,
    });
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain('Audiometria');
    expect(v.motivo).toContain('esse exame');
  });

  it('a frase muda no plural — quem lê precisa entender o que fazer', () => {
    const v = podeDesativarSala({
      examesQueUsam: [{ nome: 'Dinamometria palmar' }, { nome: 'Teste de Romberg' }],
      temPacienteDentro: false,
    });
    expect(v.motivo).toContain('esses exames');
    expect(v.motivo).toContain('Dinamometria palmar, Teste de Romberg');
  });

  it('sala livre e sem exame vinculado pode ser desativada', () => {
    const v = podeDesativarSala({ examesQueUsam: [], temPacienteDentro: false });
    expect(v.pode).toBe(true);
    expect(v.motivo).toBeNull();
  });

  it('paciente dentro vence, mesmo com exame vinculado', () => {
    // A mensagem tem de falar do paciente: é o que precisa ser resolvido
    // primeiro, e é o que está na frente de alguém agora.
    const v = podeDesativarSala({
      examesQueUsam: [{ nome: 'Audiometria' }],
      temPacienteDentro: true,
    });
    expect(v.motivo).toContain('paciente');
  });
});

describe('desativar um tipo de exame', () => {
  it('não pode com pedido em aberto', () => {
    const v = podeDesativarExame({ pedidosEmAberto: 3 });
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain('3');
  });

  it('sem pedido em aberto, pode', () => {
    expect(podeDesativarExame({ pedidosEmAberto: 0 }).pode).toBe(true);
  });
});

describe('trocar a sala de um exame', () => {
  it('exame que não ocupa sala não tem sala para trocar', () => {
    // Consulta clínica e psicossocial são respondidos pelo médico; raio X
    // é feito fora. Oferecer sala daria a entender que entrariam em fila.
    const v = podeTrocarSala({ ocupaSala: false, nome: 'Consulta clínica ocupacional' });
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain('Consulta clínica ocupacional');
  });

  it('exame de sala pode mudar de sala', () => {
    expect(podeTrocarSala({ ocupaSala: true, nome: 'Audiometria' }).pode).toBe(true);
  });
});

describe('mudar o código de um exame', () => {
  it.each([...CODIGOS_DO_SISTEMA])('%s não pode ser renomeado', (codigo) => {
    const v = podeMudarCodigo(codigo, 'OUTRO');
    expect(v.pode).toBe(false);
    expect(v.motivo).toContain(codigo);
  });

  it('código que o sistema não usa pode mudar', () => {
    expect(podeMudarCodigo('DINAMO_PAL', 'DINAMO_PALMAR').pode).toBe(true);
  });

  it('salvar sem mexer no código nunca é recusado', () => {
    // A clínica edita o nome de CLINICO e salva: não pode tomar erro por
    // causa de um campo que ela nem tocou.
    for (const codigo of CODIGOS_DO_SISTEMA) {
      expect(podeMudarCodigo(codigo, codigo).pode).toBe(true);
    }
  });

  it('diferença só de acento ou caixa não conta como mudança', () => {
    expect(podeMudarCodigo('CLINICO', 'clínico').pode).toBe(true);
  });
});
