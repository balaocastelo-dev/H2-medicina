'use server';

import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { onlyDigits, startOfTodayISO } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { montarTrilha, type MovimentoBruto, type Trilha } from './etapas';

export interface PacienteEncontrado {
  attendanceId: string | null;
  patientId: string;
  nome: string;
  cpf: string | null;
  empresa: string | null;
  senha: string | null;
  checkinAt: string | null;
  stageCode: string | null;
  originKind: string | null;
}

interface LinhaDeAtendimento {
  id: string;
  stage_code: string;
  checkin_at: string;
  stage_changed_at: string | null;
  finished_at: string | null;
  origin_kind: string;
  patient_id: string;
  patients: { id: string; full_name: string; cpf: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  queue_tickets: { code: string }[];
}

const CAMPOS =
  'id, stage_code, checkin_at, stage_changed_at, finished_at, origin_kind, patient_id, patients(id, full_name, cpf), companies(trade_name, legal_name), queue_tickets(code)';

function paraEncontrado(linha: LinhaDeAtendimento): PacienteEncontrado {
  return {
    attendanceId: linha.id,
    patientId: linha.patient_id,
    nome: linha.patients?.full_name ?? 'Paciente',
    cpf: linha.patients?.cpf ?? null,
    empresa: linha.companies?.trade_name ?? linha.companies?.legal_name ?? null,
    senha: linha.queue_tickets?.[0]?.code ?? null,
    checkinAt: linha.checkin_at,
    stageCode: linha.stage_code,
    originKind: linha.origin_kind,
  };
}

/**
 * Procura o paciente pelo nome ou pelo CPF.
 *
 * Busca primeiro entre os atendimentos abertos: quem pergunta "cade o
 * fulano?" quase sempre fala de alguem que esta na casa agora. Só depois
 * cai para o historico.
 */
export async function procurarPaciente(
  termo: string,
): Promise<ActionResult<PacienteEncontrado[]>> {
  try {
    const ctx = await assertPermission('pacientes.ver');
    const limpo = termo.trim();
    if (limpo.length < 3) return ok([]);

    const supabase = await createClient();
    const digitos = onlyDigits(limpo);
    const porCpf = digitos.length >= 6;

    // `!inner` e o que permite filtrar pelo paciente sem perder o vinculo:
    // sem ele o PostgREST devolveria o atendimento com `patients` nulo.
    const base = supabase
      .from('attendances')
      .select(CAMPOS.replace('patients(', 'patients!inner('))
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .order('checkin_at', { ascending: false })
      .limit(12);

    const { data: abertos } = await (porCpf
      ? base.eq('patients.cpf', digitos)
      : base.ilike('patients.full_name', `%${limpo}%`)
    ).returns<LinhaDeAtendimento[]>();

    const encontrados = abertos ?? [];
    if (encontrados.length > 0) return ok(encontrados.map(paraEncontrado));

    // Ninguem no fluxo: mostra o cadastro, para pelo menos confirmar que a
    // pessoa existe e nao veio hoje.
    const consultaPaciente = supabase
      .from('patients')
      .select('id, full_name, cpf, companies(trade_name, legal_name)')
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .limit(8);

    const { data: pacientes } = await (porCpf
      ? consultaPaciente.eq('cpf', digitos)
      : consultaPaciente.ilike('full_name', `%${limpo}%`)
    ).returns<
      {
        id: string;
        full_name: string;
        cpf: string | null;
        companies: { trade_name: string | null; legal_name: string } | null;
      }[]
    >();

    return ok(
      (pacientes ?? []).map((p) => ({
        attendanceId: null,
        patientId: p.id,
        nome: p.full_name,
        cpf: p.cpf,
        empresa: p.companies?.trade_name ?? p.companies?.legal_name ?? null,
        senha: null,
        checkinAt: null,
        stageCode: null,
        originKind: null,
      })),
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export interface TrilhaCompleta {
  paciente: PacienteEncontrado;
  trilha: Trilha;
}

/** Trilha de um atendimento: por onde passou, quanto tempo e o que falta. */
export async function trilhaDoAtendimento(
  attendanceId: string,
): Promise<ActionResult<TrilhaCompleta>> {
  try {
    const ctx = await assertPermission('agenda.ver');
    const supabase = await createClient();

    const { data: atendimento } = await supabase
      .from('attendances')
      .select(CAMPOS)
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<LinhaDeAtendimento>();

    if (!atendimento) return fail('Atendimento não encontrado.');

    const { data: movimentos } = await supabase
      .from('crm_movements')
      .select('from_stage, to_stage, created_at, seconds_in_previous, is_manual')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .order('created_at')
      .returns<MovimentoBruto[]>();

    return ok({
      paciente: paraEncontrado(atendimento),
      trilha: montarTrilha({
        stageCode: atendimento.stage_code,
        checkinAt: atendimento.checkin_at,
        stageChangedAt: atendimento.stage_changed_at,
        finishedAt: atendimento.finished_at,
        movimentos: movimentos ?? [],
      }),
    });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Ultimo atendimento do paciente, para quem buscou pelo cadastro. */
export async function ultimoAtendimentoDoPaciente(
  patientId: string,
): Promise<ActionResult<{ attendanceId: string | null }>> {
  try {
    const ctx = await assertPermission('agenda.ver');
    const supabase = await createClient();

    const { data } = await supabase
      .from('attendances')
      .select('id')
      .eq('tenant_id', ctx.tenant.id)
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('checkin_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    return ok({ attendanceId: data?.id ?? null });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export interface PacienteNoMapa extends PacienteEncontrado {
  segundosNaEtapa: number;
}

/** Todos os pacientes de hoje, com a etapa e o tempo parado em cada uma. */
export async function mapaDoDia(): Promise<ActionResult<PacienteNoMapa[]>> {
  try {
    const ctx = await assertPermission('agenda.ver');
    const supabase = await createClient();

    const { data } = await supabase
      .from('attendances')
      .select(CAMPOS)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .gte('checkin_at', startOfTodayISO())
      .order('checkin_at')
      .returns<LinhaDeAtendimento[]>();

    const agora = Date.now();

    return ok(
      (data ?? []).map((a) => ({
        ...paraEncontrado(a),
        segundosNaEtapa: Math.max(
          0,
          (agora - new Date(a.stage_changed_at ?? a.checkin_at).getTime()) / 1000,
        ),
      })),
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
