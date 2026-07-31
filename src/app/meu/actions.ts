'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { onlyDigits } from '@/lib/format';
import { type ActionResult, fail, ok } from '@/lib/action-result';

export interface PatientJourney {
  patientName: string;
  ticketCode: string | null;
  stageCode: string;
  roomName: string | null;
  checkinAt: string;
  exams: { name: string; status: string }[];
}

/**
 * Consulta publica da jornada do paciente (PWA).
 *
 * Autenticacao de baixo atrito por CPF + data de nascimento — os dois precisam
 * bater. Retorna somente dados operacionais (senha, etapa, sala e situacao dos
 * exames). Nenhum dado clinico, de outros pacientes ou de terceiros e exposto.
 */
export async function lookupPatientJourney(
  cpfRaw: string,
  birthDate: string,
): Promise<ActionResult<PatientJourney>> {
  const cpf = onlyDigits(cpfRaw);
  if (cpf.length !== 11) return fail('Informe um CPF valido.');
  if (!birthDate) return fail('Informe a data de nascimento.');

  const anon = await createClient();
  const { data: tenant } = await anon
    .from('tenants')
    .select('id')
    .eq('slug', publicEnv.NEXT_PUBLIC_DEFAULT_TENANT_SLUG)
    .maybeSingle<{ id: string }>();
  if (!tenant) return fail('Unidade nao configurada.');

  // Consulta restrita executada no servidor com filtro duplo (CPF + nascimento).
  const admin = createAdminClient();

  const { data: patient } = await admin
    .from('patients')
    .select('id, full_name')
    .eq('tenant_id', tenant.id)
    .eq('cpf', cpf)
    .eq('birth_date', birthDate)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; full_name: string }>();

  if (!patient) return fail('Nao localizamos seu cadastro com esses dados.');

  const { data: attendance } = await admin
    .from('attendances')
    .select(
      'id, stage_code, checkin_at, current_room_id, queue_tickets(code), patient_exams(status, exam_types(name)), rooms:current_room_id(name)',
    )
    .eq('tenant_id', tenant.id)
    .eq('patient_id', patient.id)
    .is('deleted_at', null)
    .order('checkin_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      stage_code: string;
      checkin_at: string;
      current_room_id: string | null;
      queue_tickets: { code: string }[];
      patient_exams: { status: string; exam_types: { name: string } | null }[];
      rooms: { name: string } | null;
    }>();

  if (!attendance) {
    return fail('Nenhum atendimento em andamento. Procure a recepcao.');
  }

  return ok({
    patientName: patient.full_name,
    ticketCode: attendance.queue_tickets?.[0]?.code ?? null,
    stageCode: attendance.stage_code,
    roomName: attendance.rooms?.name ?? null,
    checkinAt: attendance.checkin_at,
    exams: (attendance.patient_exams ?? []).map((e) => ({
      name: e.exam_types?.name ?? 'Exame',
      status: e.status,
    })),
  });
}
