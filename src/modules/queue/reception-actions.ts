'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/** Inicia o atendimento na recepcao. */
export async function startReception(attendanceId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('recepcao.operar');
    const supabase = await createClient();
    const { error } = await supabase
      .from('attendances')
      .update({
        stage_code: 'na_recepcao',
        reception_started_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: attendanceId,
      description: 'Atendimento iniciado na recepção',
    });
    revalidatePath('/recepcao');
    return ok(undefined, 'Atendimento iniciado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Conclui a recepcao: encaminha para triagem ou direto para as filas de exame.
 * Tambem confirma os exames selecionados e a prioridade.
 */
export async function finishReception(input: {
  attendanceId: string;
  needsTriage: boolean;
  priority: 'normal' | 'prioritario' | 'encaixe';
  examTypeIds: string[];
  notes?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('recepcao.operar');
    const supabase = await createClient();

    const { data: attendance } = await supabase
      .from('attendances')
      .select('id, patient_id, appointment_id')
      .eq('id', input.attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string; appointment_id: string | null }>();
    if (!attendance) return fail('Atendimento não encontrado.');

    // Sincroniza a lista de exames com o que foi confirmado na recepcao
    const { data: existing } = await supabase
      .from('patient_exams')
      .select('id, exam_type_id, status')
      .eq('attendance_id', input.attendanceId)
      .returns<{ id: string; exam_type_id: string; status: string }[]>();

    const existingIds = new Set((existing ?? []).map((e) => e.exam_type_id));
    const toAdd = input.examTypeIds.filter((id) => !existingIds.has(id));
    const toRemove = (existing ?? []).filter(
      (e) => !input.examTypeIds.includes(e.exam_type_id) && e.status === 'pendente',
    );

    if (toAdd.length > 0) {
      const { data: types } = await supabase
        .from('exam_types')
        .select('id, default_room_id, sort_order')
        .in('id', toAdd)
        .returns<{ id: string; default_room_id: string | null; sort_order: number }[]>();

      await supabase.from('patient_exams').insert(
        (types ?? []).map((t) => ({
          tenant_id: ctx.tenant.id,
          attendance_id: input.attendanceId,
          patient_id: attendance.patient_id,
          appointment_id: attendance.appointment_id,
          exam_type_id: t.id,
          room_id: t.default_room_id,
          sort_order: t.sort_order,
          priority: input.priority,
          status: 'pendente' as const,
          created_by: ctx.userId,
        })),
      );
    }

    if (toRemove.length > 0) {
      await supabase
        .from('patient_exams')
        .delete()
        .in(
          'id',
          toRemove.map((e) => e.id),
        );
    }

    await supabase
      .from('patient_exams')
      .update({ priority: input.priority, queued_at: new Date().toISOString() })
      .eq('attendance_id', input.attendanceId)
      .eq('status', 'pendente');

    const { error } = await supabase
      .from('attendances')
      .update({
        stage_code: input.needsTriage ? 'aguardando_triagem' : 'aguardando_exames',
        needs_triage: input.needsTriage,
        priority: input.priority,
        reception_finished_at: new Date().toISOString(),
        notes: input.notes ?? null,
        updated_by: ctx.userId,
      })
      .eq('id', input.attendanceId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'attendances',
      entityId: input.attendanceId,
      patientId: attendance.patient_id,
      description: input.needsTriage ? 'Encaminhado para triagem' : 'Encaminhado para exames',
    });

    revalidatePath('/recepcao');
    revalidatePath('/crm');
    revalidatePath('/filas');
    return ok(undefined, 'Recepção concluída.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
