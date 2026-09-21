/** Formatadores pt-BR usados em toda a aplicacao. */

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export function formatCPF(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length !== 11) return value ?? '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCNPJ(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length !== 14) return value ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatDocument(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length === 11) return formatCPF(d);
  if (d.length === 14) return formatCNPJ(d);
  return value ?? '';
}

export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value ?? '';
}

export function formatZip(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length !== 8) return value ?? '';
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return currencyFormatter.format(Number.isFinite(n) ? n : 0);
}

/** "1963-12-02" e uma data pura: dia, sem hora e sem fuso. */
const DATA_PURA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Texto que o banco devolve: sempre comeca por AAAA-MM-DD.
 *
 * Qualquer outra coisa e recusada de proposito. `new Date("12/05/1990")` nao
 * falha: o JavaScript le no formato americano e devolve 5 de dezembro. Uma
 * data brasileira que caisse aqui sairia impressa com o dia e o mes
 * trocados, sem erro nenhum, e ninguem descobriria olhando a tela.
 *
 * Travessao e um defeito visivel. Data trocada e um defeito invisivel.
 */
const COMECA_EM_ISO = /^\d{4}-\d{2}-\d{2}/;

/**
 * Data no formato brasileiro.
 *
 * Data de nascimento, admissao e vencimento sao colunas `date` no banco:
 * chegam como "1963-12-02", sem hora. `new Date("1963-12-02")` le isso
 * como meia-noite em UTC, e converter para Sao Paulo (UTC-3) devolve o
 * DIA ANTERIOR.
 *
 * Era por isso que toda data de nascimento saia um dia atrasada nos
 * documentos -- inclusive no A.S.O. Uma data pura nao tem fuso para
 * converter: ela e escrita como esta.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';

  if (typeof value === 'string') {
    const puro = DATA_PURA.exec(value.slice(0, 10));
    if (puro) {
      const [, ano, mes, dia] = puro;
      // Confere que e um dia que existe: "2026-02-31" nao vira 03/03.
      const teste = new Date(`${ano}-${mes}-${dia}T12:00:00Z`);
      if (teste.getUTCMonth() + 1 !== Number(mes) || teste.getUTCDate() !== Number(dia)) {
        return '—';
      }
      return `${dia}/${mes}/${ano}`;
    }
  }

  const d = instanteDoBanco(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
}

/** Converte um valor do banco em instante, recusando texto ambiguo. */
function instanteDoBanco(value: string | Date): Date | null {
  if (typeof value === 'string') {
    if (!COMECA_EM_ISO.test(value)) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return Number.isNaN(value.getTime()) ? null : value;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = instanteDoBanco(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = instanteDoBanco(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Duracao humanizada: "1h 12min", "8min", "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}min`;
  if (m > 0) return `${m}min`;
  return `${Math.floor(seconds)}s`;
}

/** Tempo decorrido desde uma data (para cartoes do CRM). */
export function elapsedFrom(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return formatDuration((Date.now() - d.getTime()) / 1000);
}

/**
 * Idade em anos completos.
 *
 * Le a data pura sem passar por fuso, pelo mesmo motivo de `formatDate`:
 * quem nasceu em 01/01 aparecia com um ano a menos no dia do aniversario.
 */
export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;

  const puro = DATA_PURA.exec(String(birthDate).slice(0, 10));
  if (!puro) return null;

  const [, anoStr, mesStr, diaStr] = puro;
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);

  // Hoje no fuso da clinica, nao no do servidor.
  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
  const [anoH, mesH, diaH] = hojeSP.split('-').map(Number);
  if (!anoH || !mesH || !diaH) return null;

  let idade = anoH - ano;
  if (mesH < mes || (mesH === mes && diaH < dia)) idade--;
  return idade >= 0 && idade < 130 ? idade : null;
}

/** Primeiro nome + inicial do sobrenome, para o painel de TV. */
export function partialName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] ?? '';
  return `${parts[0]} ${(parts[parts.length - 1] ?? '').charAt(0)}.`;
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Helpers de data para Server Components.
 *
 * Ficam fora do corpo do componente de proposito: `Date.now()` chamado durante
 * a renderizacao e sinalizado como impuro pelo lint do React. Aqui a leitura do
 * relogio fica isolada e explicita.
 */
const FUSO = 'America/Sao_Paulo';

/**
 * Data de hoje no fuso da clinica, em AAAA-MM-DD.
 *
 * Nao use toISOString aqui: ele devolve UTC. Depois das 21h no horario de
 * Brasilia o dia UTC ja virou, e o sistema passaria a procurar a agenda do dia
 * seguinte — o paciente sumiria do totem.
 */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
}

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(d);
}

export function daysAheadISO(days: number): string {
  return daysAgoISO(-days);
}

/** Timestamp ISO de N dias atras (para filtros de consulta). */
export function sinceISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Instante em que o dia comecou no fuso da clinica, em ISO/UTC.
 * Usado para filtrar "o que aconteceu hoje" sem depender do fuso do servidor.
 */
export function startOfTodayISO(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // -03:00 e o offset de Brasilia (sem horario de verao desde 2019).
  return new Date(`${partes}T00:00:00-03:00`).toISOString();
}

/**
 * Converte o horario escolhido na tela para o instante correto em UTC.
 *
 * O campo `datetime-local` do navegador manda "2026-08-21T14:30", sem fuso
 * nenhum. `new Date()` nesse texto usa o fuso de quem esta interpretando —
 * e o servidor da Vercel roda em UTC. Era por isso que o horario "mudava
 * sozinho": marcava-se 14:30 e o banco gravava 14:30 UTC, que e 11:30 em
 * Sao Paulo. Tres horas a menos, calado.
 *
 * Aqui o horario e lido sempre como horario da clinica. Texto que ja traz
 * fuso (termina em Z ou +hh:mm) passa direto, para a funcao poder ser
 * chamada duas vezes sem estragar o valor.
 */
export function horarioLocalParaISO(valor: string): string {
  const texto = (valor ?? '').trim();
  if (!texto) return '';

  const jaTemFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto);
  const comSegundos = /T\d{2}:\d{2}$/.test(texto) ? `${texto}:00` : texto;
  const completo = jaTemFuso ? comSegundos : `${comSegundos}-03:00`;

  const data = new Date(completo);
  if (Number.isNaN(data.getTime())) return '';
  return data.toISOString();
}
