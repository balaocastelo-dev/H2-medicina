/**
 * Cada papel consegue fazer o trabalho dele com o RLS ligado.
 *
 * "login do dr antonio nao esta chamando pacientes no modulo medico" /
 * "todos os logins de outros medicos aparece isso quando tenta chamar"
 *                                              -- Isabella, 28/09.
 *
 * A tela dizia "Outro consultorio chamou este paciente agora" com zero
 * pacientes em consulta. Nao havia outro consultorio: a gravacao era
 * recusada pelo RLS e afetava zero linhas, e o codigo interpretava zero
 * linhas como "alguem chegou primeiro".
 *
 * Esse e o jeito mais traicoeiro de uma permissao faltar. UPDATE barrado
 * por RLS nao levanta erro: ele simplesmente nao encontra a linha. Nao
 * aparece em log, nao aparece em tsc, nao aparece em teste que roda como
 * administrador -- e o teste que existia rodava como administrador.
 *
 * Aqui cada papel do seed tenta escrever o que a tela dele escreve, com o
 * RLS valendo, e o teste falha dizendo qual tabela barrou.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;

const um = <T,>(sql: string) => amb.um<T>(sql);

/** Cria um usuario com um papel do seed, e nao com todas as permissoes. */
async function usuarioComPapel(codigoDoPapel: string, email: string): Promise<string> {
  const { id } = await um<{ id: string }>(
    `insert into auth.users (email) values ('${email}') returning id`,
  );
  await amb.db.exec(`
    insert into public.profiles (id, tenant_id, full_name, email, council_type, council_number, council_state)
    values ('${id}', '${amb.tenant}', '${email}', '${email}', 'CRM', '${Math.floor(
      Math.random() * 900000 + 100000,
    )}', 'SP');
    insert into public.user_roles (user_id, role_id, tenant_id)
    select '${id}', r.id, '${amb.tenant}' from public.roles r
     where r.tenant_id = '${amb.tenant}' and r.code = '${codigoDoPapel}';`);
  return id;
}

/**
 * Quantas linhas o usuario consegue alterar.
 *
 * Zero com RLS ligado significa "barrado", e e exatamente o silencio que
 * produziu a mensagem errada na tela do medico.
 */
async function linhasAfetadas(usuario: string, sql: string): Promise<number> {
  return amb.como(usuario, async () => {
    try {
      const r = await amb.db.query(`${sql} returning 1`);
      return r.rows.length;
    } catch (e) {
      // UPDATE barrado devolve zero linhas em silencio; INSERT barrado
      // levanta erro. As duas coisas significam "nao pode", e e isso que
      // o teste quer medir.
      if (/row-level security/i.test((e as Error).message)) return 0;
      throw e;
    }
  });
}

let medico = '';
let triagista = '';
let recepcao = '';
let atendimento = '';
let paciente = '';
let consultorio = '';
let salaDeTriagem = '';

beforeAll(async () => {
  amb = await montarAmbiente();

  medico = await usuarioComPapel('medico_examinador', 'dr.antonio@teste.com');
  triagista = await usuarioComPapel('medico_examinador', 'triagista@teste.com');
  recepcao = await usuarioComPapel('atendimento', 'recepcao@teste.com');

  consultorio = (
    await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'consultorio' and is_active order by sort_order limit 1`,
    )
  ).id;
  salaDeTriagem = (
    await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'triagem' and is_active order by sort_order limit 1`,
    )
  ).id;

  // Um paciente esperando o médico, como no dia 28.
  paciente = (
    await um<{ id: string }>(`
      insert into public.patients (tenant_id, full_name)
      values ('${amb.tenant}', 'Paciente na fila do médico') returning id`)
  ).id;

  atendimento = (
    await um<{ id: string }>(`
      insert into public.attendances
        (tenant_id, patient_id, stage_code, needs_triage, in_service, origin_kind)
      values ('${amb.tenant}', '${paciente}', 'aguardando_medico', false, false, 'particular')
      returning id`)
  ).id;
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

describe('o médico consegue trabalhar', () => {
  it('enxerga quem está esperando', async () => {
    const r = await amb.como(medico, async () =>
      um<{ total: number }>(`
        select count(*)::int as total from public.attendances
         where stage_code = 'aguardando_medico' and in_service = false`),
    );
    // Enxergar sempre funcionou: era a gravação que sumia.
    expect(r.total).toBeGreaterThan(0);
  });

  it('CHAMA o paciente — era isto que não funcionava', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `update public.attendances
          set stage_code = 'em_consulta', in_service = true, current_room_id = '${consultorio}',
              consultation_started_at = now()
        where id = '${atendimento}' and in_service = false`,
    );
    expect(linhas).toBe(1);
  });

  it('ocupa o consultório', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `update public.rooms set status = 'ocupada', current_attendance_id = '${atendimento}'
        where id = '${consultorio}'`,
    );
    expect(linhas).toBe(1);
  });

  it('anuncia a senha na TV', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `insert into public.tv_calls (tenant_id, ticket_code, room_name, destination)
       values ('${amb.tenant}', 'A001', 'Consultório', 'consultorio')`,
    );
    expect(linhas).toBe(1);
  });

  it('grava a consulta', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `insert into public.medical_consultations
         (tenant_id, attendance_id, patient_id, doctor_id, verdict)
       values ('${amb.tenant}', '${atendimento}', '${paciente}', '${medico}', 'apto')`,
    );
    expect(linhas).toBe(1);
  });

  it('emite o documento', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `insert into public.documents (tenant_id, kind, title, patient_id, attendance_id)
       values ('${amb.tenant}', 'aso', 'A.S.O.', '${paciente}', '${atendimento}')`,
    );
    expect(linhas).toBe(1);
  });

  it('lança o repasse dele', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `insert into public.fee_entries
         (tenant_id, profile_id, attendance_id, procedure_code, procedure_name, fee, competencia)
       values ('${amb.tenant}', '${medico}', '${atendimento}', 'consulta_ocupacional',
               'Consulta ocupacional', 60, current_date)`,
    );
    expect(linhas).toBe(1);
  });

  it('manda o paciente para o pagamento e libera a sala', async () => {
    const naEtapa = await linhasAfetadas(
      medico,
      `update public.attendances
          set stage_code = 'aguardando_pagamento', in_service = false, current_room_id = null
        where id = '${atendimento}'`,
    );
    expect(naEtapa).toBe(1);

    const naSala = await linhasAfetadas(
      medico,
      `update public.rooms set status = 'disponivel', current_attendance_id = null
        where id = '${consultorio}'`,
    );
    expect(naSala).toBe(1);
  });
});

describe('quem faz a triagem consegue trabalhar', () => {
  let outro = '';

  beforeAll(async () => {
    const p = await um<{ id: string }>(`
      insert into public.patients (tenant_id, full_name)
      values ('${amb.tenant}', 'Paciente da triagem') returning id`);
    outro = (
      await um<{ id: string }>(`
        insert into public.attendances
          (tenant_id, patient_id, stage_code, needs_triage, in_service, origin_kind)
        values ('${amb.tenant}', '${p.id}', 'aguardando_triagem', true, false, 'particular')
        returning id`)
    ).id;
  });

  it('chama o paciente para a triagem', async () => {
    const naEtapa = await linhasAfetadas(
      triagista,
      `update public.attendances
          set stage_code = 'em_triagem', current_room_id = '${salaDeTriagem}', in_service = true
        where id = '${outro}'`,
    );
    expect(naEtapa).toBe(1);

    const naSala = await linhasAfetadas(
      triagista,
      `update public.rooms set status = 'ocupada', current_attendance_id = '${outro}'
        where id = '${salaDeTriagem}'`,
    );
    expect(naSala).toBe(1);
  });
});

describe('a recepção continua conseguindo trabalhar', () => {
  it('libera o paciente para a fila', async () => {
    const p = await um<{ id: string }>(`
      insert into public.patients (tenant_id, full_name)
      values ('${amb.tenant}', 'Paciente da recepção') returning id`);
    const at = await um<{ id: string }>(`
      insert into public.attendances (tenant_id, patient_id, stage_code)
      values ('${amb.tenant}', '${p.id}', 'na_recepcao') returning id`);

    const linhas = await linhasAfetadas(
      recepcao,
      `update public.attendances set stage_code = 'aguardando_exames' where id = '${at.id}'`,
    );
    expect(linhas).toBe(1);
  });
});

describe('o RLS continua separando o que tem de separar', () => {
  it('o médico não administra o cadastro de salas e exames', async () => {
    // Alargar a escrita das operacoes nao pode virar "todo mundo pode
    // tudo": mexer no CADASTRO de exame continua sendo de quem administra.
    const linhas = await linhasAfetadas(
      medico,
      `update public.exam_types set price = 999
        where tenant_id = '${amb.tenant}' and code = 'AUDIO'`,
    );
    expect(linhas).toBe(0);
  });

  it('o médico não mexe no financeiro da clínica', async () => {
    const linhas = await linhasAfetadas(
      medico,
      `insert into public.payments (tenant_id, amount, method, status)
       values ('${amb.tenant}', 100, 'pix', 'pendente')`,
    );
    expect(linhas).toBe(0);
  });

  it('a recepção não grava consulta médica', async () => {
    const linhas = await linhasAfetadas(
      recepcao,
      `insert into public.medical_consultations (tenant_id, attendance_id, patient_id)
       values ('${amb.tenant}', '${atendimento}', '${paciente}')`,
    );
    expect(linhas).toBe(0);
  });
});
