/**
 * Extrato do medico: o que ele atendeu e o que tem a receber.
 *
 * O mesmo lancamento aparece dos dois lados da clinica. Para quem cuida do
 * financeiro e conta a pagar; para o medico e conta a receber. Dar baixa
 * no repasse move a linha de "a receber" para "recebido" na tela dele —
 * nao existe um segundo lancamento, e sempre o mesmo mudando de estado.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

/** Estados possiveis de um repasse. */
export type StatusRepasse = 'a_pagar' | 'pago' | 'cancelado';

export interface LancamentoDoMedico {
  id: string;
  paciente: string | null;
  empresa: string | null;
  procedimento: string;
  fee: number | string;
  status: string;
  /** Quando o atendimento aconteceu. */
  atendidoEm: string;
  /** Primeiro dia do mes de competencia. */
  competencia: string;
  pagoEm: string | null;
}

export interface ResumoGanhos {
  /** Ja atendido, ainda nao pago pela clinica. */
  aReceber: number;
  /** Baixa dada: o dinheiro saiu. */
  recebido: number;
  /** A receber + recebido. Cancelado fica de fora. */
  total: number;
  atendimentos: number;
  pacientesUnicos: number;
}

const CANCELADO = 'cancelado';
const PAGO = 'pago';

/** Soma o extrato de um periodo. Cancelado nao entra em conta nenhuma. */
export function resumirGanhos(lancamentos: LancamentoDoMedico[]): ResumoGanhos {
  const resumo: ResumoGanhos = {
    aReceber: 0,
    recebido: 0,
    total: 0,
    atendimentos: 0,
    pacientesUnicos: 0,
  };
  const pacientes = new Set<string>();

  for (const l of lancamentos) {
    if (l.status === CANCELADO) continue;
    const valor = Number(l.fee) || 0;

    resumo.atendimentos += 1;
    resumo.total += valor;
    if (l.status === PAGO) resumo.recebido += valor;
    else resumo.aReceber += valor;

    if (l.paciente) pacientes.add(l.paciente.trim().toLocaleLowerCase('pt-BR'));
  }

  resumo.pacientesUnicos = pacientes.size;
  return resumo;
}

export interface MesDeGanhos {
  /** AAAA-MM */
  competencia: string;
  aReceber: number;
  recebido: number;
  total: number;
  atendimentos: number;
}

/**
 * Historico mes a mes, do mais recente para o mais antigo.
 *
 * E como o medico confere o proprio acerto: "em julho recebi tanto, em
 * agosto tenho tanto a receber".
 */
export function ganhosPorCompetencia(lancamentos: LancamentoDoMedico[]): MesDeGanhos[] {
  const meses = new Map<string, MesDeGanhos>();

  for (const l of lancamentos) {
    if (l.status === CANCELADO) continue;
    const chave = l.competencia.slice(0, 7);
    const mes =
      meses.get(chave) ??
      ({ competencia: chave, aReceber: 0, recebido: 0, total: 0, atendimentos: 0 } as MesDeGanhos);

    const valor = Number(l.fee) || 0;
    mes.atendimentos += 1;
    mes.total += valor;
    if (l.status === PAGO) mes.recebido += valor;
    else mes.aReceber += valor;

    meses.set(chave, mes);
  }

  return [...meses.values()].sort((a, b) => b.competencia.localeCompare(a.competencia));
}

/**
 * Rotulo do estado na tela do medico.
 *
 * O medico nao pensa em "a_pagar": isso e a visao de quem paga. Do lado
 * dele a mesma linha e algo que ele tem a receber.
 */
export function rotuloDoStatus(status: string): string {
  if (status === PAGO) return 'recebido';
  if (status === CANCELADO) return 'cancelado';
  return 'a receber';
}

export function corDoStatus(status: string): string {
  if (status === PAGO) return '#22C55E';
  if (status === CANCELADO) return '#9CA3AF';
  return '#FB923C';
}

/** Competencia atual (primeiro dia do mes) no fuso de Sao Paulo. */
export function competenciaAtual(hoje = new Date()): string {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(hoje);
  return `${iso.slice(0, 7)}-01`;
}

/** "2026-08" -> "agosto de 2026" */
export function nomeDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  if (!ano || !mes) return competencia;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, 1));
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(data);
}
