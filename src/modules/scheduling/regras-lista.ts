/**
 * Regras da lista do proximo dia.
 *
 * Ficam separadas da acao de servidor porque sao decisoes de negocio que
 * precisam valer igual na tela e no servidor — e porque assim da para
 * testa-las sem banco.
 */

/** Status em que o paciente ja esta sendo atendido hoje. */
const EM_ANDAMENTO = ['checkin', 'em_atendimento', 'realizado'];

/** Status que nao pertencem mais ao dia. */
const FORA_DO_DIA = ['cancelado', 'remarcado'];

/**
 * Pode tirar o agendamento da lista?
 *
 * Paciente que ja fez check-in nao sai por um clique na agenda: o
 * atendimento do dia depende desse vinculo, e removê-lo aqui deixaria a
 * recepcao com um atendimento orfao.
 */
export function podeExcluirDaLista(status: string): boolean {
  return !EM_ANDAMENTO.includes(status);
}

export const MOTIVO_NAO_PODE_EXCLUIR =
  'Este paciente já iniciou o atendimento. Cancele pela tela de atendimento.';

/** O agendamento ainda aparece na lista do dia? */
export function apareceNaLista(status: string, deletedAt: string | null): boolean {
  return deletedAt === null && !FORA_DO_DIA.includes(status);
}

/** "Nao veio" so faz sentido antes de o paciente ser atendido. */
export function podeMarcarAusente(status: string): boolean {
  return !['realizado', 'em_atendimento', 'ausente', 'cancelado', 'remarcado'].includes(status);
}
