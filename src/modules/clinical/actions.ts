'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit, auditClinicalAccess } from '@/lib/audit';
import { liberarSala } from '@/modules/queue/consultorio-actions';
import { consultationSchema, triageSchema } from '@/lib/validators';
import { lerBlocos } from './ficha-estrutura';
import { gerarAso } from '@/modules/documents/aso';
import { lancarRepasse } from '@/modules/finance/repasse-actions';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { sincronizarAgendamento } from '@/modules/queue/sync-appointment';

function num(value: FormDataEntryValue | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Para onde o paciente vai quando a triagem e finalizada.
 *
 * O banco tem um gatilho que faz isto, e ele continua valendo. Aqui a
 * mesma decisao e tomada pela aplicacao, de proposito: em 21/09 a clinica
 * passou a manha com pacientes que nao saiam da triagem por mais que
 * clicassem em finalizar. Depender de uma unica engrenagem para uma coisa
 * que trava o atendimento inteiro nao se justifica.
 *
 * A regra e a mesma dos exames: fila se ha exame de sala por fazer, medico
 * se ha consulta marcada, pagamento se nao ha nem um nem outro.
 */
async function encaminharDepoisDaTriagem(
  ctx: { tenant: { id: string }; userId: string },
  attendanceId: string,
): Promise<string | null> {
  const supabase = await createClient();

  const { data: exames } = await supabase
    .from('patient_exams')
    .select('status, exam_types(code, ocupa_sala)')
    .eq('tenant_id', ctx.tenant.id)
    .eq('attendance_id', attendanceId)
    .returns<{ status: string; exam_types: { code: string; ocupa_sala: boolean } | null }[]>();

  const ativos = ['pendente', 'em_fila', 'chamado', 'em_andamento'];
  const pendentes = (exames ?? []).filter((e) => ativos.includes(e.status));
  const naFila = pendentes.some((e) => e.exam_types?.ocupa_sala !== false);
  const temConsulta = pendentes.some((e) => e.exam_types?.code === 'CLINICO');

  const etapa = naFila
    ? 'aguardando_exames'
    : temConsulta
      ? 'aguardando_medico'
      : 'aguardando_pagamento';

  const { error } = await supabase
    .from('attendances')
    .update({
      stage_code: etapa,
      triage_finished_at: new Date().toISOString(),
      in_service: false,
      current_room_id: null,
      updated_by: ctx.userId,
    })
    .eq('id', attendanceId)
    .eq('tenant_id', ctx.tenant.id);
  if (error) return toFriendlyError(error);

  // A sala de triagem tem de voltar a ficar livre, senao a proxima chamada
  // encontra a sala ocupada por quem ja saiu.
  await supabase
    .from('rooms')
    .update({ status: 'disponivel', current_attendance_id: null })
    .eq('tenant_id', ctx.tenant.id)
    .eq('current_attendance_id', attendanceId);

  return null;
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
      acuidade_od: formData.get('acuidade_od') ?? '',
      acuidade_oe: formData.get('acuidade_oe') ?? '',
      diabetes: formData.get('diabetes') === 'sim',
      hipertenso: formData.get('hipertenso') === 'sim',
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

    const agora = new Date().toISOString();

    // `finished_at` so e escrito quando se finaliza. Antes ele era zerado a
    // cada gravacao simples, e salvar uma correcao depois de concluir
    // desfazia a conclusao sem avisar ninguem.
    const payload = {
      ...parsed.data,
      tenant_id: ctx.tenant.id,
      patient_id: attendance.patient_id,
      professional_id: ctx.userId,
      updated_by: ctx.userId,
      ...(finish ? { finished_at: agora } : {}),
    };

    const { error } = existing
      ? await supabase.from('triages').update(payload).eq('id', existing.id)
      : await supabase
          .from('triages')
          .insert({ ...payload, created_by: ctx.userId, finished_at: finish ? agora : null });

    if (error) return fail(toFriendlyError(error));

    if (finish) {
      const erroEtapa = await encaminharDepoisDaTriagem(ctx, parsed.data.attendance_id);
      if (erroEtapa) return fail(erroEtapa);
    }

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
      .select('id, patient_id, current_room_id')
      .eq('id', parsed.data.attendance_id)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string; current_room_id: string | null }>();
    if (!attendance) return fail('Atendimento não encontrado.');

    // A sala e lida agora, antes de qualquer gravacao. O gatilho
    // tg_consultation_progress sobrescreve attendances.current_room_id com o
    // room_id da consulta ao gravar, e limpa de vez ao finalizar: lendo
    // depois, a sala ficaria "ocupada" para sempre e o botao de chamar o
    // proximo nunca voltaria naquele consultorio.
    const salaDaConsulta = attendance.current_room_id;

    if (finish && !parsed.data.verdict) {
      return fail('Informe a conclusão de aptidão antes de finalizar.');
    }

    const { data: existing } = await supabase
      .from('medical_consultations')
      .select('id')
      .eq('attendance_id', parsed.data.attendance_id)
      .maybeSingle<{ id: string }>();

    // Blocos de selecao da ficha clinica, remontados em jsonb.
    const blocos = lerBlocos(formData);

    const agoraConsulta = new Date().toISOString();

    // `finished_at` e `signed_at` so sao escritos ao finalizar. Antes eram
    // zerados a cada gravacao: o medico que assinasse a consulta e depois
    // corrigisse uma observacao desfazia a propria assinatura, e o paciente
    // voltava a ficar parado em "aguardando documentos".
    const payload = {
      ...parsed.data,
      ...blocos,
      alteracoes_exame_fisico: (formData.get('alteracoes_exame_fisico') as string) || null,
      tenant_id: ctx.tenant.id,
      patient_id: attendance.patient_id,
      doctor_id: ctx.userId,
      room_id: salaDaConsulta,
      updated_by: ctx.userId,
      ...(finish ? { finished_at: agoraConsulta, signed_at: agoraConsulta } : {}),
    };

    const { error } = existing
      ? await supabase.from('medical_consultations').update(payload).eq('id', existing.id)
      : await supabase.from('medical_consultations').insert({
          ...payload,
          created_by: ctx.userId,
          finished_at: finish ? agoraConsulta : null,
          signed_at: finish ? agoraConsulta : null,
        });

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

      // Sem isso o consultorio seguia "ocupado" pelo paciente que ja saiu, e
      // o botao de chamar o proximo nunca voltava.
      if (salaDaConsulta) {
        await liberarSala(salaDaConsulta, ctx.tenant.id);
      }
    }

    // Ao finalizar, o A.S.O. sai sozinho: e o documento que a empresa espera.
    let avisoAso = '';
    if (finish) {
      const aso = await gerarAso(
        ctx,
        parsed.data.attendance_id,
        (formData.get('signatario_id') as string) || null,
      );
      avisoAso = aso.ok ? ' O A.S.O. foi gerado.' : ` (${aso.error})`;

      // O repasse do medico nasce do atendimento, nao de digitacao no financeiro.
      await lancarRepasse(
        ctx,
        parsed.data.attendance_id,
        (formData.get('procedure_code') as string) || null,
      );
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
      finish
        ? `Consulta finalizada.${avisoAso} O paciente seguiu para o pagamento.`
        : 'Consulta salva.',
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Registra resultado de um exame executado.
 *
 * `concluir` existe por causa da bancada da triagem. Nas salas do quadro de
 * Filas, concluir e um botao proprio: o exame foi chamado, esta em
 * andamento, e alguem decide quando terminou. Na bancada nao ha chamada nem
 * botao de concluir — acuidade, visao de cores, Romberg e fadiga sao
 * preenchidos ali e acabou.
 *
 * Ate 21/09 salvar a ficha da bancada nao mexia no status do exame. Ele
 * ficava 'pendente' para sempre, e desde 15/09 — quando as salas de triagem
 * sairam do quadro de Filas — nao havia sala nenhuma que pudesse chama-lo.
 * O paciente ficava parado com "exames 0/15" e nao ia para lugar nenhum.
 */
export async function saveExamResult(
  patientExamId: string,
  values: Record<string, string>,
  conclusion: string,
  isAltered: boolean,
  concluir = false,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('exames.preencher');
    const supabase = await createClient();

    const { data: exam } = await supabase
      .from('patient_exams')
      .select('id, patient_id, status, started_at')
      .eq('id', patientExamId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        patient_id: string;
        status: string;
        started_at: string | null;
      }>();
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

    if (concluir && !['concluido', 'cancelado', 'nao_realizado'].includes(exam.status)) {
      const agora = new Date().toISOString();
      const { error: erroStatus } = await supabase
        .from('patient_exams')
        .update({
          status: 'concluido',
          started_at: exam.started_at ?? agora,
          finished_at: agora,
          professional_id: ctx.userId,
          updated_by: ctx.userId,
        })
        .eq('id', patientExamId)
        .eq('tenant_id', ctx.tenant.id);
      if (erroStatus) return fail(toFriendlyError(erroStatus));
    }

    await audit(ctx, {
      action: existing ? 'update' : 'create',
      entity: 'exam_results',
      entityId: existing?.id,
      patientId: exam.patient_id,
      description: concluir ? 'Exame concluído na bancada' : 'Resultado de exame registrado',
    });

    revalidatePath('/filas');
    revalidatePath('/triagem');
    revalidatePath('/crm');
    return ok(undefined, concluir ? 'Exame concluído.' : 'Resultado registrado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
