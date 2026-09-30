import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Solta a sala quando o ultimo exame daquele paciente nela termina.
 *
 * ---------------------------------------------------------------------
 * Por que existe em modulo proprio
 * ---------------------------------------------------------------------
 * A chamada leva de uma vez TODOS os exames do paciente que aquela sala
 * atende (pedido da Isabella, 18/09: quatro fichas na mesma chamada). Entao
 * "o exame acabou" nao e o mesmo que "a sala vagou": enquanto sobrar irmao
 * chamado ou em andamento na mesma sala, o paciente ainda esta la dentro.
 *
 * Soltar cedo demais tem consequencia real: o cartao mostra a sala livre com
 * gente dentro, e o cadastro de salas passa a permitir desativar aquela sala
 * — a trava olha `current_attendance_id`. Desativada a sala, o exame que
 * faltava fica invisivel em todas as telas.
 *
 * Havia duas formas de terminar um exame, e so uma soltava a sala:
 * `updateExamStatus` (botao Concluir) soltava; `saveExamResult` com
 * `concluir` (botao "Salvar e concluir" da ficha) nao. Na triagem ninguem
 * notou, porque sala de triagem nao aparece no quadro de Filas. Nas salas de
 * exame isso deixaria a sala presa toda vez.
 *
 * Com a regra num lugar so, as duas portas fecham do mesmo jeito.
 */
export async function liberarSalaSeVazia(
  tenantId: string,
  roomId: string | null | undefined,
  attendanceId: string,
  exameQueSaiuId: string,
): Promise<void> {
  if (!roomId) return;
  const supabase = await createClient();

  const { data: aindaLa } = await supabase
    .from('patient_exams')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('attendance_id', attendanceId)
    .eq('room_id', roomId)
    .in('status', ['chamado', 'em_andamento'])
    .neq('id', exameQueSaiuId)
    .limit(1)
    .returns<{ id: string }[]>();

  if ((aindaLa?.length ?? 0) > 0) return;

  await supabase
    .from('rooms')
    .update({ status: 'disponivel', current_attendance_id: null })
    .eq('id', roomId)
    .eq('tenant_id', tenantId);
}
