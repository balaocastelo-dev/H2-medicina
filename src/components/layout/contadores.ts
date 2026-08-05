import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ContadorChave } from './nav-config';

export type Contadores = Partial<Record<ContadorChave, number>>;

/**
 * Quantas operações estão esperando alguém em cada etapa.
 *
 * Serve para o administrativo e a recepção enxergarem, sem abrir tela por
 * tela, onde ha trabalho parado. Contagens sao feitas com `head: true`:
 * o banco devolve so o numero, sem trafegar as linhas.
 */
export async function carregarContadores(tenantId: string): Promise<Contadores> {
  try {
    const supabase = await createClient();

    const abertos = (etapas: string[]) =>
      supabase
        .from('attendances')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('stage_code', etapas)
        .is('finished_at', null)
        .is('deleted_at', null);

    const [recepcao, triagem, filas, medico, pagamentos, documentos, crm] = await Promise.all([
      abertos(['aguardando_recepcao', 'na_recepcao']),
      abertos(['aguardando_triagem', 'em_triagem']),
      abertos(['aguardando_exames', 'em_exames']),
      abertos(['aguardando_medico']),
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
