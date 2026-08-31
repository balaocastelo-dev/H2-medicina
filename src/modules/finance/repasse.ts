/**
 * Regras puras do financeiro: catalogo de procedimentos, competencia,
 * agrupamento do repasse por medico e montagem do calendario.
 *
 * Nada aqui toca o banco — por isso da para testar tudo sem subir servidor.
 */

export interface ProcedimentoPadrao {
  code: string;
  name: string;
  default_fee: number;
  sort_order: number;
  /**
   * Pericia e junta medica sao avaliacoes, nao consulta ocupacional: nao ha
   * ficha clinica a emitir. Vive aqui junto do catalogo porque "restaurar
   * catalogo" recria os procedimentos a partir desta lista — se a marca so
   * existisse na migration, restaurar traria a pericia emitindo ficha de novo.
   */
  emite_ficha_clinica: boolean;
}

/**
 * Tabela informada pela clinica. Fica como ponto de partida de cada tenant e
 * pode ser editada na tela — nenhum valor esta preso no codigo da aplicacao.
 * Os itens em zero aguardam o valor que ainda nao foi informado.
 */
export const CATALOGO_PADRAO: ProcedimentoPadrao[] = [
  { code: 'cps', name: 'C.P.S.', default_fee: 20, sort_order: 10, emite_ficha_clinica: true },
  { code: 'seduc', name: 'SEDUC', default_fee: 18, sort_order: 20, emite_ficha_clinica: true },
  { code: 'ingresso', name: 'Ingresso', default_fee: 44, sort_order: 30, emite_ficha_clinica: true },
  { code: 'pericia', name: 'Perícia', default_fee: 30, sort_order: 40, emite_ficha_clinica: false },
  { code: 'pericia_domiciliar_50', name: 'Perícia domiciliar (50 km)', default_fee: 0, sort_order: 50, emite_ficha_clinica: false },
  { code: 'pericia_domiciliar_100', name: 'Perícia domiciliar (100 km)', default_fee: 0, sort_order: 60, emite_ficha_clinica: false },
  { code: 'junta_pericia', name: 'Junta Médica Perícia', default_fee: 130, sort_order: 70, emite_ficha_clinica: false },
  { code: 'junta_medica', name: 'Junta Médica', default_fee: 64, sort_order: 80, emite_ficha_clinica: false },
  { code: 'junta_auxiliar', name: 'Junta Médica auxiliar', default_fee: 0, sort_order: 90, emite_ficha_clinica: false },
  { code: 'consulta_ocupacional', name: 'Consulta ocupacional', default_fee: 0, sort_order: 100, emite_ficha_clinica: true },
];

/** Primeiro dia do mes de uma data AAAA-MM-DD — a competencia do lancamento. */
export function competenciaDe(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export interface LancamentoRepasse {
  profile_id: string;
  medico: string;
  procedure_name: string;
  fee: number | string;
  status: string;
  competencia: string;
}

export interface ResumoMedico {
  profile_id: string;
  medico: string;
  atendimentos: number;
  aPagar: number;
  pago: number;
  total: number;
  porProcedimento: { nome: string; quantidade: number; valor: number }[];
}

/**
 * Agrupa os recebiveis por medico e, dentro de cada medico, por procedimento.
 * Lancamentos cancelados entram na contagem de nada — ficam de fora.
 */
export function agruparPorMedico(lancamentos: LancamentoRepasse[]): ResumoMedico[] {
  const mapa = new Map<string, ResumoMedico>();
  const procs = new Map<string, Map<string, { nome: string; quantidade: number; valor: number }>>();

  for (const l of lancamentos) {
    if (l.status === 'cancelado') continue;
    const valor = Number(l.fee) || 0;

    let resumo = mapa.get(l.profile_id);
    if (!resumo) {
      resumo = {
        profile_id: l.profile_id,
        medico: l.medico,
        atendimentos: 0,
        aPagar: 0,
        pago: 0,
        total: 0,
        porProcedimento: [],
      };
      mapa.set(l.profile_id, resumo);
      procs.set(l.profile_id, new Map());
    }

    resumo.atendimentos += 1;
    resumo.total += valor;
    if (l.status === 'pago') resumo.pago += valor;
    else resumo.aPagar += valor;

    const doMedico = procs.get(l.profile_id)!;
    const atual = doMedico.get(l.procedure_name) ?? {
      nome: l.procedure_name,
      quantidade: 0,
      valor: 0,
    };
    atual.quantidade += 1;
    atual.valor += valor;
    doMedico.set(l.procedure_name, atual);
  }

  for (const resumo of mapa.values()) {
    resumo.porProcedimento = [...(procs.get(resumo.profile_id)?.values() ?? [])].sort(
      (a, b) => b.valor - a.valor,
    );
  }

  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

export type Visao = 'dia' | 'semana' | 'mes' | 'ano' | 'personalizado';

export interface MovimentoFinanceiro {
  /** AAAA-MM-DD */
  data: string;
  tipo: 'recebido' | 'a_receber' | 'a_pagar' | 'repasse';
  valor: number | string;
}

export interface DiaFinanceiro {
  iso: string;
  recebido: number;
  aReceber: number;
  aPagar: number;
  repasse: number;
  /** Recebido menos o que sai (contas + repasse). */
  saldo: number;
}

/** Constroi a grade do calendario financeiro, um item por dia do periodo. */
export function montarCalendario(
  inicio: string,
  fim: string,
  movimentos: MovimentoFinanceiro[],
): DiaFinanceiro[] {
  const dias = new Map<string, DiaFinanceiro>();
  for (const iso of intervaloDeDias(inicio, fim)) {
    dias.set(iso, { iso, recebido: 0, aReceber: 0, aPagar: 0, repasse: 0, saldo: 0 });
  }

  for (const m of movimentos) {
    const dia = dias.get(m.data);
    if (!dia) continue;
    const valor = Number(m.valor) || 0;
    if (m.tipo === 'recebido') dia.recebido += valor;
    else if (m.tipo === 'a_receber') dia.aReceber += valor;
    else if (m.tipo === 'a_pagar') dia.aPagar += valor;
    else dia.repasse += valor;
  }

  for (const dia of dias.values()) {
    dia.saldo = dia.recebido - dia.aPagar - dia.repasse;
  }

  return [...dias.values()];
}

/** Lista de datas AAAA-MM-DD de inicio a fim, inclusive, em fuso de Sao Paulo. */
export function intervaloDeDias(inicio: string, fim: string): string[] {
  const saida: string[] = [];
  const atual = new Date(`${inicio}T12:00:00-03:00`);
  const limite = new Date(`${fim}T12:00:00-03:00`);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
  let guarda = 0;
  while (atual <= limite && guarda < 800) {
    saida.push(fmt.format(atual));
    atual.setDate(atual.getDate() + 1);
    guarda += 1;
  }
  return saida;
}

/**
 * Janela de datas que cada visao do calendario cobre.
 *
 * `intervalo` so e usado na visao personalizada, que a clinica pediu para
 * fechar periodos que nao caem em dia, semana, mes ou ano — competencia de
 * um contrato, por exemplo.
 */
export function periodoDaVisao(
  visao: Visao,
  referencia: string,
  intervalo?: { inicio: string; fim: string },
): { inicio: string; fim: string } {
  if (visao === 'personalizado') {
    const inicio = intervalo?.inicio || referencia;
    const fim = intervalo?.fim || referencia;
    // Data final antes da inicial acontece enquanto a pessoa ainda esta
    // preenchendo os dois campos. Inverter mostra algo util em vez de um
    // calendario vazio.
    return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
  }

  const [ano, mes, dia] = referencia.split('-').map(Number) as [number, number, number];

  if (visao === 'dia') return { inicio: referencia, fim: referencia };

  if (visao === 'semana') {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    const domingo = new Date(d);
    domingo.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const sabado = new Date(domingo);
    sabado.setUTCDate(domingo.getUTCDate() + 6);
    return { inicio: isoUTC(domingo), fim: isoUTC(sabado) };
  }

  if (visao === 'mes') {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return {
      inicio: `${ano}-${String(mes).padStart(2, '0')}-01`,
      fim: `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`,
    };
  }

  return { inicio: `${ano}-01-01`, fim: `${ano}-12-31` };
}

function isoUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Soma os dias em blocos mensais — usado na visao anual. */
export function agruparPorMes(dias: DiaFinanceiro[]): (DiaFinanceiro & { mes: string })[] {
  const meses = new Map<string, DiaFinanceiro & { mes: string }>();
  for (const d of dias) {
    const chave = d.iso.slice(0, 7);
    const atual =
      meses.get(chave) ??
      ({ mes: chave, iso: `${chave}-01`, recebido: 0, aReceber: 0, aPagar: 0, repasse: 0, saldo: 0 } as DiaFinanceiro & { mes: string });
    atual.recebido += d.recebido;
    atual.aReceber += d.aReceber;
    atual.aPagar += d.aPagar;
    atual.repasse += d.repasse;
    atual.saldo += d.saldo;
    meses.set(chave, atual);
  }
  return [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
