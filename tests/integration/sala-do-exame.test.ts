import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

/**
 * A sala em que o exame e chamado segue a sala padrao dele.
 *
 * "os exames de dinamometria (palmar, escapular e lombar) estao sendo
 *  chamados na sala 5, eles devem ser chamados na sala 7"
 *                                              -- Isabella, 21/09
 *
 * Duas tabelas diziam em que sala um exame acontece, e a chamada aceitava
 * as duas. Mover a sala padrao sem mover o vinculo deixava a sala antiga
 * continuar chamando.
 */

let env: Ambiente;

beforeAll(async () => {
  env = await montarAmbiente();
});

afterAll(async () => {
  await env.fechar();
});

const salasDe = async (codigo: string) => {
  const r = await env.db.query<{ name: string }>(
    `select r.name
       from public.room_exam_types ret
       join public.rooms r on r.id = ret.room_id
       join public.exam_types et on et.id = ret.exam_type_id
      where et.tenant_id = '${env.tenant}' and et.code = '${codigo}'
      order by r.name`,
  );
  return r.rows.map((x) => x.name);
};

const salaPadraoDe = async (codigo: string) => {
  const r = await env.um<{ name: string | null }>(
    `select r.name
       from public.exam_types et
       left join public.rooms r on r.id = et.default_room_id
      where et.tenant_id = '${env.tenant}' and et.code = '${codigo}'`,
  );
  return r.name;
};

describe('vínculo de sala alinhado com a sala padrão', () => {
  it('nenhum exame fica vinculado a uma sala diferente da sua', async () => {
    // Era exatamente o caso da dinamometria: padrão Sala 7, vínculo Sala 5.
    const r = await env.db.query<{ code: string }>(
      `select et.code
         from public.room_exam_types ret
         join public.exam_types et on et.id = ret.exam_type_id
        where et.tenant_id = '${env.tenant}'
          and et.default_room_id is not null
          and ret.room_id <> et.default_room_id`,
    );
    expect(r.rows).toEqual([]);
  });

  it('todo exame com sala padrão tem o vínculo dela', async () => {
    const r = await env.db.query<{ code: string }>(
      `select et.code
         from public.exam_types et
        where et.tenant_id = '${env.tenant}'
          and et.default_room_id is not null
          and et.is_active and et.deleted_at is null
          and not exists (
            select 1 from public.room_exam_types ret
             where ret.exam_type_id = et.id and ret.room_id = et.default_room_id)`,
    );
    expect(r.rows).toEqual([]);
  });
});

describe('trocar a sala de um exame arrasta o vínculo', () => {
  it('mover para outra sala deixa só o vínculo novo', async () => {
    const audio = await salaPadraoDe('AUDIO');
    expect(audio).not.toBeNull();

    const outra = await env.um<{ id: string; name: string }>(
      `select r.id, r.name from public.rooms r
        where r.tenant_id = '${env.tenant}' and r.kind = 'exame'
          and r.name is distinct from '${audio}'
        limit 1`,
    );

    await env.db.exec(
      `update public.exam_types set default_room_id = '${outra.id}'
        where tenant_id = '${env.tenant}' and code = 'AUDIO'`,
    );

    expect(await salasDe('AUDIO')).toEqual([outra.name]);
  });

  it('tirar a sala remove o vínculo', async () => {
    await env.db.exec(
      `update public.exam_types set default_room_id = null
        where tenant_id = '${env.tenant}' and code = 'AUDIO'`,
    );
    expect(await salasDe('AUDIO')).toEqual([]);
  });

  it('não mexe em exame cuja sala não mudou', async () => {
    const antes = await salasDe('EEG');
    await env.db.exec(
      `update public.exam_types set average_minutes = average_minutes
        where tenant_id = '${env.tenant}' and code = 'EEG'`,
    );
    expect(await salasDe('EEG')).toEqual(antes);
  });
});

/**
 * O efeito que a clínica vai ver.
 *
 * "a minha sala 3, que é a audiometria, mudar para, sei lá, fazer outra
 *  coisa, trocar o lugar de equipamento" -- Isabella, 25/09.
 *
 * Mexer no cadastro só vale se a fila obedecer: a sala nova tem de passar
 * a chamar, e a antiga tem de parar. Sem isto, a tela daria uma autonomia
 * que não existe.
 */
describe('mudar a sala pelo cadastro muda quem chama', () => {
  let usuario = '';
  let atendimento = '';
  let salaAntiga = '';
  let salaNova = '';

  const chamar = async (sala: string) =>
    env.como(usuario, async () =>
      env.um<{ payload: { found: boolean; exam?: { attendance_id: string } } }>(
        `select public.call_next_for_room('${env.tenant}', '${sala}') as payload`,
      ),
    );

  beforeAll(async () => {
    usuario = await env.criarUsuario('Administradora', 'remanejo@teste.com');

    salaAntiga = (
      await env.um<{ id: string }>(`
        select r.id from public.rooms r
          join public.exam_types et on et.default_room_id = r.id
         where et.tenant_id = '${env.tenant}' and et.code = 'ESPIRO'`)
    ).id;

    salaNova = (
      await env.um<{ id: string }>(`
        select id from public.rooms
         where tenant_id = '${env.tenant}' and kind = 'exame' and is_active
           and id <> '${salaAntiga}'
         order by sort_order limit 1`)
    ).id;

    const paciente = (
      await env.como(usuario, async () =>
        env.um<{ id: string }>(`
          insert into public.patients (tenant_id, full_name)
          values ('${env.tenant}', 'Paciente do remanejo') returning id`),
      )
    ).id;

    const checkin = await env.como(usuario, async () =>
      env.um<{ payload: { attendance_id: string } }>(
        `select public.checkin_patient('${env.tenant}', null, '${paciente}', 'normal', null, null) as payload`,
      ),
    );
    atendimento = checkin.payload.attendance_id;

    await env.como(usuario, async () => {
      await env.db.exec(`
        insert into public.patient_exams
          (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status, created_by)
        select '${env.tenant}', '${atendimento}', '${paciente}', et.id, et.default_room_id,
               'pendente', '${usuario}'
          from public.exam_types et
         where et.tenant_id = '${env.tenant}' and et.code = 'ESPIRO'`);
      await env.db.exec(`
        update public.attendances set stage_code = 'aguardando_exames', needs_triage = false
         where id = '${atendimento}'`);
    });
  });

  it('antes do remanejo, quem chama é a sala antiga', async () => {
    const r = await chamar(salaAntiga);
    expect(r.payload.found).toBe(true);
    expect(r.payload.exam?.attendance_id).toBe(atendimento);

    // Devolve para a fila, para o resto do teste começar limpo.
    await env.como(usuario, async () => {
      await env.db.exec(`
        update public.patient_exams set status = 'pendente', called_at = null
         where attendance_id = '${atendimento}'`);
      await env.db.exec(`
        update public.attendances set stage_code = 'aguardando_exames', in_service = false,
               current_room_id = null where id = '${atendimento}'`);
      await env.db.exec(`
        update public.rooms set status = 'disponivel', current_attendance_id = null
         where id = '${salaAntiga}'`);
    });
  });

  it('depois do remanejo, quem chama é a sala nova', async () => {
    // O que a tela de Salas e exames faz ao trocar a sala do exame.
    await env.como(usuario, async () => {
      await env.db.exec(`
        update public.exam_types set default_room_id = '${salaNova}'
         where tenant_id = '${env.tenant}' and code = 'ESPIRO'`);
      // O exame já pedido continua apontando para a sala antiga; a tela de
      // filas usa a sala padrão quando a chamada acontece.
      await env.db.exec(`
        update public.patient_exams pe set room_id = null
          from public.exam_types et
         where et.id = pe.exam_type_id and et.code = 'ESPIRO'
           and pe.attendance_id = '${atendimento}'`);
    });

    const nova = await chamar(salaNova);
    expect(nova.payload.found).toBe(true);
    expect(nova.payload.exam?.attendance_id).toBe(atendimento);
  });

  it('e a sala antiga para de chamar', async () => {
    const r = await chamar(salaAntiga);
    expect(r.payload.found).toBe(false);
  });
});
