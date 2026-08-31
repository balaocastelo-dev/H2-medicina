import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;
let usuario = '';
let empresa = '';
let paciente = '';

/** Atalhos com o mesmo nome de antes, para o corpo do teste nao mudar. */
const comoUsuario = <T,>(fn: () => Promise<T>) => amb.como(usuario, fn);
const um = <T,>(sql: string) => amb.um<T>(sql);

beforeAll(async () => {
  amb = await montarAmbiente();
  usuario = await amb.criarUsuario('Dra. Teste', 'percurso@teste.com');

  empresa = (
    await um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, trade_name, document)
      values ('${amb.tenant}', 'Empresa de Teste Ltda', 'Empresa Teste', '11222333000181')
      returning id
    `)
  ).id;
});

afterAll(async () => {
  await amb?.fechar();
});

describe('percurso do paciente', () => {
  it('1. cadastra o paciente', async () => {
    const r = await comoUsuario(async () =>
      um<{ id: string; full_name: string }>(`
        insert into public.patients (tenant_id, full_name, cpf, birth_date, company_id, job_title)
        values ('${amb.tenant}', 'Paciente de Teste', '52998224725', '1990-05-10', '${empresa}', 'Motorista')
        returning id, full_name
      `),
    );
    paciente = r.id;
    expect(r.full_name).toBe('Paciente de Teste');
  });

  it('2. cria o agendamento com exames', async () => {
    const agendamento = await comoUsuario(async () => {
      const a = await um<{ id: string; scheduled_date: string }>(`
        insert into public.appointments
          (tenant_id, patient_id, company_id, scheduled_at, attendance_kind, created_by)
        values ('${amb.tenant}', '${paciente}', '${empresa}',
                (now() at time zone 'America/Sao_Paulo')::date + time '08:00', 'admissional', '${usuario}')
        returning id, scheduled_date::text
      `);
      await amb.db.exec(`
        insert into public.appointment_exams (tenant_id, appointment_id, exam_type_id)
        select '${amb.tenant}', '${a.id}', id from public.exam_types
         where tenant_id = '${amb.tenant}' and code in ('AUDIO', 'CLINICO')
      `);
      return a;
    });
    expect(agendamento.id).toBeTruthy();
  });

  it('3. check-in no totem gera atendimento e senha', async () => {
    const r = await comoUsuario(async () =>
      um<{ payload: { attendance_id: string; ticket: { code: string } } }>(
        `select public.checkin_patient('${amb.tenant}', null, '${paciente}', 'normal', null, null) as payload`,
      ),
    );
    expect(r.payload.attendance_id).toBeTruthy();
    expect(r.payload.ticket?.code).toBeTruthy();
  });

  it('4. recepcao define procedencia, procedimento e exames', async () => {
    const atendimento = await atendimentoAtual();

    await comoUsuario(async () => {
      // startReception
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'na_recepcao', reception_started_at = now(), updated_by = '${usuario}'
         where id = '${atendimento}'
      `);

      // finishReception: exames confirmados + procedimento + procedencia
      await amb.db.exec(`
        insert into public.patient_exams
          (tenant_id, attendance_id, patient_id, exam_type_id, room_id, sort_order, priority, status, created_by)
        select '${amb.tenant}', '${atendimento}', '${paciente}', et.id, et.default_room_id, et.sort_order,
               'normal', 'pendente', '${usuario}'
          from public.exam_types et
         where et.tenant_id = '${amb.tenant}' and et.code in ('AUDIO', 'CLINICO')
      `);
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'aguardando_exames',
               needs_triage = false,
               origin_kind = 'particular',
               procedure_code = 'consulta_ocupacional',
               reception_finished_at = now(),
               updated_by = '${usuario}'
         where id = '${atendimento}'
      `);
    });

    const estado = await um<{ stage_code: string; procedure_code: string; exames: number }>(`
      select a.stage_code, a.procedure_code,
             (select count(*)::int from public.patient_exams where attendance_id = a.id) as exames
        from public.attendances a where a.id = '${atendimento}'
    `);
    expect(estado.stage_code).toBe('aguardando_exames');
    expect(estado.procedure_code).toBe('consulta_ocupacional');
    expect(estado.exames).toBe(2);
  });

  it('5. a sala de audiometria chama e conclui o exame', async () => {
    const sala = await um<{ id: string }>(`
      select r.id from public.rooms r
       join public.exam_types et on et.default_room_id = r.id
      where et.tenant_id = '${amb.tenant}' and et.code = 'AUDIO'
    `);

    const chamada = await comoUsuario(async () =>
      um<{ payload: { found: boolean; exam: { id: string } } }>(
        `select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`,
      ),
    );
    expect(chamada.payload.found).toBe(true);

    const exame = chamada.payload.exam.id;

    // A ficha do exame, preenchida na sala.
    await comoUsuario(async () => {
      await amb.db.exec(`
        insert into public.exam_results (tenant_id, patient_exam_id, patient_id, professional_id, values, conclusion, is_altered, created_by)
        values ('${amb.tenant}', '${exame}', '${paciente}', '${usuario}',
                '{"od_1000":"15","oe_1000":"20"}'::jsonb, 'Dentro dos limites', false, '${usuario}')
      `);
      await amb.db.exec(`
        update public.patient_exams
           set status = 'concluido', finished_at = now(), updated_by = '${usuario}'
         where id = '${exame}'
      `);
    });

    const tv = await um<{ total: number }>(
      `select count(*)::int as total from public.tv_calls where tenant_id = '${amb.tenant}'`,
    );
    expect(tv.total).toBeGreaterThan(0);
  });

  it('6. concluido o ultimo exame, o paciente vai para a fila do medico', async () => {
    const atendimento = await atendimentoAtual();

    await comoUsuario(async () => {
      await amb.db.exec(`
        update public.patient_exams
           set status = 'concluido', finished_at = now(), updated_by = '${usuario}'
         where attendance_id = '${atendimento}' and status <> 'concluido'
      `);
    });

    const estado = await um<{ stage_code: string; in_service: boolean }>(
      `select stage_code, in_service from public.attendances where id = '${atendimento}'`,
    );
    expect(estado.stage_code).toBe('aguardando_medico');
    expect(estado.in_service).toBe(false);
  });

  it('7. o consultorio chama o proximo e assume o paciente', async () => {
    const atendimento = await atendimentoAtual();
    const sala = await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'consultorio' and is_active order by sort_order limit 1`,
    );

    // Mesmo caminho de chamarProximoNoConsultorio.
    const tomado = await comoUsuario(async () =>
      um<{ id: string | null }>(`
        update public.attendances
           set stage_code = 'em_consulta', in_service = true, current_room_id = '${sala.id}',
               consultation_started_at = now(), updated_by = '${usuario}'
         where id = '${atendimento}' and tenant_id = '${amb.tenant}' and in_service = false
        returning id
      `),
    );
    expect(tomado?.id).toBe(atendimento);

    // A segunda sala nao pode levar o mesmo paciente.
    const segunda = await amb.db.query(`
      update public.attendances set in_service = true
       where id = '${atendimento}' and in_service = false returning id
    `);
    expect(segunda.rows).toHaveLength(0);
  });

  it('8. a consulta grava psicossocial, ficha e aptidao', async () => {
    const atendimento = await atendimentoAtual();

    await comoUsuario(async () => {
      await amb.db.exec(`
        insert into public.medical_consultations
          (tenant_id, attendance_id, patient_id, doctor_id, room_id, verdict, valid_until,
           estilo_vida, exame_fisico, psicossocial, created_by)
        select '${amb.tenant}', '${atendimento}', '${paciente}', '${usuario}', a.current_room_id, 'apto',
                current_date + 365,
                '{"tabagismo":"não"}'::jsonb,
                '{"coluna":"normal"}'::jsonb,
                '{"ideacao":"não","triste":"não"}'::jsonb,
                '${usuario}'
          from public.attendances a where a.id = '${atendimento}'
      `);
    });

    const consulta = await um<{ verdict: string; psicossocial: Record<string, string> }>(
      `select verdict, psicossocial from public.medical_consultations where attendance_id = '${atendimento}'`,
    );
    expect(consulta.verdict).toBe('apto');
    expect(consulta.psicossocial.ideacao).toBe('não');
  });

  it('9. finalizar a consulta libera a sala', async () => {
    const atendimento = await atendimentoAtual();

    // Salvar a consulta nao pode ter apagado o vinculo com o consultorio:
    // era isso que deixava a sala ocupada para sempre.
    const sala = await um<{ current_room_id: string | null }>(
      `select current_room_id from public.attendances where id = '${atendimento}'`,
    );
    expect(sala.current_room_id).not.toBeNull();

    await comoUsuario(async () => {
      await amb.db.exec(`
        update public.medical_consultations set finished_at = now(), signed_at = now()
         where attendance_id = '${atendimento}'
      `);
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'aguardando_pagamento', consultation_finished_at = now(),
               in_service = false, current_room_id = null, updated_by = '${usuario}'
         where id = '${atendimento}'
      `);
      await amb.db.exec(`
        update public.rooms set status = 'disponivel', current_attendance_id = null
         where id = '${sala.current_room_id}' and tenant_id = '${amb.tenant}'
      `);
    });

    const depois = await um<{ status: string; current_attendance_id: string | null }>(
      `select status, current_attendance_id from public.rooms where id = '${sala.current_room_id}'`,
    );
    expect(depois.status).toBe('disponivel');
    expect(depois.current_attendance_id).toBeNull();
  });

  it('10. o atendimento chega ao fim', async () => {
    const atendimento = await atendimentoAtual();
    await comoUsuario(async () => {
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'finalizado', finished_at = now(), exit_at = now(), updated_by = '${usuario}'
         where id = '${atendimento}'
      `);
    });

    const estado = await um<{ stage_code: string; finished_at: string | null }>(
      `select stage_code, finished_at from public.attendances where id = '${atendimento}'`,
    );
    expect(estado.stage_code).toBe('finalizado');
    expect(estado.finished_at).not.toBeNull();
  });
});

describe('regras que a clinica pediu', () => {
  it('pericia e junta medica nao emitem ficha clinica', async () => {
    const r = await amb.db.query<{ code: string }>(`
      select code from public.procedure_types
       where tenant_id = '${amb.tenant}' and not emite_ficha_clinica order by code
    `);
    expect(r.rows.map((x) => x.code)).toContain('pericia');
    expect(r.rows.map((x) => x.code)).toContain('junta_medica');
  });

  it('todo exame ativo tem sala, menos o raio X', async () => {
    const r = await amb.db.query<{ code: string }>(`
      select code from public.exam_types
       where tenant_id = '${amb.tenant}' and is_active and default_room_id is null
    `);
    expect(r.rows.map((x) => x.code)).toEqual(['RAIOX']);
  });

  it('nenhum exame ativo aponta para sala inativa', async () => {
    // Foi o erro do primeiro seed: as dinamometrias iam para uma sala que a
    // clinica tinha desativado, e nunca apareciam em fila nenhuma.
    const r = await amb.db.query<{ code: string }>(`
      select et.code from public.exam_types et
        join public.rooms r on r.id = et.default_room_id
       where et.tenant_id = '${amb.tenant}' and et.is_active and not r.is_active
    `);
    expect(r.rows).toEqual([]);
  });

  it('unifica dois cadastros do mesmo paciente', async () => {
    const duplicado = await comoUsuario(async () =>
      um<{ id: string }>(`
        insert into public.patients (tenant_id, full_name, birth_date, phone)
        values ('${amb.tenant}', 'Paciente de Teste', '1990-05-10', '19999990000')
        returning id
      `),
    );

    await comoUsuario(async () => {
      await amb.db.query(`select public.merge_patients('${duplicado.id}', '${paciente}')`);
    });

    const origem = await um<{ deleted_at: string | null }>(
      `select deleted_at from public.patients where id = '${duplicado.id}'`,
    );
    const destino = await um<{ phone: string | null; deleted_at: string | null }>(
      `select phone, deleted_at from public.patients where id = '${paciente}'`,
    );

    expect(origem.deleted_at).not.toBeNull();
    expect(destino.deleted_at).toBeNull();
    // O telefone so existia no duplicado: o campo vazio do destino foi completado.
    expect(destino.phone).toBe('19999990000');
  });

  it('nao deixa unificar um cadastro com ele mesmo', async () => {
    let recusou = false;
    try {
      await comoUsuario(async () => {
        await amb.db.query(`select public.merge_patients('${paciente}', '${paciente}')`);
      });
    } catch {
      recusou = true;
    }
    expect(recusou).toBe(true);
  });
});


describe('paciente que vai direto ao medico', () => {
  let atendimento = '';
  let outro = '';

  it('SISPER sai da recepcao ja na fila do medico, sem exame', async () => {
    // Era o caso que nunca era chamado: tres das quatro procedencias vao
    // direto para `aguardando_medico`, e a chamada por sala so enxergava
    // quem tinha exame pendente.
    outro = (
      await comoUsuario(async () =>
        um<{ id: string }>(`
          insert into public.patients (tenant_id, full_name, cpf)
          values ('${amb.tenant}', 'Paciente SISPER', '11144477735') returning id
        `),
      )
    ).id;

    const checkin = await comoUsuario(async () =>
      um<{ payload: { attendance_id: string } }>(
        `select public.checkin_patient('${amb.tenant}', null, '${outro}', 'normal', null, null) as payload`,
      ),
    );
    atendimento = checkin.payload.attendance_id;

    await comoUsuario(async () => {
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'aguardando_medico', needs_triage = false, origin_kind = 'sisper',
               procedure_code = 'pericia', reception_finished_at = now(), updated_by = '${usuario}'
         where id = '${atendimento}'
      `);
    });

    const estado = await um<{ stage_code: string; exames: number }>(`
      select a.stage_code,
             (select count(*)::int from public.patient_exams where attendance_id = a.id) as exames
        from public.attendances a where a.id = '${atendimento}'
    `);
    expect(estado.stage_code).toBe('aguardando_medico');
    expect(estado.exames).toBe(0);
  });

  it('o consultorio consegue chamar quem nao tem exame nenhum', async () => {
    const sala = await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'consultorio' and is_active order by sort_order limit 1`,
    );

    // A RPC de sala nao acha esse paciente — e o motivo da fila nova.
    const porExame = await comoUsuario(async () =>
      um<{ payload: { found: boolean } }>(
        `select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`,
      ),
    );
    expect(porExame.payload.found).toBe(false);

    // A fila do medico acha.
    const tomado = await comoUsuario(async () =>
      um<{ id: string | null }>(`
        update public.attendances
           set stage_code = 'em_consulta', in_service = true, current_room_id = '${sala.id}',
               consultation_started_at = now(), updated_by = '${usuario}'
         where id = '${atendimento}' and tenant_id = '${amb.tenant}' and in_service = false
        returning id
      `),
    );
    expect(tomado?.id).toBe(atendimento);
  });

  it('pericia nao emite ficha clinica', async () => {
    const r = await um<{ emite: boolean; origem: string }>(`
      select pt.emite_ficha_clinica as emite, a.origin_kind as origem
        from public.attendances a
        join public.procedure_types pt
          on pt.tenant_id = a.tenant_id and pt.code = a.procedure_code
       where a.id = '${atendimento}'
    `);
    expect(r.emite).toBe(false);
    expect(r.origem).toBe('sisper');
  });

  it('a recepcao consegue cancelar o atendimento no meio da fila', async () => {
    await comoUsuario(async () => {
      await amb.db.query(
        `select public.move_attendance_stage('${atendimento}', 'cancelado', 'Paciente foi embora')`,
      );
    });

    const estado = await um<{ stage_code: string; cancelled_at: string | null }>(
      `select stage_code, cancelled_at from public.attendances where id = '${atendimento}'`,
    );
    expect(estado.stage_code).toBe('cancelado');
    expect(estado.cancelled_at).not.toBeNull();
  });

  it('cancelado sai das filas das salas', async () => {
    const sala = await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'consultorio' and is_active order by sort_order limit 1`,
    );
    const r = await comoUsuario(async () =>
      um<{ payload: { found: boolean } }>(
        `select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`,
      ),
    );
    expect(r.payload.found).toBe(false);
  });
});

describe('laudo que chega depois', () => {
  it('anexa ao cadastro do paciente, vinculado ao exame', async () => {
    const anexo = await comoUsuario(async () =>
      um<{ id: string; kind: string }>(`
        insert into public.patient_attachments
          (tenant_id, patient_id, exam_type_id, title, kind, bucket, file_path, uploaded_by)
        select '${amb.tenant}', '${paciente}', et.id, 'Raio X de torax', 'exame', 'attachments',
               '${amb.tenant}/pacientes/${paciente}/raiox.pdf', '${usuario}'
          from public.exam_types et
         where et.tenant_id = '${amb.tenant}' and et.code = 'RAIOX'
        returning id, kind
      `),
    );
    expect(anexo.kind).toBe('exame');

    const visivel = await comoUsuario(async () =>
      um<{ total: number }>(
        `select count(*)::int as total from public.patient_attachments
          where patient_id = '${paciente}' and deleted_at is null`,
      ),
    );
    expect(visivel.total).toBe(1);
  });

  it('o anexo acompanha o cadastro na unificacao', async () => {
    const duplicado = await comoUsuario(async () =>
      um<{ id: string }>(`
        insert into public.patients (tenant_id, full_name, birth_date)
        values ('${amb.tenant}', 'Paciente de Teste', '1990-05-10') returning id
      `),
    );
    await comoUsuario(async () => {
      await amb.db.exec(`
        insert into public.patient_attachments
          (tenant_id, patient_id, title, kind, bucket, file_path, uploaded_by)
        values ('${amb.tenant}', '${duplicado.id}', 'Laudo antigo', 'exame', 'attachments',
                '${amb.tenant}/pacientes/antigo.pdf', '${usuario}')
      `);
      await amb.db.query(`select public.merge_patients('${duplicado.id}', '${paciente}')`);
    });

    const total = await um<{ total: number }>(
      `select count(*)::int as total from public.patient_attachments where patient_id = '${paciente}'`,
    );
    expect(total.total).toBe(2);
  });
});

/** O atendimento aberto do paciente de teste. */
async function atendimentoAtual(): Promise<string> {
  const r = await um<{ id: string }>(
    `select id from public.attendances where patient_id = '${paciente}' order by checkin_at desc limit 1`,
  );
  return r.id;
}
