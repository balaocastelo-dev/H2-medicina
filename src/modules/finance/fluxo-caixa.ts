/**
 * Fluxo de caixa da clinica.
 *
 * "Dentro da pagina /financeiro eu gostaria que tivesse uma aba chamada
 * fluxo de caixa onde mostra os valores de entrada e saida de acordo com
 * as movimentacoes. Funcionando como um DRE."
 *
 * Duas leituras convivem aqui, e confundi-las e o erro classico:
 *
 *   - **Caixa**: o que entrou e saiu de fato, na data em que o dinheiro se
 *     moveu. Responde "quanto tenho".
 *   - **Competencia**: o que foi faturado e o que foi gerado de obrigacao
 *     no periodo, pago ou nao. Responde "quanto ganhei".
 *
 * O DRE simplificado desta tela usa competencia para receita e despesa, e
 * mostra o caixa ao lado. Um mes pode fechar com lucro e caixa negativo —
 * e justamente isso que a dona da clinica precisa enxergar.
 *
 * Logica pura: sem banco, sem fuso implicito, testavel direto.
 */

export type TipoMovimento = 'receita' | 'despesa' | 'repasse';

export interface Movimento {
  /** AAAA-MM-DD em que o dinheiro se moveu. Nulo se ainda nao se moveu. */
  pagoEm: string | null;
  /** AAAA-MM-DD de competencia: quando o fato gerador aconteceu. */
  competencia: string;
  tipo: TipoMovimento;
  valor: number | string;
  /** Para agrupar na tela: "Consulta", "Aluguel", "Repasse medico". */
  categoria: string;
}

function numero(valor: number | string | null | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function dentro(data: string | null, inicio: string, fim: string): boolean {
  return !!data && data >= inicio && data <= fim;
}

export interface ResumoDoFluxo {
  /** Faturado no periodo, pago ou nao. */
  receita: number;
  /** Despesas da clinica no periodo, pagas ou nao. */
  despesa: number;
  /** Repasse gerado no periodo. */
  repasse: number;
  /** Receita menos despesa e repasse. E o resultado, nao o caixa. */
  resultado: number;
  /** Margem sobre a receita, em porcento. Null quando nao houve receita. */
  margem: number | null;

  /** Dinheiro que entrou de fato no periodo. */
  entradas: number;
  /** Dinheiro que saiu de fato no periodo. */
  saidas: number;
  /** Entradas menos saidas. */
  saldoDeCaixa: number;

  /** Faturado e ainda nao recebido. */
  aReceber: number;
  /** Devido e ainda nao pago, incluindo repasse. */
  aPagar: number;
}

/**
 * Fecha o periodo nas duas leituras.
 *
 * Repasse entra como saida, nao como reducao de receita: para a clinica
 * ele e custo do atendimento, e some do resultado do mesmo jeito, mas
 * aparecer separado deixa ver quanto do faturamento vai para os medicos.
 */
export function resumirFluxo(
  movimentos: Movimento[],
  inicio: string,
  fim: string,
): ResumoDoFluxo {
  const r: ResumoDoFluxo = {
    receita: 0,
    despesa: 0,
    repasse: 0,
    resultado: 0,
    margem: null,
    entradas: 0,
    saidas: 0,
    saldoDeCaixa: 0,
    aReceber: 0,
    aPagar: 0,
  };

  for (const m of movimentos) {
    const valor = numero(m.valor);
    const naCompetencia = dentro(m.competencia, inicio, fim);
    const noCaixa = dentro(m.pagoEm, inicio, fim);

    if (naCompetencia) {
      if (m.tipo === 'receita') r.receita += valor;
      else if (m.tipo === 'despesa') r.despesa += valor;
      else r.repasse += valor;
    }

    if (noCaixa) {
      if (m.tipo === 'receita') r.entradas += valor;
      else r.saidas += valor;
    }

    // Pendente e o que venceu ou foi gerado ate o fim do periodo e ainda
    // nao foi liquidado. Conta futura nao entra: nao e atraso, e agenda.
    if (!m.pagoEm && m.competencia <= fim) {
      if (m.tipo === 'receita') r.aReceber += valor;
      else r.aPagar += valor;
    }
  }

  r.resultado = r.receita - r.despesa - r.repasse;
  r.saldoDeCaixa = r.entradas - r.saidas;
  r.margem = r.receita > 0 ? Math.round((r.resultado / r.receita) * 1000) / 10 : null;

  return r;
}

export interface LinhaPorCategoria {
  categoria: string;
  valor: number;
  /** Fatia da receita ou da despesa total, em porcento. */
  fatia: number;
}

/** Quebra por categoria, da maior para a menor. */
export function porCategoria(
  movimentos: Movimento[],
  tipo: TipoMovimento,
  inicio: string,
  fim: string,
): LinhaPorCategoria[] {
  const soma = new Map<string, number>();

  for (const m of movimentos) {
    if (m.tipo !== tipo || !dentro(m.competencia, inicio, fim)) continue;
    const chave = m.categoria?.trim() || 'Sem categoria';
    soma.set(chave, (soma.get(chave) ?? 0) + numero(m.valor));
  }

  const total = [...soma.values()].reduce((s, v) => s + v, 0);

  return [...soma.entries()]
    .map(([categoria, valor]) => ({
      categoria,
      valor,
      fatia: total > 0 ? Math.round((valor / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.valor - a.valor);
}

export interface MesDoFluxo {
  /** AAAA-MM */
  mes: string;
  receita: number;
  despesa: number;
  repasse: number;
  resultado: number;
}

/** Evolucao mes a mes, do mais antigo para o mais recente. */
export function evolucaoMensal(movimentos: Movimento[]): MesDoFluxo[] {
  const meses = new Map<string, MesDoFluxo>();

  for (const m of movimentos) {
    const chave = m.competencia.slice(0, 7);
    const mes =
      meses.get(chave) ??
      ({ mes: chave, receita: 0, despesa: 0, repasse: 0, resultado: 0 } as MesDoFluxo);

    const valor = numero(m.valor);
    if (m.tipo === 'receita') mes.receita += valor;
    else if (m.tipo === 'despesa') mes.despesa += valor;
    else mes.repasse += valor;

    meses.set(chave, mes);
  }

  return [...meses.values()]
    .map((m) => ({ ...m, resultado: m.receita - m.despesa - m.repasse }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

export type Periodo = 'dia' | 'semana' | 'mes' | 'ano' | 'personalizado';

/**
 * Janela de datas de cada periodo.
 *
 * "personalizado" devolve o que veio, para a tela mandar no intervalo que
 * a pessoa escolheu.
 */
export function janelaDoPeriodo(
  periodo: Periodo,
  referencia: string,
  personalizado?: { inicio: string; fim: string },
): { inicio: string; fim: string } {
  if (periodo === 'personalizado' && personalizado) {
    const { inicio, fim } = personalizado;
    // Intervalo invertido e erro de digitacao, nao intencao: desinverte.
    return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
  }

  const [ano, mes, dia] = referencia.split('-').map(Number) as [number, number, number];

  if (periodo === 'dia') return { inicio: referencia, fim: referencia };

  if (periodo === 'semana') {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    const domingo = new Date(d);
    domingo.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const sabado = new Date(domingo);
    sabado.setUTCDate(domingo.getUTCDate() + 6);
    return { inicio: domingo.toISOString().slice(0, 10), fim: sabado.toISOString().slice(0, 10) };
  }

  if (periodo === 'mes') {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const mm = String(mes).padStart(2, '0');
    return { inicio: `${ano}-${mm}-01`, fim: `${ano}-${mm}-${String(ultimo).padStart(2, '0')}` };
  }

  return { inicio: `${ano}-01-01`, fim: `${ano}-12-31` };
}

export const ROTULO_PERIODO: Record<Periodo, string> = {
  dia: 'Dia',
  semana: 'Semana',
  mes: 'Mês',
  ano: 'Ano',
  personalizado: 'Personalizado',
};
