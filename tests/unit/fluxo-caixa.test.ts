import { describe, expect, it } from 'vitest';
import {
  evolucaoMensal,
  janelaDoPeriodo,
  porCategoria,
  resumirFluxo,
  type Movimento,
} from '@/modules/finance/fluxo-caixa';

const AGOSTO = { inicio: '2026-08-01', fim: '2026-08-31' };

const mov = (over: Partial<Movimento>): Movimento => ({
  pagoEm: '2026-08-10',
  competencia: '2026-08-10',
  tipo: 'receita',
  valor: 100,
  categoria: 'Consulta',
  ...over,
});

describe('resumirFluxo — competência', () => {
  it('soma receita, despesa e repasse do periodo', () => {
    const r = resumirFluxo(
      [
        mov({ tipo: 'receita', valor: 1000 }),
        mov({ tipo: 'despesa', valor: 300, categoria: 'Aluguel' }),
        mov({ tipo: 'repasse', valor: 200, categoria: 'Repasse médico' }),
      ],
      AGOSTO.inicio,
      AGOSTO.fim,
    );

    expect(r.receita).toBe(1000);
    expect(r.despesa).toBe(300);
    expect(r.repasse).toBe(200);
    expect(r.resultado).toBe(500);
    expect(r.margem).toBe(50);
  });

  it('ignora o que e de outro periodo', () => {
    const r = resumirFluxo(
      [mov({ competencia: '2026-07-20', pagoEm: '2026-07-20', valor: 999 })],
      AGOSTO.inicio,
      AGOSTO.fim,
    );
    expect(r.receita).toBe(0);
  });

  it('margem e nula quando nao houve receita: divisao por zero nao vira zero', () => {
    const r = resumirFluxo([mov({ tipo: 'despesa', valor: 100 })], AGOSTO.inicio, AGOSTO.fim);
    expect(r.margem).toBeNull();
    expect(r.resultado).toBe(-100);
  });

  it('aceita valor que vem do banco como texto', () => {
    expect(resumirFluxo([mov({ valor: '250.50' })], AGOSTO.inicio, AGOSTO.fim).receita).toBe(250.5);
  });
});

describe('resumirFluxo — caixa', () => {
  it('conta o dinheiro na data em que ele se moveu, nao na competencia', () => {
    const r = resumirFluxo(
      [mov({ competencia: '2026-07-25', pagoEm: '2026-08-05', valor: 400 })],
      AGOSTO.inicio,
      AGOSTO.fim,
    );

    // Faturado em julho, recebido em agosto: entra no caixa de agosto e
    // nao na receita de agosto.
    expect(r.entradas).toBe(400);
    expect(r.receita).toBe(0);
  });

  it('mes pode fechar com lucro e caixa negativo', () => {
    const r = resumirFluxo(
      [
        mov({ tipo: 'receita', valor: 1000, pagoEm: null }),
        mov({ tipo: 'despesa', valor: 300, pagoEm: '2026-08-10', categoria: 'Aluguel' }),
      ],
      AGOSTO.inicio,
      AGOSTO.fim,
    );

    expect(r.resultado).toBe(700);
    expect(r.saldoDeCaixa).toBe(-300);
  });

  it('repasse sai do caixa como saida', () => {
    const r = resumirFluxo([mov({ tipo: 'repasse', valor: 150 })], AGOSTO.inicio, AGOSTO.fim);
    expect(r.saidas).toBe(150);
    expect(r.saldoDeCaixa).toBe(-150);
  });
});

describe('resumirFluxo — pendentes', () => {
  it('separa a receber e a pagar', () => {
    const r = resumirFluxo(
      [
        mov({ tipo: 'receita', valor: 500, pagoEm: null }),
        mov({ tipo: 'despesa', valor: 120, pagoEm: null, categoria: 'Luz' }),
        mov({ tipo: 'repasse', valor: 80, pagoEm: null }),
      ],
      AGOSTO.inicio,
      AGOSTO.fim,
    );

    expect(r.aReceber).toBe(500);
    expect(r.aPagar).toBe(200);
  });

  it('conta futura nao e atraso: fica de fora do pendente', () => {
    const r = resumirFluxo(
      [mov({ tipo: 'despesa', valor: 900, pagoEm: null, competencia: '2026-12-01' })],
      AGOSTO.inicio,
      AGOSTO.fim,
    );
    expect(r.aPagar).toBe(0);
  });

  it('atraso de meses anteriores continua aparecendo', () => {
    const r = resumirFluxo(
      [mov({ tipo: 'receita', valor: 200, pagoEm: null, competencia: '2026-06-10' })],
      AGOSTO.inicio,
      AGOSTO.fim,
    );
    expect(r.aReceber).toBe(200);
  });

  it('clinica parada devolve tudo zerado', () => {
    const r = resumirFluxo([], AGOSTO.inicio, AGOSTO.fim);
    expect(r.resultado).toBe(0);
    expect(r.saldoDeCaixa).toBe(0);
    expect(r.margem).toBeNull();
  });
});

describe('porCategoria', () => {
  const movimentos = [
    mov({ tipo: 'despesa', valor: 600, categoria: 'Aluguel' }),
    mov({ tipo: 'despesa', valor: 300, categoria: 'Insumos' }),
    mov({ tipo: 'despesa', valor: 100, categoria: 'Insumos' }),
    mov({ tipo: 'receita', valor: 50, categoria: 'Consulta' }),
  ];

  it('agrupa e ordena da maior para a menor', () => {
    const linhas = porCategoria(movimentos, 'despesa', AGOSTO.inicio, AGOSTO.fim);
    expect(linhas.map((l) => l.categoria)).toEqual(['Aluguel', 'Insumos']);
    expect(linhas[1]?.valor).toBe(400);
  });

  it('calcula a fatia de cada categoria', () => {
    const linhas = porCategoria(movimentos, 'despesa', AGOSTO.inicio, AGOSTO.fim);
    expect(linhas[0]?.fatia).toBe(60);
    expect(linhas[1]?.fatia).toBe(40);
  });

  it('categoria em branco vira "Sem categoria" em vez de sumir', () => {
    const linhas = porCategoria(
      [mov({ tipo: 'despesa', valor: 10, categoria: '  ' })],
      'despesa',
      AGOSTO.inicio,
      AGOSTO.fim,
    );
    expect(linhas[0]?.categoria).toBe('Sem categoria');
  });
});

describe('evolucaoMensal', () => {
  it('agrupa por mes, do mais antigo para o mais recente', () => {
    const meses = evolucaoMensal([
      mov({ competencia: '2026-08-10', tipo: 'receita', valor: 100 }),
      mov({ competencia: '2026-07-10', tipo: 'receita', valor: 300 }),
      mov({ competencia: '2026-07-20', tipo: 'despesa', valor: 50 }),
    ]);

    expect(meses.map((m) => m.mes)).toEqual(['2026-07', '2026-08']);
    expect(meses[0]?.resultado).toBe(250);
    expect(meses[1]?.resultado).toBe(100);
  });
});

describe('janelaDoPeriodo', () => {
  it('dia cobre so o dia', () => {
    expect(janelaDoPeriodo('dia', '2026-08-19')).toEqual({
      inicio: '2026-08-19',
      fim: '2026-08-19',
    });
  });

  it('semana vai de domingo a sabado', () => {
    expect(janelaDoPeriodo('semana', '2026-08-19')).toEqual({
      inicio: '2026-08-16',
      fim: '2026-08-22',
    });
  });

  it('mes respeita o ultimo dia, inclusive fevereiro bissexto', () => {
    expect(janelaDoPeriodo('mes', '2026-02-10').fim).toBe('2026-02-28');
    expect(janelaDoPeriodo('mes', '2028-02-10').fim).toBe('2028-02-29');
  });

  it('ano cobre janeiro a dezembro', () => {
    expect(janelaDoPeriodo('ano', '2026-08-19')).toEqual({
      inicio: '2026-01-01',
      fim: '2026-12-31',
    });
  });

  it('personalizado usa o que a pessoa escolheu', () => {
    expect(
      janelaDoPeriodo('personalizado', '2026-08-19', { inicio: '2026-03-01', fim: '2026-05-31' }),
    ).toEqual({ inicio: '2026-03-01', fim: '2026-05-31' });
  });

  it('intervalo invertido e erro de digitacao: desinverte em vez de devolver vazio', () => {
    expect(
      janelaDoPeriodo('personalizado', '2026-08-19', { inicio: '2026-05-31', fim: '2026-03-01' }),
    ).toEqual({ inicio: '2026-03-01', fim: '2026-05-31' });
  });

  it('personalizado sem intervalo cai no ano, e nao quebra', () => {
    expect(janelaDoPeriodo('personalizado', '2026-08-19')).toEqual({
      inicio: '2026-01-01',
      fim: '2026-12-31',
    });
  });
});
