import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PADRAO,
  agruparPorMedico,
  agruparPorMes,
  competenciaDe,
  intervaloDeDias,
  montarCalendario,
  periodoDaVisao,
} from '@/modules/finance/repasse';

describe('competenciaDe', () => {
  it('joga qualquer dia para o primeiro do mes', () => {
    expect(competenciaDe('2026-08-19')).toBe('2026-08-01');
    expect(competenciaDe('2026-01-01')).toBe('2026-01-01');
  });
});

describe('catalogo padrao', () => {
  it('nao repete codigo', () => {
    const codigos = CATALOGO_PADRAO.map((p) => p.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('traz a tabela confirmada pela clinica', () => {
    const seduc = CATALOGO_PADRAO.find((p) => p.code === 'seduc');
    expect(seduc?.default_fee).toBe(18);
    expect(CATALOGO_PADRAO.find((p) => p.code === 'junta_pericia')?.default_fee).toBe(130);
  });
});

describe('agruparPorMedico', () => {
  const base = { competencia: '2026-08-01' };
  const lancamentos = [
    { ...base, profile_id: 'a', medico: 'Dra. Wania', procedure_name: 'Perícia', fee: 30, status: 'a_pagar' },
    { ...base, profile_id: 'a', medico: 'Dra. Wania', procedure_name: 'Perícia', fee: 30, status: 'pago' },
    { ...base, profile_id: 'a', medico: 'Dra. Wania', procedure_name: 'SEDUC', fee: '18', status: 'a_pagar' },
    { ...base, profile_id: 'b', medico: 'Dr. Paulo', procedure_name: 'C.P.S.', fee: 20, status: 'a_pagar' },
    { ...base, profile_id: 'b', medico: 'Dr. Paulo', procedure_name: 'C.P.S.', fee: 20, status: 'cancelado' },
  ];

  it('soma por medico separando pago de a pagar', () => {
    const [primeiro, segundo] = agruparPorMedico(lancamentos);
    expect(primeiro?.medico).toBe('Dra. Wania');
    expect(primeiro?.atendimentos).toBe(3);
    expect(primeiro?.total).toBe(78);
    expect(primeiro?.pago).toBe(30);
    expect(primeiro?.aPagar).toBe(48);
    expect(segundo?.total).toBe(20);
  });

  it('ignora lancamento cancelado', () => {
    const paulo = agruparPorMedico(lancamentos).find((m) => m.profile_id === 'b');
    expect(paulo?.atendimentos).toBe(1);
  });

  it('detalha por procedimento do maior para o menor', () => {
    const wania = agruparPorMedico(lancamentos)[0];
    expect(wania?.porProcedimento[0]).toEqual({ nome: 'Perícia', quantidade: 2, valor: 60 });
    expect(wania?.porProcedimento[1]).toEqual({ nome: 'SEDUC', quantidade: 1, valor: 18 });
  });

  it('devolve lista vazia sem lancamento', () => {
    expect(agruparPorMedico([])).toEqual([]);
  });
});

describe('periodoDaVisao', () => {
  it('dia cobre so o dia', () => {
    expect(periodoDaVisao('dia', '2026-08-19')).toEqual({ inicio: '2026-08-19', fim: '2026-08-19' });
  });

  it('semana vai de domingo a sabado', () => {
    // 2026-08-19 e uma quarta-feira
    expect(periodoDaVisao('semana', '2026-08-19')).toEqual({
      inicio: '2026-08-16',
      fim: '2026-08-22',
    });
  });

  it('mes respeita o ultimo dia, inclusive fevereiro bissexto', () => {
    expect(periodoDaVisao('mes', '2026-08-19').fim).toBe('2026-08-31');
    expect(periodoDaVisao('mes', '2026-02-10').fim).toBe('2026-02-28');
    expect(periodoDaVisao('mes', '2028-02-10').fim).toBe('2028-02-29');
  });

  it('ano cobre janeiro a dezembro', () => {
    expect(periodoDaVisao('ano', '2026-08-19')).toEqual({ inicio: '2026-01-01', fim: '2026-12-31' });
  });

  it('periodo personalizado usa as duas datas escolhidas', () => {
    expect(
      periodoDaVisao('personalizado', '2026-08-19', { inicio: '2026-08-01', fim: '2026-08-15' }),
    ).toEqual({ inicio: '2026-08-01', fim: '2026-08-15' });
  });

  it('inverte quando a data final vem antes da inicial', () => {
    // Acontece enquanto a pessoa ainda esta preenchendo o segundo campo.
    expect(
      periodoDaVisao('personalizado', '2026-08-19', { inicio: '2026-08-20', fim: '2026-08-05' }),
    ).toEqual({ inicio: '2026-08-05', fim: '2026-08-20' });
  });

  it('personalizado sem intervalo cai no dia de referencia', () => {
    expect(periodoDaVisao('personalizado', '2026-08-19')).toEqual({
      inicio: '2026-08-19',
      fim: '2026-08-19',
    });
  });
});

describe('intervaloDeDias', () => {
  it('inclui as duas pontas', () => {
    expect(intervaloDeDias('2026-08-19', '2026-08-21')).toEqual([
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
    ]);
  });

  it('atravessa a virada do mes', () => {
    expect(intervaloDeDias('2026-01-30', '2026-02-02')).toHaveLength(4);
  });

  it('cobre o ano inteiro sem estourar a guarda', () => {
    expect(intervaloDeDias('2026-01-01', '2026-12-31')).toHaveLength(365);
  });
});

describe('montarCalendario', () => {
  it('distribui os movimentos e calcula o saldo', () => {
    const dias = montarCalendario('2026-08-19', '2026-08-20', [
      { data: '2026-08-19', tipo: 'recebido', valor: 500 },
      { data: '2026-08-19', tipo: 'a_pagar', valor: 120 },
      { data: '2026-08-19', tipo: 'repasse', valor: '80' },
      { data: '2026-08-20', tipo: 'a_receber', valor: 300 },
      { data: '2026-09-01', tipo: 'recebido', valor: 999 },
    ]);

    expect(dias).toHaveLength(2);
    expect(dias[0]).toMatchObject({ recebido: 500, aPagar: 120, repasse: 80, saldo: 300 });
    expect(dias[1]).toMatchObject({ aReceber: 300, saldo: 0 });
  });
});

describe('agruparPorMes', () => {
  it('condensa os dias em meses ordenados', () => {
    const meses = agruparPorMes(
      montarCalendario('2026-01-01', '2026-02-28', [
        { data: '2026-01-05', tipo: 'recebido', valor: 100 },
        { data: '2026-01-20', tipo: 'recebido', valor: 50 },
        { data: '2026-02-03', tipo: 'a_pagar', valor: 30 },
      ]),
    );
    expect(meses).toHaveLength(2);
    expect(meses[0]).toMatchObject({ mes: '2026-01', recebido: 150, saldo: 150 });
    expect(meses[1]).toMatchObject({ mes: '2026-02', aPagar: 30, saldo: -30 });
  });
});
