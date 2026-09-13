import type { ContadorChave } from './nav-config';

export type Contadores = Partial<Record<ContadorChave, number>>;

/**
 * De qual bolinha cada etapa faz parte.
 *
 * Cada atendimento aberto esta em exatamente uma etapa, entao somar as
 * bolinhas de recepcao, triagem, filas, medico, pagamentos e documentos da
 * o total de gente dentro da clinica — que e justamente o numero mostrado
 * na bolinha do CRM.
 */
export const SETOR_DA_ETAPA: Record<string, ContadorChave> = {
  aguardando_recepcao: 'recepcao',
  na_recepcao: 'recepcao',
  aguardando_triagem: 'triagem',
  em_triagem: 'triagem',
  aguardando_exames: 'filas',
  em_exames: 'filas',
  aguardando_medico: 'medico',
  // 'em_consulta' entra no medico: o paciente esta na sala agora. Sem isso
  // ele sumia de todas as bolinhas e a soma nao batia com a quantidade de
  // gente dentro da clinica.
  em_consulta: 'medico',
  aguardando_pagamento: 'pagamentos',
  aguardando_documentos: 'documentos',
};

/**
 * Conta os atendimentos abertos por setor.
 *
 * Logica pura, separada da consulta, para poder ser testada sem banco.
 */
export function contarPorSetor(atendimentos: { stage_code: string }[]): Contadores {
  const contagem: Contadores = {
    recepcao: 0,
    triagem: 0,
    filas: 0,
    medico: 0,
    pagamentos: 0,
    documentos: 0,
    crm: 0,
  };

  for (const { stage_code } of atendimentos) {
    const setor = SETOR_DA_ETAPA[stage_code];
    if (!setor) continue;
    contagem[setor] = (contagem[setor] ?? 0) + 1;
    // O CRM mostra todo mundo que esta dentro da clinica.
    contagem.crm = (contagem.crm ?? 0) + 1;
  }

  return contagem;
}
