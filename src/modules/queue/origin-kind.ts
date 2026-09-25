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
  /** Sigla do selo. Curta de proposito: cabe no cartao da fila. */
  letter: 'P' | 'PR' | 'S' | 'I';
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
    // "quando vir de estado (E) para pericia (PR) nao tera mais o nome e de
    //  estado apenas PR de pericia" -- 15/09. O codigo interno continua
    //  'estado' de proposito: mudar o valor gravado no banco renomearia o
    //  historico de todos os atendimentos ja registrados.
    letter: 'PR',
    label: 'Perícia',
    short: 'Perícia',
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

/**
 * Exames que a clinica nao realiza: o paciente leva a guia e faz fora.
 *
 * Nao entram em fila nem ocupam sala. Ate 15/09 entravam, e ficavam presos
 * numa sala inexistente -- a Izabella esperou 42 minutos por um raio-X que
 * nunca ia ser chamado. O resultado volta depois, pelo laboratorio.
 *
 * A coleta laboratorial (LAB) NAO esta aqui, e isso foi um erro meu ate
 * 18/09. Ela e feita na Sala 5 da clinica -- "somente a guia da coleta de
 * sangue deve sair com o endereco da rua sacramento", disse a clinica em
 * 13/09, justamente porque a coleta acontece aqui. O que ela nao tem e
 * ficha de preenchimento na sala.
 */
export const FORA_DA_CLINICA = new Set(['RAIOX']);

/**
 * Exames cuja solicitacao sai em guia impressa no balcao.
 *
 * Raio X porque e feito fora; coleta laboratorial porque a analise e feita
 * fora, mesmo o sangue sendo colhido aqui.
 */
export const GERA_GUIA = new Set(['RAIOX', 'LAB']);

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
/**
 * Itens respondidos pelo medico na propria consulta.
 *
 * Nao ocupam sala e nao entram em fila: quem os "faz" e o medico. Marcar um
 * deles significa que o paciente passa pelo consultorio.
 *
 * O psicossocial entrou aqui em 22/09. Ate entao ele era perguntado na
 * bancada da triagem E de novo na consulta -- o paciente respondia duas
 * vezes as mesmas perguntas, inclusive as de ideacao suicida.
 */
export const RESPONDIDOS_PELO_MEDICO = new Set(['CLINICO', 'PSICO']);

export function proximaEtapaDaRecepcao(input: {
  originKind: OriginKind;
  needsTriage: boolean;
  temExames: boolean;
  /**
   * A consulta clinica ocupacional foi marcada.
   *
   * "o paciente so deve passar pelo medico se o icone 'consulta clinica
   *  ocupacional' estiver ticado" -- Isabella, 17/09. Quem vem so fazer um
   *  eletroencefalograma termina os exames e vai embora.
   *
   * Indefinido mantem o comportamento antigo, para nao mudar o destino de
   * chamada que ainda nao passa esta informacao.
   */
  temConsulta?: boolean;
}):
  | 'aguardando_triagem'
  | 'aguardando_exames'
  | 'aguardando_medico'
  | 'aguardando_pagamento' {
  if (input.needsTriage) return 'aguardando_triagem';

  const regra = REGRAS[input.originKind];
  const temConsulta = input.temConsulta ?? true;

  // Procedencia que existe para ir ao medico vai ao medico.
  //
  // "os pacientes que eu categorizo como sisper ao clicar em encaminhar
  //  para o medico vao direto para a aba pagamentos sem passar pela
  //  chamada do medico" -- Isabella, 24/09.
  //
  // A regra da consulta clinica marcada, de 17/09, foi feita para o
  // particular: quem vem so fazer um eletroencefalograma nao deve cair
  // numa fila de consulta que ninguem pediu. Para pericia, SISPER e
  // ingresso ela nao se aplica -- a avaliacao medica E o motivo da visita,
  // e como nao e cobrada como exame nao ha "Consulta clinica ocupacional"
  // para marcar na recepcao. O botao ja dizia "Liberar para o medico"; era
  // o destino que discordava do rotulo.
  if (regra.afterTriage === 'medico') return 'aguardando_medico';

  // Nada a fazer aqui dentro: nem exame, nem consulta. Segue para o
  // pagamento, que e o passo seguinte da esteira -- mandar ao consultorio
  // colocaria o paciente numa fila para uma consulta que ninguem pediu.
  if (!input.temExames && !temConsulta) return 'aguardando_pagamento';

  // Sem exame para fazer, mandar para a fila deixaria o paciente parado:
  // nao ha exame para concluir e nada dispara a etapa seguinte.
  if (!input.temExames) return 'aguardando_medico';

  return 'aguardando_exames';
}

/**
 * Procedencias cuja avaliacao medica e o proprio motivo da visita.
 *
 * O banco precisa da mesma lista: o gatilho que move o paciente quando os
 * exames acabam, e o que roda no fim da triagem, decidem entre medico e
 * pagamento com este mesmo criterio.
 */
export const VAI_AO_MEDICO: OriginKind[] = ORIGIN_KINDS.filter(
  (k) => REGRAS[k].afterTriage === 'medico',
);

/** Documentos entregues ao fim do atendimento — iguais para as quatro procedencias. */
export const DOCUMENTOS_DE_SAIDA = [
  'comprovante_comparecimento',
  'recibo',
  'comprovante_agendamento',
] as const;

export type DocumentoDeSaida = (typeof DOCUMENTOS_DE_SAIDA)[number];
