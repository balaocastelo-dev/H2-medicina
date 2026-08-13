/**
 * Procedencia do paciente e o caminho que ela impoe dentro da casa.
 *
 * A clinica atende quatro publicos que chegam pela mesma porta e seguem
 * por corredores diferentes. Ate aqui a recepcao decidia de cabeca; agora
 * a escolha e explicita e o encaminhamento sai dela.
 *
 * Logica pura de proposito: da para testar sem banco e sem sessao.
 */

export type OriginKind = 'particular' | 'estado' | 'sisper' | 'ingresso';

export const ORIGIN_KINDS: OriginKind[] = ['particular', 'estado', 'sisper', 'ingresso'];

export interface RegraProcedencia {
  code: OriginKind;
  /** Letra usada no dia a dia da recepcao. */
  letter: 'P' | 'E' | 'S' | 'I';
  label: string;
  /** Texto curto para cracha e listagem. */
  short: string;
  color: string;
  /** Se passa pela triagem antes de qualquer outra coisa. */
  needsTriage: boolean;
  /** Para onde vai depois da triagem. */
  afterTriage: 'exames' | 'medico';
  /** Ficha medica com todos os selos (caso do ingresso escolar). */
  fichaCompleta: boolean;
  /** Exige o termo de autorizacao de envio de resultados a empresa. */
  requiresAuthorization: boolean;
  /**
   * Se o atendimento gera cobranca na recepcao.
   *
   * Estado, SISPER e ingresso sao custeados pelo orgao de origem: o
   * paciente nao paga no balcao e a tela nao deve nem oferecer o Pix.
   */
  requiresPayment: boolean;
  /** Explicacao mostrada na recepcao ao escolher a opcao. */
  description: string;
}

export const REGRAS: Record<OriginKind, RegraProcedencia> = {
  particular: {
    code: 'particular',
    letter: 'P',
    label: 'Empresa / Particular',
    short: 'Particular',
    color: '#2563EB',
    needsTriage: true,
    afterTriage: 'exames',
    fichaCompleta: false,
    requiresAuthorization: true,
    requiresPayment: true,
    description: 'Triagem e fichas, depois as filas de exame e o médico. Paga na recepção.',
  },
  estado: {
    code: 'estado',
    letter: 'E',
    label: 'Estado — licença ESISLA',
    short: 'Estado',
    color: '#7C3AED',
    needsTriage: false,
    afterTriage: 'medico',
    fichaCompleta: false,
    requiresAuthorization: false,
    requiresPayment: false,
    description: 'Vai direto ao módulo médico, sem passar pela triagem. Sem cobrança.',
  },
  sisper: {
    code: 'sisper',
    letter: 'S',
    label: 'SISPER',
    short: 'SISPER',
    color: '#0D9488',
    needsTriage: true,
    afterTriage: 'medico',
    fichaCompleta: false,
    requiresAuthorization: false,
    requiresPayment: false,
    description: 'Passa pela triagem e segue direto ao médico. Sem cobrança.',
  },
  ingresso: {
    code: 'ingresso',
    letter: 'I',
    label: 'Ingresso — ESISLA (escola)',
    short: 'Ingresso',
    color: '#EA580C',
    needsTriage: true,
    afterTriage: 'medico',
    fichaCompleta: true,
    requiresAuthorization: false,
    requiresPayment: false,
    description: 'Triagem e depois o médico, com ficha completa (todos os selos). Sem cobrança.',
  },
};

export function regraDe(kind: string | null | undefined): RegraProcedencia {
  return REGRAS[(kind ?? 'particular') as OriginKind] ?? REGRAS.particular;
}

export function isOriginKind(value: unknown): value is OriginKind {
  return typeof value === 'string' && ORIGIN_KINDS.includes(value as OriginKind);
}

/**
 * Etapa seguinte quando a recepcao conclui o atendimento.
 *
 * `needsTriage` chega da tela porque a recepcao pode contrariar o padrao
 * num caso pontual — a procedencia define a sugestao, nao uma prisao.
 */
export function proximaEtapaDaRecepcao(input: {
  originKind: OriginKind;
  needsTriage: boolean;
  temExames: boolean;
}): 'aguardando_triagem' | 'aguardando_exames' | 'aguardando_medico' {
  if (input.needsTriage) return 'aguardando_triagem';

  const regra = REGRAS[input.originKind];

  // Sem triagem e sem exame para fazer, mandar para a fila deixaria o
  // paciente parado: nao ha exame para concluir e nada dispara a etapa
  // seguinte. Vai direto ao medico.
  if (regra.afterTriage === 'medico' || !input.temExames) return 'aguardando_medico';
  return 'aguardando_exames';
}

/** Documentos entregues ao fim do atendimento — iguais para as quatro procedencias. */
export const DOCUMENTOS_DE_SAIDA = [
  'comprovante_comparecimento',
  'recibo',
  'comprovante_agendamento',
] as const;

export type DocumentoDeSaida = (typeof DOCUMENTOS_DE_SAIDA)[number];
