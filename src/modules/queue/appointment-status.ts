/**
 * Traducao entre a jornada do paciente e o status exibido na agenda.
 *
 * Fica separado do helper de servidor de proposito: e logica pura, testavel
 * sem banco e sem sessao.
 */
const EM_SERVICO = new Set([
  'na_recepcao',
  'aguardando_triagem',
  'em_triagem',
  'aguardando_exames',
  'em_exames',
  'aguardando_medico',
  'em_consulta',
  'aguardando_pagamento',
  'aguardando_documentos',
]);

export type StatusAgendamento =
  | 'checkin'
  | 'em_atendimento'
  | 'realizado'
  | 'ausente'
  | 'cancelado';

export interface EstadoAtendimento {
  stage_code: string;
  finished_at: string | null;
  cancelled_at: string | null;
  absent_at: string | null;
}

export function statusDoAtendimento(atendimento: EstadoAtendimento): StatusAgendamento {
  if (atendimento.cancelled_at || atendimento.stage_code === 'cancelado') return 'cancelado';
  if (atendimento.absent_at || atendimento.stage_code === 'ausente') return 'ausente';
  if (atendimento.finished_at || atendimento.stage_code === 'finalizado') return 'realizado';
  if (EM_SERVICO.has(atendimento.stage_code)) return 'em_atendimento';
  return 'checkin';
}
