'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit, auditClinicalAccess } from '@/lib/audit';
import { consultationSchema, triageSchema } from '@/lib/validators';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { sincronizarAgendamento } from '@/modules/queue/sync-appointment';

function num(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Cria ou atualiza a triagem do atendimento. */
export async function saveTriage(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('triagem.preencher');
    const parsed = triageSchema.safeParse({
      attendance_id: formData.get('attendance_id'),
      blood_pressure_systolic: num(formData.get('blood_pressure_systolic')),
      blood_pressure_diastolic: num(formData.get('blood_pressure_diastolic')),
      temperature_c: num(formData.get('temperature_c')),
      weight_kg: num(formData.get('weight_kg')),
      height_cm: num(formData.get('height_cm')),
      heart_rate: num(formData.get('heart_rate')),
      respiratory_rate: num(formData.get('respiratory_rate')),
      oxygen_saturation: num(formData.get('oxygen_saturation')),
      symptoms: formData.get('symptoms') ?? '',
      alerts: formData.get('alerts') ?? '',
      restrictions: formData.get('restrictions') ?? '',
      observations: formData.get('observations') ?? '',
    });
    if (!parsed.success) {
      return fail('Verifique os valores informados.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const finish = formData.get('finalizar') === 'sim';

    const { data: attendance } = await supabase
      .from('attendances')
      .select('id, patient_id')
      .eq('id', parsed.data.attendance_id)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string }>();
    if (!attendance) return fail('Atendimento não encontrado.');

    const { data: existing } = await supabase
      .from('triages')
      .select('id')
      .eq('attendance_id', parsed.data.attendance_id)
      .maybeSingle<{ id: string }>();

    const payload = {
      ...parsed.data,
      tenant_id: ctx.tenant.id,
      patient_id: attendance.patient_id,
      professional_id: ctx.userId,
      finished_at: finish ? new Date().toISOString() : null,
      updated_by: ctx.userId,
    };

    const { error } = existing
      ? await supabase.from('triages').update(payload).eq('id', existing.id)
      : await supabase.from('triages').insert({ ...payload, created_by: ctx.userId });

    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: existing ? 'update' : 'create',
      entity: 'triages',
      entityId: existing?.id,
      patientId: attendance.patient_id,
      description: finish ? 'Triagem concluída' : 'Triagem registrada',
    });

    revalidatePath('/triagem');
    revalidatePath('/crm');
    return ok(undefined, finish ? 'Triagem concluída.' : 'Triagem salva.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Cria ou atualiza a consulta medica. */
export async function saveConsultation(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('medico.atender');
    const raw = Object.fromEntries(formData.entries());
    const parsed = consultationSchema.safeParse({
      ...raw,
      verdict: raw.verdict || null,
      valid_until: raw.valid_until || null,
    });
    if (!parsed.success) {
      return fail('Verifique os campos da consulta.', z.flattenError(parsed.error).fieldErrors);
    }

    const supabase = await createClient();
    const finish = formData.get('finalizar') === 'sim';

    const { data: attendance } = await supabase
      .from('attendances')
      .select('id, patient_id')
      .eq('id', parsed.data.attendance_id)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string }>();
    if (!attendance) return fail('Atendimento não encontrado.');

    if (finish && !parsed.data.verdict) {
      return fail('Informe a conclusão de aptidão antes de finalizar.');
    }

    const { data: existing } = await supabase
      .from('medical_consultations')
      .select('id')
      .eq('attendance_id', parsed.data.attendance_id)
      .maybeSingle<{ id: string }>();

    const payload = {
      ...parsed.data,
      tenant_id: ctx.tenant.id,
      patient_id: attendance.patient_id,
      doctor_id: ctx.userId,
      finished_at: finish ? new Date().toISOString() : null,
      signed_at: finish ? new Date().toISOString() : null,
      updated_by: ctx.userId,
    };

    const { error } = existing
      ? await supabase.from('medical_consultations').update(payload).eq('id', existing.id)
      : await supabase.from('medical_consultations').insert({ ...payload, created_by: ctx.userId });

    if (error) return fail(toFriendlyError(error));

    // O gatilho do banco so avanca a etapa no UPDATE. Quando a consulta e
    // criada e finalizada no mesmo salvamento, roda apenas o gatilho de
    // INSERT — que marca 'em consulta' — e o paciente ficava travado ali.
    // Por isso a etapa e definida aqui, explicitamente.
    if (finish) {
      await supabase
        .from('attendances')
        .update({
          stage_code: 'aguardando_pagamento',
          consultation_finished_at: new Date().toISOString(),
          in_service: false,
          current_room_id: null,
          updated_by: ctx.userId,
        })
        .eq('id', parsed.data.attendance_id)
        .eq('tenant_id', ctx.tenant.id);
    }

    await sincronizarAgendamento(ctx.tenant.id, parsed.data.attendance_id);

    await auditClinicalAccess(ctx, attendance.patient_id, 'consulta', existing?.id);
    await audit(ctx, {
      action: existing ? 'update' : 'create',
      entity: 'medical_consultations',
      entityId: existing?.id,
      patientId: attendance.patient_id,
      description: finish
        ? `Consulta finalizada (${parsed.data.verdict})`
        : 'Consulta em andamento',
    });

    revalidatePath('/medico');
    revalidatePath('/pagamentos');
    revalidatePath('/crm');
    return ok(
      undefined,
      finish ? 'Consulta finalizada. O paciente seguiu para o pagamento.' : 'Consulta salva.',
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Registra resultado de um exame executado. */
export async function saveExamResult(
  patientExamId: string,
  values: Record<string, string>,
  conclusion: string,
  isAltered: boolean,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('exames.preencher');
    const supabase = await createClient();

    const { data: exam } = await supabase
      .from('patient_exams')
      .select('id, patient_id')
      .eq('id', patientExamId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string }>();
    if (!exam) return fail('Exame não encontrado.');

    const { data: existing } = await supabase
      .from('exam_results')
      .select('id')
      .eq('patient_exam_id', patientExamId)
      .maybeSingle<{ id: string }>();

    const payload = {
      tenant_id: ctx.tenant.id,
      patient_exam_id: patientExamId,
      patient_id: exam.patient_id,
      professional_id: ctx.userId,
      values,
      conclusion,
      is_altered: isAltered,
      updated_by: ctx.userId,
    };

    const { error } = existing
      ? await supabase.from('exam_results').update(payload).eq('id', existing.id)
      : await supabase.from('exam_results').insert({ ...payload, created_by: ctx.userId });

    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: existing ? 'update' : 'create',
      entity: 'exam_results',
      entityId: existing?.id,
      patientId: exam.patient_id,
      description: 'Resultado de exame registrado',
    });

    revalidatePath('/filas');
    return ok(undefined, 'Resultado registrado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
