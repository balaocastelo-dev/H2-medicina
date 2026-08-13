'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { cpfSchema } from '@/lib/validators';
import { onlyDigits } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/**
 * Agendamento avulso de exames para funcionario de empresa contratante.
 *
 * O caso de uso e o balcao e o telefone: o RH liga pedindo exame para
 * alguem que pode nem estar cadastrado. Ate aqui isso exigia duas telas —
 * cadastrar o paciente, depois voltar e agendar. Aqui e um passo so.
 */

const funcionarioSchema = z.object({
  patient_id: z.string().uuid().nullable().optional(),
  full_name: z.string().trim().min(3, 'Informe o nome completo'),
  cpf: cpfSchema.optional().nullable(),
  birth_date: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  phone: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  job_title: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  department: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  registration_number: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
});

const agendamentoAvulsoSchema = z.object({
  company_id: z.string().uuid('Selecione a empresa'),
  scheduled_at: z.string().min(1, 'Informe data e hora'),
  attendance_kind: z.string().default('admissional'),
  priority: z.enum(['normal', 'prioritario', 'encaixe']).default('normal'),
  exam_type_ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos um exame ou consulta'),
  notes: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  funcionarios: z.array(funcionarioSchema).min(1, 'Inclua ao menos um funcionário'),
});

export interface ResultadoAvulso {
  criados: { nome: string; appointmentId: string }[];
  ignorados: { nome: string; motivo: string }[];
}

/**
 * Cria (ou reaproveita) o paciente e agenda os exames.
 *
 * Aceita varios funcionarios de uma vez porque o pedido do RH costuma vir
 * em lote — cinco admissoes no mesmo dia e um caso comum.
 */
export async function agendarExamesAvulso(input: {
  company_id: string;
  scheduled_at: string;
  attendance_kind?: string;
  priority?: 'normal' | 'prioritario' | 'encaixe';
  exam_type_ids: string[];
  notes?: string | null;
  funcionarios: {
    patient_id?: string | null;
    full_name: string;
    cpf?: string | null;
    birth_date?: string | null;
    phone?: string | null;
    job_title?: string | null;
    department?: string | null;
    registration_number?: string | null;
  }[];
}): Promise<ActionResult<ResultadoAvulso>> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const parsed = agendamentoAvulsoSchema.safeParse(input);
    if (!parsed.success) {
      const primeiro = z.flattenError(parsed.error);
      const mensagem =
        Object.values(primeiro.fieldErrors).flat()[0] ??
        primeiro.formErrors[0] ??
        'Verifique os dados do agendamento.';
      return fail(mensagem, primeiro.fieldErrors as Record<string, string[]>);
    }

    const dados = parsed.data;
    const supabase = await createClient();
    const quando = new Date(dados.scheduled_at);
    if (Number.isNaN(quando.getTime())) return fail('Data e hora inválidas.');

    const criados: ResultadoAvulso['criados'] = [];
    const ignorados: ResultadoAvulso['ignorados'] = [];

    for (const funcionario of dados.funcionarios) {
      let patientId = funcionario.patient_id ?? null;

      // Sem id, tenta achar pelo CPF antes de criar: o mesmo funcionario
      // cadastrado duas vezes vira dois prontuarios e um problema.
      if (!patientId && funcionario.cpf) {
        const { data: existente } = await supabase
          .from('patients')
          .select('id')
          .eq('tenant_id', ctx.tenant.id)
          .eq('cpf', onlyDigits(funcionario.cpf))
          .is('deleted_at', null)
          .maybeSingle<{ id: string }>();
        patientId = existente?.id ?? null;
      }

      if (patientId) {
        // Vinculo e cargo podem ter mudado desde a ultima vinda.
        await supabase
          .from('patients')
          .update({
            company_id: dados.company_id,
            job_title: funcionario.job_title,
            department: funcionario.department,
            registration_number: funcionario.registration_number,
            default_origin_kind: 'particular',
            updated_by: ctx.userId,
          })
          .eq('id', patientId)
          .eq('tenant_id', ctx.tenant.id);
      } else {
        const { data: novo, error: erroPaciente } = await supabase
          .from('patients')
          .insert({
            tenant_id: ctx.tenant.id,
            full_name: funcionario.full_name,
            cpf: funcionario.cpf ? onlyDigits(funcionario.cpf) : null,
            birth_date: funcionario.birth_date,
            phone: funcionario.phone,
            company_id: dados.company_id,
            job_title: funcionario.job_title,
            department: funcionario.department,
            registration_number: funcionario.registration_number,
            default_origin_kind: 'particular',
            origin: 'manual',
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .select('id')
          .single<{ id: string }>();

        if (erroPaciente || !novo) {
          ignorados.push({
            nome: funcionario.full_name,
            motivo: toFriendlyError(erroPaciente),
          });
          continue;
        }
        patientId = novo.id;

        await supabase.from('patient_employments').insert({
          tenant_id: ctx.tenant.id,
          patient_id: patientId,
          company_id: dados.company_id,
          job_title: funcionario.job_title,
          department: funcionario.department,
          registration_number: funcionario.registration_number,
          is_current: true,
          origin: 'manual',
          created_by: ctx.userId,
        });
      }

      const { data: agendamento, error: erroAgenda } = await supabase
        .from('appointments')
        .insert({
          tenant_id: ctx.tenant.id,
          patient_id: patientId,
          company_id: dados.company_id,
          scheduled_at: quando.toISOString(),
          attendance_kind: dados.attendance_kind,
          priority: dados.priority,
          origin_kind: 'particular',
          origin: 'manual',
          notes: dados.notes,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .select('id')
        .single<{ id: string }>();

      if (erroAgenda || !agendamento) {
        ignorados.push({ nome: funcionario.full_name, motivo: toFriendlyError(erroAgenda) });
        continue;
      }

      await supabase.from('appointment_exams').insert(
        dados.exam_type_ids.map((examId) => ({
          tenant_id: ctx.tenant.id,
          appointment_id: agendamento.id,
          exam_type_id: examId,
          origin: 'manual' as const,
        })),
      );

      await audit(ctx, {
        action: 'create',
        entity: 'appointments',
        entityId: agendamento.id,
        patientId,
        description: `Agendamento avulso (empresa) com ${dados.exam_type_ids.length} exame(s)`,
      });

      criados.push({ nome: funcionario.full_name, appointmentId: agendamento.id });
    }

    if (criados.length === 0) {
      return fail(
        `Nenhum agendamento criado. ${ignorados.map((i) => `${i.nome}: ${i.motivo}`).join('; ')}`,
      );
    }

    revalidatePath('/agenda');
    revalidatePath('/pacientes');

    return ok(
      { criados, ignorados },
      ignorados.length === 0
        ? `${criados.length} agendamento(s) criado(s).`
        : `${criados.length} criado(s). Não foi possível agendar: ${ignorados
            .map((i) => `${i.nome} (${i.motivo})`)
            .join('; ')}.`,
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Funcionarios ja cadastrados de uma empresa, para o seletor da tela. */
export async function funcionariosDaEmpresa(companyId: string): Promise<
  ActionResult<{ id: string; full_name: string; cpf: string | null; job_title: string | null }[]>
> {
  try {
    const ctx = await assertPermission('pacientes.ver');
    const supabase = await createClient();

    const { data } = await supabase
      .from('patients')
      .select('id, full_name, cpf, job_title')
      .eq('tenant_id', ctx.tenant.id)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('full_name')
      .limit(500)
      .returns<{ id: string; full_name: string; cpf: string | null; job_title: string | null }[]>();

    return ok(data ?? []);
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
