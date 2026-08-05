'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { onlyDigits, todayISO } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/**
 * Portal do paciente (PWA).
 *
 * Autenticacao de baixo atrito: CPF + data de nascimento, os dois precisam
 * bater. Toda consulta e feita no servidor e sempre restrita ao paciente
 * identificado — nenhum dado de terceiros trafega.
 */

export interface ExameDoPaciente {
  nome: string;
  status: string;
  concluidoEm: string | null;
  conclusao: string | null;
}

export interface ReciboDoPaciente {
  id: string;
  descricao: string;
  valor: number;
  status: string;
  metodo: string;
  pagoEm: string | null;
  criadoEm: string;
}

export interface DocumentoDoPaciente {
  id: string;
  titulo: string;
  tipo: string;
  emitidoEm: string;
  codigoVerificacao: string | null;
}

export interface AgendamentoDoPaciente {
  id: string;
  quando: string;
  tipo: string;
  status: string;
  exames: string[];
}

export interface PortalPaciente {
  pacienteId: string;
  nome: string;
  temAtendimentoAberto: boolean;
  senha: string | null;
  etapa: string;
  sala: string | null;
  chegadaEm: string | null;
  exames: ExameDoPaciente[];
  recibos: ReciboDoPaciente[];
  documentos: DocumentoDoPaciente[];
  agendamentos: AgendamentoDoPaciente[];
}

/** Confere CPF + nascimento e devolve o paciente, ou null. */
async function autenticar(cpfBruto: string, nascimento: string) {
  const cpf = onlyDigits(cpfBruto);
  if (cpf.length !== 11 || !nascimento) return null;

  const anon = await createClient();
  const { data: tenant } = await anon
    .from('tenants')
    .select('id, trade_name')
    .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
    .maybeSingle<{ id: string; trade_name: string }>();
  if (!tenant) return null;

  const admin = createAdminClient();
  const { data: paciente } = await admin
    .from('patients')
    .select('id, full_name, social_name')
    .eq('tenant_id', tenant.id)
    .eq('cpf', cpf)
    .eq('birth_date', nascimento)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; full_name: string; social_name: string | null }>();

  if (!paciente) return null;
  return { tenant, paciente, admin };
}

/** Tudo que o paciente pode ver sobre si mesmo. */
export async function obterPortal(
  cpf: string,
  nascimento: string,
): Promise<ActionResult<PortalPaciente>> {
  try {
    const sessao = await autenticar(cpf, nascimento);
    if (!sessao) return fail('Não localizamos seu cadastro com esses dados.');
    const { tenant, paciente, admin } = sessao;

    const [atendimentoRes, recibosRes, documentosRes, agendamentosRes] = await Promise.all([
      admin
        .from('attendances')
        .select(
          'id, stage_code, checkin_at, finished_at, queue_tickets(code), rooms:current_room_id(name), patient_exams(status, finished_at, exam_types(name), exam_results(conclusion, released_to_patient))',
        )
        .eq('tenant_id', tenant.id)
        .eq('patient_id', paciente.id)
        .is('deleted_at', null)
        .order('checkin_at', { ascending: false })
        .limit(1)
        .maybeSingle<{
          id: string;
          stage_code: string;
          checkin_at: string;
          finished_at: string | null;
          queue_tickets: { code: string }[];
          rooms: { name: string } | null;
          patient_exams: {
            status: string;
            finished_at: string | null;
            exam_types: { name: string } | null;
            exam_results: { conclusion: string | null; released_to_patient: boolean }[];
          }[];
        }>(),
      admin
        .from('payments')
        .select('id, description, net_amount, status, method, paid_at, created_at')
        .eq('tenant_id', tenant.id)
        .eq('patient_id', paciente.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20)
        .returns<
          {
            id: string;
            description: string | null;
            net_amount: number;
            status: string;
            method: string;
            paid_at: string | null;
            created_at: string;
          }[]
        >(),
      admin
        .from('documents')
        .select('id, title, kind, generated_at, verification_code')
        .eq('tenant_id', tenant.id)
        .eq('patient_id', paciente.id)
        .eq('is_patient_visible', true)
        .is('deleted_at', null)
        .order('generated_at', { ascending: false })
        .limit(20)
        .returns<
          {
            id: string;
            title: string;
            kind: string;
            generated_at: string;
            verification_code: string | null;
          }[]
        >(),
      admin
        .from('appointments')
        .select('id, scheduled_at, attendance_kind, status, appointment_exams(exam_types(name))')
        .eq('tenant_id', tenant.id)
        .eq('patient_id', paciente.id)
        .is('deleted_at', null)
        .gte('scheduled_date', todayISO())
        .order('scheduled_at')
        .limit(10)
        .returns<
          {
            id: string;
            scheduled_at: string;
            attendance_kind: string;
            status: string;
            appointment_exams: { exam_types: { name: string } | null }[];
          }[]
        >(),
    ]);

    const atendimento = atendimentoRes.data;
    const aberto = !!atendimento && !atendimento.finished_at;

    return ok({
      pacienteId: paciente.id,
      nome: paciente.social_name ?? paciente.full_name,
      temAtendimentoAberto: aberto,
      senha: atendimento?.queue_tickets?.[0]?.code ?? null,
      etapa: atendimento?.stage_code ?? 'agendado',
      sala: aberto ? (atendimento?.rooms?.name ?? null) : null,
      chegadaEm: atendimento?.checkin_at ?? null,
      exames: (atendimento?.patient_exams ?? []).map((e) => ({
        nome: e.exam_types?.name ?? 'Exame',
        status: e.status,
        concluidoEm: e.finished_at,
        // Conclusao so aparece quando o profissional liberou para o paciente.
        conclusao: e.exam_results?.[0]?.released_to_patient
          ? (e.exam_results[0]?.conclusion ?? null)
          : null,
      })),
      recibos: (recibosRes.data ?? []).map((p) => ({
        id: p.id,
        descricao: p.description ?? 'Atendimento',
        valor: Number(p.net_amount),
        status: p.status,
        metodo: p.method,
        pagoEm: p.paid_at,
        criadoEm: p.created_at,
      })),
      documentos: (documentosRes.data ?? []).map((d) => ({
        id: d.id,
        titulo: d.title,
        tipo: d.kind,
        emitidoEm: d.generated_at,
        codigoVerificacao: d.verification_code,
      })),
      agendamentos: (agendamentosRes.data ?? []).map((a) => ({
        id: a.id,
        quando: a.scheduled_at,
        tipo: a.attendance_kind,
        status: a.status,
        exames: a.appointment_exams
          .map((e) => e.exam_types?.name)
          .filter((n): n is string => !!n),
      })),
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Link temporario para o paciente abrir o proprio documento. */
export async function baixarDocumento(
  cpf: string,
  nascimento: string,
  documentoId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const sessao = await autenticar(cpf, nascimento);
    if (!sessao) return fail('Sessão expirada. Consulte novamente.');
    const { tenant, paciente, admin } = sessao;

    // O documento precisa ser do proprio paciente e estar liberado para ele.
    const { data: doc } = await admin
      .from('documents')
      .select('id, bucket, file_path')
      .eq('id', documentoId)
      .eq('tenant_id', tenant.id)
      .eq('patient_id', paciente.id)
      .eq('is_patient_visible', true)
      .maybeSingle<{ id: string; bucket: string; file_path: string | null }>();

    if (!doc?.file_path) return fail('Documento não disponível.');

    const { data, error } = await admin.storage
      .from(doc.bucket)
      .createSignedUrl(doc.file_path, 300);
    if (error || !data) return fail('Não foi possível abrir o documento.');

    await admin.from('document_views').insert({
      tenant_id: tenant.id,
      document_id: documentoId,
      viewer_kind: 'paciente',
    });

    return ok({ url: data.signedUrl });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

// =====================================================================
// Agendamento pelo proprio paciente
// =====================================================================

export interface OpcaoExame {
  id: string;
  nome: string;
  preco: number;
  minutos: number;
}

export interface OpcoesAgendamento {
  exames: OpcaoExame[];
  /** Horarios ja ocupados, por data (AAAA-MM-DD). */
  ocupados: Record<string, string[]>;
  /** Grade de horarios oferecida ao paciente. */
  horarios: string[];
}

const GRADE = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30',
];

/** Exames que o paciente pode escolher e o que ja esta tomado nos proximos 30 dias. */
export async function opcoesDeAgendamento(): Promise<ActionResult<OpcoesAgendamento>> {
  try {
    const anon = await createClient();
    const { data: tenant } = await anon
      .from('tenants')
      .select('id')
      .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
      .maybeSingle<{ id: string }>();
    if (!tenant) return fail('Unidade não configurada.');

    const admin = createAdminClient();

    const [examesRes, agendaRes] = await Promise.all([
      admin
        .from('exam_types')
        .select('id, name, price, average_minutes')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .eq('available_online', true)
        .is('deleted_at', null)
        .order('sort_order')
        .returns<{ id: string; name: string; price: number | null; average_minutes: number }[]>(),
      admin
        .from('appointments')
        .select('scheduled_at, scheduled_date')
        .eq('tenant_id', tenant.id)
        .gte('scheduled_date', todayISO())
        .not('status', 'in', '("cancelado","remarcado")')
        .is('deleted_at', null)
        .returns<{ scheduled_at: string; scheduled_date: string }[]>(),
    ]);

    const ocupados: Record<string, string[]> = {};
    for (const a of agendaRes.data ?? []) {
      const hora = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(a.scheduled_at));
      (ocupados[a.scheduled_date] ??= []).push(hora);
    }

    return ok({
      exames: (examesRes.data ?? []).map((e) => ({
        id: e.id,
        nome: e.name,
        preco: Number(e.price ?? 0),
        minutos: e.average_minutes,
      })),
      ocupados,
      horarios: GRADE,
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Cria o agendamento pedido pelo paciente.
 *
 * Aparece na agenda da clinica na hora, com origem registrada — a equipe sabe
 * que veio do aplicativo, e nao do balcao.
 */
export async function agendarAtendimento(input: {
  cpf: string;
  nascimento: string;
  data: string;
  hora: string;
  examTypeIds: string[];
  observacao?: string;
}): Promise<ActionResult<{ id: string; quando: string }>> {
  try {
    const sessao = await autenticar(input.cpf, input.nascimento);
    if (!sessao) return fail('Não localizamos seu cadastro com esses dados.');
    const { tenant, paciente, admin } = sessao;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data) || !/^\d{2}:\d{2}$/.test(input.hora)) {
      return fail('Escolha uma data e um horário válidos.');
    }
    if (input.data < todayISO()) return fail('Escolha uma data futura.');
    if (!GRADE.includes(input.hora)) return fail('Horário fora da grade de atendimento.');
    if (input.examTypeIds.length === 0) return fail('Selecione ao menos um exame.');

    // -03:00 e o fuso de Brasilia; guardar em UTC mantem o horario correto.
    const quando = new Date(`${input.data}T${input.hora}:00-03:00`);
    if (Number.isNaN(quando.getTime())) return fail('Data ou horário inválidos.');

    const { data: jaTem } = await admin
      .from('appointments')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('patient_id', paciente.id)
      .eq('scheduled_date', input.data)
      .not('status', 'in', '("cancelado","remarcado")')
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    if (jaTem) return fail('Você já possui um agendamento nesta data.');

    const { data: ocupado } = await admin
      .from('appointments')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('scheduled_at', quando.toISOString())
      .not('status', 'in', '("cancelado","remarcado")')
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    if (ocupado) return fail('Este horário acabou de ser preenchido. Escolha outro.');

    const { data: tipos } = await admin
      .from('exam_types')
      .select('id, average_minutes')
      .eq('tenant_id', tenant.id)
      .eq('available_online', true)
      .in('id', input.examTypeIds)
      .returns<{ id: string; average_minutes: number }[]>();

    if (!tipos || tipos.length === 0) return fail('Exames indisponíveis para agendamento.');

    const duracao = tipos.reduce((s, t) => s + t.average_minutes, 0) || 30;

    const { data: empresa } = await admin
      .from('patients')
      .select('company_id')
      .eq('id', paciente.id)
      .maybeSingle<{ company_id: string | null }>();

    const { data: criado, error } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenant.id,
        patient_id: paciente.id,
        company_id: empresa?.company_id ?? null,
        scheduled_at: quando.toISOString(),
        duration_minutes: duracao,
        attendance_kind: 'consulta',
        priority: 'normal',
        status: 'agendado',
        origin: 'api',
        notes: input.observacao?.slice(0, 300) ?? 'Agendado pelo aplicativo do paciente',
      })
      .select('id, scheduled_at')
      .single<{ id: string; scheduled_at: string }>();

    if (error) return fail(toFriendlyError(error));

    await admin.from('appointment_exams').insert(
      tipos.map((t) => ({
        tenant_id: tenant.id,
        appointment_id: criado.id,
        exam_type_id: t.id,
        origin: 'api' as const,
      })),
    );

    await admin.from('audit_logs').insert({
      tenant_id: tenant.id,
      user_name: paciente.full_name,
      action: 'create',
      entity: 'appointments',
      entity_id: criado.id,
      patient_id: paciente.id,
      description: 'Agendamento criado pelo aplicativo do paciente',
      origin: 'app_paciente',
      is_automatic: false,
    });

    return ok({ id: criado.id, quando: criado.scheduled_at }, 'Agendamento confirmado!');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
