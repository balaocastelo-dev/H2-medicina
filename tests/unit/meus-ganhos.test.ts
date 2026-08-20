import { describe, expect, it } from 'vitest';
import {
  competenciaAtual,
  corDoStatus,
  ganhosPorCompetencia,
  nomeDaCompetencia,
  resumirGanhos,
  rotuloDoStatus,
  type LancamentoDoMedico,
} from '@/modules/finance/meus-ganhos';

function lanc(over: Partial<LancamentoDoMedico> = {}): LancamentoDoMedico {
  return {
    id: Math.random().toString(36).slice(2),
    paciente: 'Maria da Silva',
    empresa: 'SEDUC',
    procedimento: 'Perícia',
    fee: 30,
    status: 'a_pagar',
    atendidoEm: '2026-08-20T11:00:00Z',
    competencia: '2026-08-01',
    pagoEm: null,
    ...over,
  };
}

describe('resumirGanhos', () => {
  it('separa o que ainda vem do que ja caiu', () => {
    const r = resumirGanhos([
      lanc({ fee: 30, status: 'a_pagar' }),
      lanc({ fee: 18, status: 'a_pagar', paciente: 'João Souza' }),
      lanc({ fee: 44, status: 'pago', paciente: 'Ana Costa' }),
    ]);

    expect(r.aReceber).toBe(48);
    expect(r.recebido).toBe(44);
    expect(r.total).toBe(92);
    expect(r.atendimentos).toBe(3);
  });

  it('deixa o cancelado de fora de tudo', () => {
    const r = resumirGanhos([
      lanc({ fee: 30, status: 'a_pagar' }),
      lanc({ fee: 999, status: 'cancelado' }),
    ]);

    expect(r.total).toBe(30);
    expect(r.atendimentos).toBe(1);
  });

  it('aceita valor que vem do banco como texto', () => {
    expect(resumirGanhos([lanc({ fee: '30.50' })]).aReceber).toBe(30.5);
  });

  it('conta paciente uma vez so, mesmo com caixa diferente', () => {
    const r = resumirGanhos([
      lanc({ paciente: 'Maria da Silva' }),
      lanc({ paciente: 'MARIA DA SILVA' }),
      lanc({ paciente: 'João Souza' }),
    ]);

    expect(r.atendimentos).toBe(3);
    expect(r.pacientesUnicos).toBe(2);
  });

  it('devolve zeros sem lancamento', () => {
    expect(resumirGanhos([])).toEqual({
      aReceber: 0,
      recebido: 0,
      total: 0,
      atendimentos: 0,
      pacientesUnicos: 0,
    });
  });
});

describe('ganhosPorCompetencia', () => {
  it('agrupa por mes, do mais recente para o mais antigo', () => {
    const meses = ganhosPorCompetencia([
      lanc({ competencia: '2026-07-01', fee: 100, status: 'pago' }),
      lanc({ competencia: '2026-08-01', fee: 30, status: 'a_pagar' }),
      lanc({ competencia: '2026-08-01', fee: 20, status: 'pago' }),
    ]);

    expect(meses.map((m) => m.competencia)).toEqual(['2026-08', '2026-07']);
    expect(meses[0]).toMatchObject({ aReceber: 30, recebido: 20, total: 50, atendimentos: 2 });
    expect(meses[1]).toMatchObject({ recebido: 100, aReceber: 0 });
  });

  it('ignora cancelado tambem no historico', () => {
    const meses = ganhosPorCompetencia([
      lanc({ competencia: '2026-08-01', fee: 30 }),
      lanc({ competencia: '2026-08-01', fee: 500, status: 'cancelado' }),
    ]);

    expect(meses[0]?.total).toBe(30);
    expect(meses[0]?.atendimentos).toBe(1);
  });
});

describe('rotuloDoStatus', () => {
  it('fala a lingua de quem recebe, nao de quem paga', () => {
    expect(rotuloDoStatus('a_pagar')).toBe('a receber');
    expect(rotuloDoStatus('pago')).toBe('recebido');
    expect(rotuloDoStatus('cancelado')).toBe('cancelado');
  });

  it('status desconhecido cai em a receber, que e o estado inicial', () => {
    expect(rotuloDoStatus('qualquer_coisa')).toBe('a receber');
  });

  it('cada estado tem cor propria', () => {
    expect(corDoStatus('pago')).not.toBe(corDoStatus('a_pagar'));
    expect(corDoStatus('cancelado')).not.toBe(corDoStatus('pago'));
  });
});

describe('competencia', () => {
  it('joga qualquer dia para o primeiro do mes', () => {
    expect(competenciaAtual(new Date('2026-08-20T15:00:00Z'))).toBe('2026-08-01');
  });

  it('usa o fuso de Sao Paulo na virada do mes', () => {
    // 01/09 às 00:30 UTC ainda é 31/08 em São Paulo.
    expect(competenciaAtual(new Date('2026-09-01T00:30:00Z'))).toBe('2026-08-01');
  });

  it('escreve o mes por extenso', () => {
    expect(nomeDaCompetencia('2026-08')).toBe('agosto de 2026');
    expect(nomeDaCompetencia('quebrado')).toBe('quebrado');
  });
});
