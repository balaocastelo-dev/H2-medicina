import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { statusDoAtendimento } from './appointment-status';

export { statusDoAtendimento } from './appointment-status';
export type { StatusAgendamento, EstadoAtendimento } from './appointment-status';

/**
 * Mantem o status do agendamento em sintonia com a jornada real do paciente.
 *
 * A agenda ficava congelada em "checkin": o atendimento avancava pela clinica
 * e o agendamento nunca sabia. Quem olhava a agenda via um retrato do momento
 * da chegada, nao do que estava acontecendo.
 *
 * A verdade mora no atendimento; o agendamento apenas reflete.
 */
/**
 * Atualiza o agendamento ligado a este atendimento.
 * Nunca lanca: sincronizar a agenda nao pode derrubar a operacao clinica.
 */
export async function sincronizarAgendamento(
  tenantId: string,
  attendanceId: string,
): Promise<void> {
  try {
    const supabase = await createClient();

    const { data: atendimento } = await supabase
      .from('attendances')
      .select('appointment_id, stage_code, finished_at, cancelled_at, absent_at')
      .eq('id', attendanceId)
      .eq('tenant_id', tenantId)
      .maybeSingle<{
        appointment_id: string | null;
        stage_code: string;
        finished_at: string | null;
        cancelled_at: string | null;
        absent_at: string | null;
      }>();

    if (!atendimento?.appointment_id) return;

    await supabase
      .from('appointments')
      .update({ status: statusDoAtendimento(atendimento) })
      .eq('id', atendimento.appointment_id)
      .eq('tenant_id', tenantId);
  } catch (error) {
    console.error('[agenda] falha ao sincronizar o agendamento:', error);
  }
}
