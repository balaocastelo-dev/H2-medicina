import { describe, expect, it } from 'vitest';
import {
  MAXIMO_SUGESTOES,
  nomeAbreviado,
  normalizarBusca,
  ordenarSugestoes,
  termoValido,
} from '@/modules/queue/busca-nome';

describe('normalizarBusca', () => {
  it('tira acento, caixa e pontuacao', () => {
    expect(normalizarBusca('MÔNICA DANIELA')).toBe('monica daniela');
    expect(normalizarBusca('  José   D`Ávila ')).toBe('jose d avila');
  });
});

describe('termoValido', () => {
  it('exige tres letras', () => {
    expect(termoValido('ma')).toBe(false);
    expect(termoValido('mar')).toBe(true);
  });

  it('nao aceita espaco como letra', () => {
    expect(termoValido('m a')).toBe(false);
    expect(termoValido('   ')).toBe(false);
  });
});

describe('nomeAbreviado', () => {
  it('mostra o primeiro nome e as iniciais', () => {
    expect(nomeAbreviado('MARLENE DIAS SABINO')).toBe('Marlene D. S.');
    expect(nomeAbreviado('MONICA DANIELA TOANI M PEREIRA')).toBe('Monica D. T. M. P.');
  });

  it('aguenta nome de uma palavra so', () => {
    expect(nomeAbreviado('MADONNA')).toBe('Madonna');
    expect(nomeAbreviado('')).toBe('');
  });

  it('nao expoe o sobrenome inteiro', () => {
    expect(nomeAbreviado('ANA SILVA')).not.toContain('Silva');
  });
});

describe('ordenarSugestoes', () => {
  const agenda = [
    { patientId: 'a', nomeCompleto: 'MARIA APARECIDA SELINGARDI', scheduledAt: '2026-08-20T17:45:00Z' },
    { patientId: 'b', nomeCompleto: 'MARIA SILVA', scheduledAt: '2026-08-20T17:45:00Z' },
    { patientId: 'c', nomeCompleto: 'ANA MARIA COSTA', scheduledAt: '2026-08-20T11:00:00Z' },
    { patientId: 'd', nomeCompleto: 'JOAO PEREIRA', scheduledAt: '2026-08-20T12:00:00Z' },
  ];

  it('traz quem comeca com o termo antes de quem so contem', () => {
    const r = ordenarSugestoes(agenda, 'maria');
    expect(r.map((s) => s.patientId).slice(0, 2)).toEqual(['b', 'a']);
    expect(r.map((s) => s.patientId)).toContain('c');
  });

  it('exige todas as palavras digitadas', () => {
    const r = ordenarSugestoes(agenda, 'maria silva');
    expect(r).toHaveLength(1);
    expect(r[0]?.patientId).toBe('b');
  });

  it('ignora acento e caixa: quem digita JOAO ou JOÃO acha o mesmo', () => {
    expect(ordenarSugestoes(agenda, 'JOÃO')).toHaveLength(1);
    expect(ordenarSugestoes(agenda, 'joao')).toHaveLength(1);
    expect(ordenarSugestoes(agenda, 'JOAO')[0]?.patientId).toBe('d');
  });

  it('devolve so o nome abreviado', () => {
    const r = ordenarSugestoes(agenda, 'marlene');
    expect(r).toHaveLength(0);
    const s = ordenarSugestoes(agenda, 'joao')[0];
    expect(s?.nome).toBe('Joao P.');
    expect(JSON.stringify(s)).not.toContain('PEREIRA');
  });

  it('nao devolve nada para termo que nao casa', () => {
    expect(ordenarSugestoes(agenda, 'zzz')).toEqual([]);
  });

  it('limita a quantidade que aparece na tela', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      patientId: String(i),
      nomeCompleto: `MARIA NUMERO ${i}`,
      scheduledAt: '2026-08-20T11:00:00Z',
    }));
    expect(ordenarSugestoes(muitos, 'maria')).toHaveLength(MAXIMO_SUGESTOES);
  });

  it('desempata pelo horario agendado', () => {
    const r = ordenarSugestoes(
      [
        { patientId: 'tarde', nomeCompleto: 'CARLOS SOUZA', scheduledAt: '2026-08-20T18:00:00Z' },
        { patientId: 'cedo', nomeCompleto: 'CARLOS SOUZA', scheduledAt: '2026-08-20T11:00:00Z' },
      ],
      'carlos',
    );
    expect(r[0]?.patientId).toBe('cedo');
  });
});
