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

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
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

export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
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
