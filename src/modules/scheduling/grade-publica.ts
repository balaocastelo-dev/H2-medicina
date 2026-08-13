/**
 * Grade de horarios oferecida na pagina publica de agendamento.
 *
 * A regra e simples de dizer e facil de errar: so pode aparecer o que
 * esta de fato livre. Horario ja tomado, dia sem expediente, data no
 * passado e horario que ja passou hoje precisam sumir da tela — oferecer
 * e depois recusar e pior do que nao oferecer.
 *
 * Logica pura: sem banco e sem fuso implicito, testavel direto.
 */

export interface ConfiguracaoDaGrade {
  ativo: boolean;
  /** Horarios oferecidos, em HH:MM. */
  grade: string[];
  /** Dias da semana atendidos. 1 = segunda, 7 = domingo (ISO). */
  diasUteis: number[];
  /** Quantos dias a frente, no minimo, a pessoa pode marcar. */
  diasDeAntecedencia: number;
  /** Ate quantos dias a frente a agenda fica aberta. */
  janelaDeDias: number;
}

/**
 * Hora valida de verdade.
 *
 * O formato sozinho nao basta: "25:99" tem a cara certa e nao existe.
 * Deixar passar poria um horario impossivel na tela publica.
 */
export function horaValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{2}:\d{2}$/.test(valor)) return false;
  const [h, m] = valor.split(':').map(Number);
  return (h ?? 99) <= 23 && (m ?? 99) <= 59;
}

export const GRADE_PADRAO: ConfiguracaoDaGrade = {
  ativo: true,
  grade: [
    '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
    '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  ],
  diasUteis: [1, 2, 3, 4, 5],
  diasDeAntecedencia: 1,
  janelaDeDias: 45,
};

/** Le a configuracao gravada, caindo para o padrao a cada campo ausente. */
export function lerConfiguracao(bruto: unknown): ConfiguracaoDaGrade {
  const dados = (bruto ?? {}) as Record<string, unknown>;

  const horarios = Array.isArray(dados.grade) ? dados.grade.filter(horaValida) : [];

  const dias = Array.isArray(dados.dias_uteis)
    ? dados.dias_uteis
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    : [];

  const numero = (valor: unknown, padrao: number) => {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : padrao;
  };

  return {
    ativo: dados.ativo !== false,
    grade: horarios.length > 0 ? [...horarios].sort() : GRADE_PADRAO.grade,
    diasUteis: dias.length > 0 ? dias : GRADE_PADRAO.diasUteis,
    diasDeAntecedencia: numero(dados.dias_de_antecedencia, GRADE_PADRAO.diasDeAntecedencia),
    janelaDeDias: Math.min(numero(dados.janela_de_dias, GRADE_PADRAO.janelaDeDias), 180),
  };
}

/** Data em aaaa-mm-dd no fuso de Brasilia, que e onde a clinica atende. */
export function diaEmSaoPaulo(momento: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(momento);
}

/** Hora em HH:MM no fuso de Brasilia. */
export function horaEmSaoPaulo(momento: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(momento);
}

/** Dia da semana ISO (1 = segunda, 7 = domingo) de uma data aaaa-mm-dd. */
export function diaDaSemana(dataISO: string): number {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const d = new Date(Date.UTC(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Converte dia + hora de Brasilia para o instante em UTC. */
export function instanteDe(dataISO: string, hora: string): Date {
  return new Date(`${dataISO}T${hora}:00-03:00`);
}

export function somarDias(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const d = new Date(Date.UTC(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export interface DiaDisponivel {
  data: string;
  /** Horários realmente livres neste dia. */
  horarios: string[];
}

/**
 * Monta os dias e horarios livres.
 *
 * `ocupados` traz os instantes ja tomados, em ISO — vem tanto de reservas
 * do site quanto de agendamentos feitos no balcao. A pagina publica nao
 * pode oferecer horario que a recepcao ja usou.
 */
export function diasDisponiveis(input: {
  config: ConfiguracaoDaGrade;
  ocupados: string[];
  agora?: Date;
}): DiaDisponivel[] {
  const { config } = input;
  if (!config.ativo) return [];

  const agora = input.agora ?? new Date();
  const hoje = diaEmSaoPaulo(agora);
  const horaAgora = horaEmSaoPaulo(agora);

  // Chave "data hora" do que ja esta tomado, no fuso da clinica.
  const tomados = new Set(
    input.ocupados.map((iso) => {
      const d = new Date(iso);
      return `${diaEmSaoPaulo(d)} ${horaEmSaoPaulo(d)}`;
    }),
  );

  const primeiro = somarDias(hoje, config.diasDeAntecedencia);
  const dias: DiaDisponivel[] = [];

  for (let i = 0; i <= config.janelaDeDias; i += 1) {
    const data = somarDias(primeiro, i);
    if (!config.diasUteis.includes(diaDaSemana(data))) continue;

    const horarios = config.grade.filter((hora) => {
      if (tomados.has(`${data} ${hora}`)) return false;
      // Horário que já passou hoje não pode aparecer como livre.
      if (data === hoje && hora <= horaAgora) return false;
      return true;
    });

    if (horarios.length > 0) dias.push({ data, horarios });
  }

  return dias;
}

/** O horário pedido continua válido? Repetido no servidor antes de gravar. */
export function horarioEhValido(input: {
  config: ConfiguracaoDaGrade;
  data: string;
  hora: string;
  ocupados: string[];
  agora?: Date;
}): { ok: true } | { ok: false; motivo: string } {
  const { config, data, hora } = input;

  if (!config.ativo) return { ok: false, motivo: 'O agendamento pelo site está desativado.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, motivo: 'Data inválida.' };
  if (!config.grade.includes(hora)) {
    return { ok: false, motivo: 'Este horário não faz parte da grade de atendimento.' };
  }
  if (!config.diasUteis.includes(diaDaSemana(data))) {
    return { ok: false, motivo: 'A clínica não atende neste dia da semana.' };
  }

  const agora = input.agora ?? new Date();
  const primeiro = somarDias(diaEmSaoPaulo(agora), config.diasDeAntecedencia);
  const ultimo = somarDias(primeiro, config.janelaDeDias);

  if (data < primeiro) {
    return {
      ok: false,
      motivo:
        config.diasDeAntecedencia > 0
          ? `É preciso agendar com pelo menos ${config.diasDeAntecedencia} dia(s) de antecedência.`
          : 'Escolha uma data futura.',
    };
  }
  if (data > ultimo) return { ok: false, motivo: 'A agenda ainda não está aberta para esta data.' };

  const alvo = `${data} ${hora}`;
  const tomado = input.ocupados.some((iso) => {
    const d = new Date(iso);
    return `${diaEmSaoPaulo(d)} ${horaEmSaoPaulo(d)}` === alvo;
  });
  if (tomado) return { ok: false, motivo: 'Este horário acabou de ser preenchido. Escolha outro.' };

  return { ok: true };
}

/**
 * Codigo do comprovante.
 *
 * Sem letras que se confundem lidas ao telefone (I/1, O/0) — a pessoa vai
 * ditar isso para a recepcao.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function gerarCodigo(aleatorio: () => number = Math.random): string {
  let saida = '';
  for (let i = 0; i < 8; i += 1) {
    saida += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)];
  }
  return `${saida.slice(0, 4)}-${saida.slice(4)}`;
}
