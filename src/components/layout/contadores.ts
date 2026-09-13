import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { startOfTodayISO } from '@/lib/format';
import { contarPorSetor, type Contadores } from './contadores-calculo';

export type { Contadores };

/**
 * Quantos pacientes estao em cada setor da clinica neste momento.
 *
 * Uma consulta so, em vez das sete de antes.
 *
 * Eram sete contagens em paralelo, mas paralelo no cliente nao e de graca:
 * sao sete idas e voltas ate o banco em cada carregamento de pagina, e o
 * menu aparece em toda tela do sistema. Trazer as etapas abertas do dia e
 * contar aqui custa uma viagem — a clinica move algumas dezenas de
 * pacientes por dia, nao dezenas de milhares.
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
    const { data, error } = await supabase
      .from('attendances')
      .select('stage_code')
      .eq('tenant_id', tenantId)
      .gte('checkin_at', startOfTodayISO())
      .is('finished_at', null)
      .is('deleted_at', null)
      .limit(2000)
      .returns<{ stage_code: string }[]>();

    if (error) throw error;
    return contarPorSetor(data ?? []);
  } catch (error) {
    // O menu nunca pode quebrar por causa de um contador.
    console.error('[menu] falha ao contar pendências:', error);
    return {};
  }
}
