/** Montagem da frase de boas-vindas. Sem dependencia de navegador. */

export type Periodo = 'manha' | 'tarde' | 'noite';

export function periodoDoDia(hora: number): Periodo {
  if (hora >= 5 && hora < 12) return 'manha';
  if (hora >= 12 && hora < 18) return 'tarde';
  return 'noite';
}

export const SAUDACAO: Record<Periodo, string> = {
  manha: 'bom dia',
  tarde: 'boa tarde',
  noite: 'boa noite',
};

const FECHOS: Record<Periodo, string[]> = {
  manha: [
    'Hoje é um lindo dia para iniciarmos os trabalhos!',
    'O dia está começando e a agenda já está pronta!',
    'Que comece mais um dia de bons atendimentos!',
  ],
  tarde: [
    'A tarde promete, e a agenda está em dia!',
    'Vamos manter o ritmo desta tarde!',
    'Boa tarde de trabalho pela frente!',
  ],
  noite: [
    'Mesmo a esta hora, seguimos firmes!',
    'Boa noite de trabalho, tudo pronto por aqui!',
    'A noite chegou, e o sistema segue com você!',
  ],
};

const DESEJOS = [
  'Espero que dê tudo certo. Tenha um excelente dia de trabalho, e conte comigo!',
  'Que tudo corra bem. Excelente jornada, e conte comigo!',
  'Desejo um dia produtivo. Estou aqui para o que precisar!',
];

export interface GreetingInput {
  nome: string;
  tratamento?: string | null;
  hora: number;
  /** Torna a frase estavel dentro do mesmo dia. */
  semente?: number;
}

/** Primeiro nome, com a primeira letra maiuscula. */
export function primeiroNome(nomeCompleto: string): string {
  const bruto = (nomeCompleto ?? '').trim().split(/\s+/)[0] ?? '';
  if (!bruto) return '';
  return bruto.charAt(0).toUpperCase() + bruto.slice(1).toLowerCase();
}

export function montarSaudacao(input: GreetingInput): string {
  const periodo = periodoDoDia(input.hora);
  const nome = primeiroNome(input.nome);
  const tratamento = (input.tratamento ?? '').trim();

  const semente = input.semente ?? new Date().getDate();
  const fechos = FECHOS[periodo];
  const fecho = fechos[semente % fechos.length] ?? fechos[0]!;
  const desejo = DESEJOS[semente % DESEJOS.length] ?? DESEJOS[0]!;

  const chamamento = [tratamento, nome].filter(Boolean).join(' ');
  const abertura = chamamento
    ? `Olá, ${SAUDACAO[periodo]}, ${chamamento}!`
    : `Olá, ${SAUDACAO[periodo]}!`;

  return `${abertura} ${fecho} ${desejo}`;
}

/** Aceita boolean ou texto vindo do painel ("sim", "nao", "false"...). */
export function saudacaoAtiva(valor: unknown): boolean {
  if (valor === undefined || valor === null || valor === '') return true;
  if (typeof valor === 'boolean') return valor;
  const texto = String(valor).trim().toLowerCase();
  return !['nao', 'não', 'false', '0', 'off', 'desativada', 'desativado'].includes(texto);
}

/**
 * A clinica pediu que o sistema nao fale sozinho ao abrir, entao o padrao
 * aqui e o oposto de `saudacaoAtiva`: so fala se alguem ligar de proposito.
 */
export function falaAutomatica(valor: unknown): boolean {
  if (valor === undefined || valor === null || valor === '') return false;
  if (typeof valor === 'boolean') return valor;
  const texto = String(valor).trim().toLowerCase();
  return ['sim', 'true', '1', 'on', 'ativa', 'ativada', 'ativo'].includes(texto);
}
