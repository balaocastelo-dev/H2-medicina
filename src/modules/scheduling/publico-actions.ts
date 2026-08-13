'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { cpfSchema } from '@/lib/validators';
import { onlyDigits } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import {
  diasDisponiveis,
  gerarCodigo,
  horarioEhValido,
  instanteDe,
  lerConfiguracao,
  somarDias,
  diaEmSaoPaulo,
  type DiaDisponivel,
} from './grade-publica';

/**
 * Agendamento pela pagina publica, sem login.
 *
 * Tudo aqui roda com o cliente administrativo, que ignora RLS — entao
 * cada acao valida sozinha o que pode fazer. A regra e nao confiar em
 * nada que veio do navegador: horario, exames e limites sao conferidos de
 * novo no servidor antes de gravar.
 */

interface Unidade {
  id: string;
  legal_name: string;
  trade_name: string;
}

async function unidadePadrao(): Promise<Unidade | null> {
  const anon = await createClient();
  const { data } = await anon
    .from('tenants')
    .select('id, legal_name, trade_name')
    .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
    .maybeSingle<Unidade>();
  return data ?? null;
}

export interface OpcoesPublicas {
  unidade: string;
  ativo: boolean;
  exames: { id: string; nome: string; minutos: number }[];
  dias: DiaDisponivel[];
}

/**
 * Exames oferecidos e a agenda realmente livre.
 *
 * So aparecem exames marcados como disponiveis online — a clinica decide
 * o que quer receber pelo site em Configuracoes, e nao tudo que existe no
 * catalogo.
 */
export async function opcoesPublicas(): Promise<ActionResult<OpcoesPublicas>> {
  try {
    const unidade = await unidadePadrao();
    if (!unidade) return fail('Unidade não configurada.');

    const admin = createAdminClient();

    const { data: bruto } = await admin
      .from('tenant_settings')
      .select('settings')
      .eq('tenant_id', unidade.id)
      .eq('group_key', 'agendamento_online')
      .maybeSingle<{ settings: unknown }>();

    const config = lerConfiguracao(bruto?.settings);

    if (!config.ativo) {
      return ok({ unidade: unidade.trade_name, ativo: false, exames: [], dias: [] });
    }

    const hoje = diaEmSaoPaulo(new Date());
    const limite = somarDias(hoje, config.janelaDeDias + config.diasDeAntecedencia + 1);

    const [examesRes, agendaRes] = await Promise.all([
      admin
        .from('exam_types')
        .select('id, name, average_minutes')
        .eq('tenant_id', unidade.id)
        .eq('is_active', true)
        .eq('available_online', true)
        .is('deleted_at', null)
        .order('sort_order')
        .returns<{ id: string; name: string; average_minutes: number }[]>(),
      // Só os instantes ocupados. Nenhum dado de paciente sai daqui: esta
      // resposta vai para uma página aberta na internet.
      admin
        .from('appointments')
        .select('scheduled_at')
        .eq('tenant_id', unidade.id)
        .gte('scheduled_date', hoje)
        .lte('scheduled_date', limite)
        .not('status', 'in', '("cancelado","remarcado","ausente")')
        .is('deleted_at', null)
        .is('rejected_at', null)
        .returns<{ scheduled_at: string }[]>(),
    ]);

    return ok({
      unidade: unidade.trade_name,
      ativo: true,
      exames: (examesRes.data ?? []).map((e) => ({
        id: e.id,
        nome: e.name,
        minutos: e.average_minutes,
      })),
      dias: diasDisponiveis({
        config,
        ocupados: (agendaRes.data ?? []).map((a) => a.scheduled_at),
      }),
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

const pedidoSchema = z.object({
  nome: z.string().trim().min(5, 'Informe seu nome completo'),
  cpf: cpfSchema,
  nascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de nascimento')
    .refine((v) => v <= new Date().toISOString().slice(0, 10), 'Data de nascimento inválida'),
  telefone: z.string().trim().min(10, 'Informe um telefone com DDD'),
  email: z
    .string()
    .trim()
    .email('E-mail inválido')
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null),
  empresa: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Escolha uma data'),
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'Escolha um horário'),
  examTypeIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um exame'),
  observacao: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

export type PedidoPublico = z.input<typeof pedidoSchema>;

export interface ReservaCriada {
  codigo: string;
  quando: string;
  nome: string;
  unidade: string;
}

/**
 * Cria a reserva pedida pelo site.
 *
 * Nasce como pedido a confirmar: `requested_online` marcado e sem
 * `confirmed_at`. A recepcao decide, e so entao vira agendamento firme.
 */
export async function reservarPeloSite(
  input: PedidoPublico,
): Promise<ActionResult<ReservaCriada>> {
  try {
    const parsed = pedidoSchema.safeParse(input);
    if (!parsed.success) {
      const achatado = z.flattenError(parsed.error);
      return fail(
        Object.values(achatado.fieldErrors).flat()[0] ?? 'Confira os dados informados.',
        achatado.fieldErrors as Record<string, string[]>,
      );
    }
    const dados = parsed.data;

    const unidade = await unidadePadrao();
    if (!unidade) return fail('Unidade não configurada.');

    const admin = createAdminClient();
    const cpf = onlyDigits(dados.cpf);

    const { data: bruto } = await admin
      .from('tenant_settings')
      .select('settings')
      .eq('tenant_id', unidade.id)
      .eq('group_key', 'agendamento_online')
      .maybeSingle<{ settings: unknown }>();
    const config = lerConfiguracao(bruto?.settings);

    const { data: ocupados } = await admin
      .from('appointments')
      .select('scheduled_at')
      .eq('tenant_id', unidade.id)
      .eq('scheduled_date', dados.data)
      .not('status', 'in', '("cancelado","remarcado","ausente")')
      .is('deleted_at', null)
      .is('rejected_at', null)
      .returns<{ scheduled_at: string }[]>();

    // A tela mostrou horários livres há alguns minutos; entre a escolha e
    // o envio a agenda pode ter mudado.
    const valido = horarioEhValido({
      config,
      data: dados.data,
      hora: dados.hora,
      ocupados: (ocupados ?? []).map((a) => a.scheduled_at),
    });
    if (!valido.ok) return fail(valido.motivo);

    const quando = instanteDe(dados.data, dados.hora);
    if (Number.isNaN(quando.getTime())) return fail('Data ou horário inválidos.');

    // Trava contra enxurrada de pedidos com o mesmo CPF.
    const { count: pedidosAbertos } = await admin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', unidade.id)
      .eq('requested_online', true)
      .is('confirmed_at', null)
      .is('rejected_at', null)
      .is('deleted_at', null)
      .eq('requester_phone', dados.telefone);

    if ((pedidosAbertos ?? 0) >= 3) {
      return fail(
        'Já existem pedidos aguardando confirmação para este contato. Aguarde o retorno da clínica.',
      );
    }

    // Reaproveita o cadastro quando o CPF já é conhecido: o mesmo
    // funcionário volta todo ano e não pode virar dois prontuários.
    const { data: existente } = await admin
      .from('patients')
      .select('id, full_name')
      .eq('tenant_id', unidade.id)
      .eq('cpf', cpf)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; full_name: string }>();

    let patientId = existente?.id ?? null;

    if (!patientId) {
      const { data: novo, error } = await admin
        .from('patients')
        .insert({
          tenant_id: unidade.id,
          full_name: dados.nome,
          cpf,
          birth_date: dados.nascimento,
          phone: dados.telefone,
          email: dados.email,
          default_origin_kind: 'particular',
          origin: 'api',
          needs_review: true,
          review_reason: 'Cadastro feito pelo próprio paciente no site',
          notes: dados.empresa ? `Empresa informada no site: ${dados.empresa}` : null,
        })
        .select('id')
        .single<{ id: string }>();
      if (error || !novo) return fail(toFriendlyError(error));
      patientId = novo.id;
    } else {
      await admin
        .from('patients')
        .update({ phone: dados.telefone, email: dados.email ?? undefined })
        .eq('id', patientId);
    }

    const { data: tipos } = await admin
      .from('exam_types')
      .select('id, average_minutes')
      .eq('tenant_id', unidade.id)
      .eq('available_online', true)
      .eq('is_active', true)
      .in('id', dados.examTypeIds)
      .returns<{ id: string; average_minutes: number }[]>();

    if (!tipos || tipos.length === 0) {
      return fail('Os exames escolhidos não estão disponíveis para agendamento pelo site.');
    }

    const cabecalhos = await headers();
    const ip = cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const codigo = gerarCodigo();

    const { data: criado, error: erroAgenda } = await admin
      .from('appointments')
      .insert({
        tenant_id: unidade.id,
        patient_id: patientId,
        scheduled_at: quando.toISOString(),
        duration_minutes: tipos.reduce((s, t) => s + t.average_minutes, 0) || 30,
        attendance_kind: 'consulta',
        priority: 'normal',
        status: 'agendado',
        origin_kind: 'particular',
        origin: 'api',
        public_code: codigo,
        requested_online: true,
        requester_name: dados.nome,
        requester_phone: dados.telefone,
        requester_email: dados.email,
        requester_ip: ip,
        requested_at: new Date().toISOString(),
        notes: [
          'Pedido feito pelo site, aguardando confirmação.',
          dados.empresa ? `Empresa: ${dados.empresa}` : null,
          dados.observacao,
        ]
          .filter(Boolean)
          .join(' · '),
      })
      .select('id, scheduled_at')
      .single<{ id: string; scheduled_at: string }>();

    if (erroAgenda || !criado) {
      // O índice único é a última linha de defesa contra dois cliques
      // simultâneos no mesmo horário.
      const mensagem = String(erroAgenda?.message ?? '');
      if (mensagem.includes('uq_appointments_reserva_online')) {
        return fail('Este horário acabou de ser preenchido. Escolha outro.');
      }
      if (mensagem.includes('uq_appointments_patient_day')) {
        return fail('Já existe um agendamento para este CPF nesta data.');
      }
      return fail(toFriendlyError(erroAgenda));
    }

    await admin.from('appointment_exams').insert(
      tipos.map((t) => ({
        tenant_id: unidade.id,
        appointment_id: criado.id,
        exam_type_id: t.id,
        origin: 'api' as const,
      })),
    );

    revalidatePath('/agenda');

    return ok(
      {
        codigo,
        quando: criado.scheduled_at,
        nome: dados.nome,
        unidade: unidade.trade_name,
      },
      'Pedido registrado. Guarde o código do comprovante.',
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export interface ReservaConsultada {
  codigo: string;
  nome: string;
  quando: string;
  situacao: 'a_confirmar' | 'confirmado' | 'recusado' | 'cancelado';
  motivo: string | null;
  exames: string[];
  unidade: string;
}

/**
 * Consulta a reserva pelo codigo do comprovante.
 *
 * O codigo e a unica credencial que a pessoa tem. Por isso a resposta traz
 * so o que ela mesma informou — nada de prontuario, nada de historico.
 */
export async function consultarReserva(
  codigo: string,
): Promise<ActionResult<ReservaConsultada>> {
  try {
    const limpo = codigo.trim().toUpperCase();
    if (limpo.length < 8) return fail('Informe o código completo do comprovante.');

    const unidade = await unidadePadrao();
    if (!unidade) return fail('Unidade não configurada.');

    const admin = createAdminClient();
    const { data } = await admin
      .from('appointments')
      .select(
        'public_code, requester_name, scheduled_at, confirmed_at, rejected_at, reject_reason, cancelled_at, status, appointment_exams(exam_types(name))',
      )
      .eq('tenant_id', unidade.id)
      .eq('public_code', limpo)
      .is('deleted_at', null)
      .maybeSingle<{
        public_code: string;
        requester_name: string | null;
        scheduled_at: string;
        confirmed_at: string | null;
        rejected_at: string | null;
        reject_reason: string | null;
        cancelled_at: string | null;
        status: string;
        appointment_exams: { exam_types: { name: string } | null }[];
      }>();

    if (!data) return fail('Não encontramos nenhum agendamento com este código.');

    const situacao: ReservaConsultada['situacao'] = data.rejected_at
      ? 'recusado'
      : data.cancelled_at || data.status === 'cancelado'
        ? 'cancelado'
        : data.confirmed_at
          ? 'confirmado'
          : 'a_confirmar';

    return ok({
      codigo: data.public_code,
      nome: data.requester_name ?? 'Paciente',
      quando: data.scheduled_at,
      situacao,
      motivo: data.reject_reason,
      exames: (data.appointment_exams ?? [])
        .map((e) => e.exam_types?.name)
        .filter((n): n is string => Boolean(n)),
      unidade: unidade.trade_name,
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
