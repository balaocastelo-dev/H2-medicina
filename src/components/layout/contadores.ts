import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { startOfTodayISO } from '@/lib/format';
import type { ContadorChave } from './nav-config';

export type Contadores = Partial<Record<ContadorChave, number>>;

/**
 * Quantos pacientes estao em cada setor da clinica neste momento.
 *
 * Cada atendimento aberto esta em exatamente uma etapa, entao somar as
 * bolinhas de recepcao, triagem, filas, medico, pagamentos e documentos da
 * o total de gente dentro da clinica — que e justamente o numero mostrado
 * na bolinha do CRM. Contagens usam `head: true`: o banco devolve so o
 * numero, sem trafegar as linhas.
 */
export async function carregarContadores(tenantId: string): Promise<Contadores> {
  try {
    const supabase = await createClient();

    // Mesma janela que as telas usam: o movimento de hoje.
    //
    // Sem isso o contador somava atendimento de dia anterior que ficou
    // aberto — a bolinha dizia "2 na recepcao" e a tela da recepcao abria
    // vazia. Bolinha que aponta para tela vazia treina a equipe a ignorar
    // a bolinha, e ai ela deixa de servir para qualquer coisa.
    const inicioDoDia = startOfTodayISO();

    const abertos = (etapas: string[]) =>
      supabase
        .from('attendances')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('stage_code', etapas)
        .gte('checkin_at', inicioDoDia)
        .is('finished_at', null)
        .is('deleted_at', null);

    const [recepcao, triagem, filas, medico, pagamentos, documentos, crm] = await Promise.all([
      abertos(['aguardando_recepcao', 'na_recepcao']),
      abertos(['aguardando_triagem', 'em_triagem']),
      abertos(['aguardando_exames', 'em_exames']),
      // 'em_consulta' entra aqui: o paciente esta na sala do medico agora.
      // Sem isso ele sumia de todas as bolinhas e a soma nao batia com a
      // quantidade de gente dentro da clinica.
      abertos(['aguardando_medico', 'em_consulta']),
      abertos(['aguardando_pagamento']),
      abertos(['aguardando_documentos']),
      abertos([
        'aguardando_recepcao', 'na_recepcao', 'aguardando_triagem', 'em_triagem',
        'aguardando_exames', 'em_exames', 'aguardando_medico', 'em_consulta',
        'aguardando_pagamento', 'aguardando_documentos',
      ]),
    ]);

    return {
      recepcao: recepcao.count ?? 0,
      triagem: triagem.count ?? 0,
      filas: filas.count ?? 0,
      medico: medico.count ?? 0,
      pagamentos: pagamentos.count ?? 0,
      documentos: documentos.count ?? 0,
      crm: crm.count ?? 0,
    };
  } catch (error) {
    // O menu nunca pode quebrar por causa de um contador.
    console.error('[menu] falha ao contar pendências:', error);
    return {};
  }
}
