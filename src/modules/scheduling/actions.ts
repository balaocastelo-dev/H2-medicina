'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { appointmentSchema } from '@/lib/validators';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { Appointment } from '@/types/entities';

export async function createAppointment(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Appointment>> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const parsed = appointmentSchema.safeParse({
      patient_id: formData.get('patient_id'),
      company_id: formData.get('company_id') || null,
      scheduled_at: formData.get('scheduled_at'),
      duration_minutes: formData.get('duration_minutes') ?? 30,
      attendance_kind: formData.get('attendance_kind') ?? 'admissional',
      priority: formData.get('priority') ?? 'normal',
      professional_id: formData.get('professional_id') || null,
      exam_type_ids: formData.getAll('exam_type_ids').map(String),
      notes: formData.get('notes') ?? '',
    });
    if (!parsed.success) {
      return fail('Verifique os dados do agendamento.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const { exam_type_ids, ...appointment } = parsed.data;

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        ...appointment,
        scheduled_at: new Date(appointment.scheduled_at).toISOString(),
        tenant_id: ctx.tenant.id,
        origin: 'manual',
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('*')
      .single<Appointment>();

    if (error) return fail(toFriendlyError(error));

    if (exam_type_ids.length > 0) {
      await supabase.from('appointment_exams').insert(
        exam_type_ids.map((examId) => ({
          tenant_id: ctx.tenant.id,
          appointment_id: data.id,
          exam_type_id: examId,
          origin: 'manual' as const,
        })),
      );
    }

    await audit(ctx, {
      action: 'create',
      entity: 'appointments',
      entityId: data.id,
      patientId: data.patient_id,
      description: 'Agendamento criado',
      next: data,
    });

    revalidatePath('/agenda');
    return ok(data, 'Agendamento criado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function changeAppointmentStatus(
  id: string,
  status: 'confirmado' | 'cancelado' | 'ausente' | 'agendado',
  reason?: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();
    const patch: Record<string, unknown> = { status, updated_by: ctx.userId };
    if (status === 'confirmado') patch.confirmed_at = new Date().toISOString();
    if (status === 'cancelado') {
      patch.cancelled_at = new Date().toISOString();
      patch.cancel_reason = reason ?? null;
    }

    const { error } = await supabase
      .from('appointments')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: id,
      description: `Status alterado para ${status}`,
      next: patch,
    });
    revalidatePath('/agenda');
    revalidatePath('/agenda/proximo-dia');
    return ok(undefined, 'Status atualizado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function rescheduleAppointment(
  id: string,
  newDateTime: string,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const supabase = await createClient();

    const { data: original } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<Appointment>();
    if (!original) return fail('Agendamento nao encontrado.');

    const { data: created, error } = await supabase
      .from('appointments')
      .insert({
        tenant_id: ctx.tenant.id,
        patient_id: original.patient_id,
        company_id: original.company_id,
        order_id: original.order_id,
        scheduled_at: new Date(newDateTime).toISOString(),
        duration_minutes: original.duration_minutes,
        attendance_kind: original.attendance_kind,
        priority: original.priority,
        professional_id: original.professional_id,
        origin: original.origin,
        rescheduled_from: original.id,
        notes: original.notes,
        created_by: ctx.userId,
      })
      .select('id')
      .single<{ id: string }>();
    if (error) return fail(toFriendlyError(error));

    await supabase
      .from('appointment_exams')
      .select('exam_type_id')
      .eq('appointment_id', id)
      .returns<{ exam_type_id: string }[]>()
      .then(async ({ data }) => {
        if (data?.length) {
          await supabase.from('appointment_exams').insert(
            data.map((e) => ({
              tenant_id: ctx.tenant.id,
              appointment_id: created.id,
              exam_type_id: e.exam_type_id,
              origin: 'manual' as const,
            })),
          );
        }
      });

    await supabase
      .from('appointments')
      .update({ status: 'remarcado', updated_by: ctx.userId })
      .eq('id', id);

    await audit(ctx, {
      action: 'update',
      entity: 'appointments',
      entityId: id,
      description: `Remarcado para ${newDateTime}`,
    });
    revalidatePath('/agenda');
    return ok(undefined, 'Agendamento remarcado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
