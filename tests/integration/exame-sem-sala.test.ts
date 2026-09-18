import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

/**
 * Exame que nao ocupa sala da clinica.
 *
 * A clinica relatou tres sintomas em 18/09 que sao o mesmo defeito:
 *   "consulta clinica ocupacional nao esta direcionando para modulo
 *    medico, fica sem sala"
 *   "raio x tambem esta ficando preso sem sala perdido no processo"
 *   "sem pacientes na fila e mesmo assim mostrando paciente ali"
 *
 * Consulta e raio X entravam na fila de salas com sala nula: nenhum cartao
 * os mostrava e nenhum botao os alcancava. O paciente ficava preso.
 */

let env: Ambiente;
let operador: string;

beforeAll(async () => {
  env = await montarAmbiente();
  // A RPC exige permissão de operar filas: sem usuário ela recusa.
  operador = await env.criarUsuario('Examinador', 'examinador@h2.test');
});

afterAll(async () => {
  await env.fechar();
});

async function montarAtendimento(codigos: string[]): Promise<string> {
  const paciente = await env.um<{ id: string }>(
    `insert into public.patients (tenant_id, full_name)
     values ('${env.tenant}', 'Paciente Teste') returning id`,
  );
  const atendimento = await env.um<{ id: string }>(
    `insert into public.attendances (tenant_id, patient_id, checkin_at, stage_code)
     values ('${env.tenant}', '${paciente.id}', now(), 'aguardando_exames') returning id`,
  );
  for (const codigo of codigos) {
    await env.db.exec(
      `insert into public.patient_exams
         (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status)
       select '${env.tenant}', '${atendimento.id}', '${paciente.id}', et.id,
              et.default_room_id, 'pendente'
         from public.exam_types et
        where et.tenant_id = '${env.tenant}' and et.code = '${codigo}'`,
    );
  }
  return atendimento.id;
}

const etapaDe = async (id: string) =>
  (
    await env.um<{ stage_code: string }>(
      `select stage_code from public.attendances where id = '${id}'`,
    )
  ).stage_code;

describe('coluna ocupa_sala', () => {
  it('marca consulta e raio X como fora das salas', async () => {
    const r = await env.db.query<{ code: string; ocupa_sala: boolean }>(
      `select code, ocupa_sala from public.exam_types
        where tenant_id = '${env.tenant}' order by code`,
    );
    const mapa = Object.fromEntries(r.rows.map((x) => [x.code, x.ocupa_sala]));
    expect(mapa.CLINICO).toBe(false);
    expect(mapa.RAIOX).toBe(false);
  });

  it('a coleta laboratorial continua ocupando sala — ela é feita aqui', async () => {
    // Erro meu ate 18/09: eu tinha tirado a coleta das filas junto com o
    // raio X. O sangue e colhido na Sala 5 da propria clinica.
    const r = await env.um<{ ocupa_sala: boolean }>(
      `select ocupa_sala from public.exam_types
        where tenant_id = '${env.tenant}' and code = 'LAB'`,
    );
    expect(r.ocupa_sala).toBe(true);
  });

  it('audiometria e os demais exames de sala continuam na fila', async () => {
    const r = await env.db.query<{ code: string }>(
      `select code from public.exam_types
        where tenant_id = '${env.tenant}' and ocupa_sala = false order by code`,
    );
    expect(r.rows.map((x) => x.code).sort()).toEqual(['CLINICO', 'RAIOX']);
  });
});

describe('o paciente nao fica preso', () => {
  it('só raio X: não entra em fila nenhuma e segue para o pagamento', async () => {
    const at = await montarAtendimento(['AUDIO', 'RAIOX']);
    await env.db.exec(
      `update public.patient_exams pe set status = 'concluido'
         from public.exam_types et
        where et.id = pe.exam_type_id and pe.attendance_id = '${at}' and et.code = 'AUDIO'`,
    );
    // O raio X continua pendente — é o registro de que foi pedido — mas
    // não segura o paciente.
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });

  it('com consulta clínica: vai ao médico mesmo com raio X pendente', async () => {
    const at = await montarAtendimento(['AUDIO', 'RAIOX', 'CLINICO']);
    await env.db.exec(
      `update public.patient_exams pe set status = 'concluido'
         from public.exam_types et
        where et.id = pe.exam_type_id and pe.attendance_id = '${at}' and et.code = 'AUDIO'`,
    );
    expect(await etapaDe(at)).toBe('aguardando_medico');
  });

  it('chamar o próximo nunca traz consulta nem raio X', async () => {
    const at = await montarAtendimento(['RAIOX', 'CLINICO']);
    const sala = await env.um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${env.tenant}' and kind = 'exame' limit 1`,
    );
    await env.db.exec(`update public.attendances set stage_code = 'aguardando_exames' where id = '${at}'`);

    const r = await env.como(operador, () =>
      env.um<{ call_next_for_room: { found: boolean } }>(
        `select public.call_next_for_room('${env.tenant}', '${sala.id}')`,
      ),
    );
    expect(r.call_next_for_room.found).toBe(false);
  });
});

describe('uma chamada leva todos os exames daquela sala', () => {
  it('dois exames da mesma sala são chamados de uma vez', async () => {
    // "se o paciente tem varios exames para fazer em uma sala, ao chamar
    //  ele na primeira vez ja aparecer todas as fichas"
    const sala = await env.um<{ id: string; name: string }>(
      `select id, name from public.rooms
        where tenant_id = '${env.tenant}' and kind = 'exame' limit 1`,
    );

    const paciente = await env.um<{ id: string }>(
      `insert into public.patients (tenant_id, full_name)
       values ('${env.tenant}', 'Paciente Dois Exames') returning id`,
    );
    const at = await env.um<{ id: string }>(
      `insert into public.attendances (tenant_id, patient_id, checkin_at, stage_code, in_service)
       values ('${env.tenant}', '${paciente.id}', now(), 'aguardando_exames', false) returning id`,
    );

    // Dois exames diferentes apontando para a mesma sala.
    await env.db.exec(
      `insert into public.patient_exams
         (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status)
       select '${env.tenant}', '${at.id}', '${paciente.id}', et.id, '${sala.id}', 'pendente'
         from public.exam_types et
        where et.tenant_id = '${env.tenant}' and et.ocupa_sala
        limit 2`,
    );
    await env.db.exec(
      `update public.exam_types set default_room_id = '${sala.id}'
        where tenant_id = '${env.tenant}' and id in (
          select exam_type_id from public.patient_exams where attendance_id = '${at.id}')`,
    );

    const r = await env.como(operador, () =>
      env.um<{ call_next_for_room: { found: boolean; exames_chamados: number } }>(
        `select public.call_next_for_room('${env.tenant}', '${sala.id}')`,
      ),
    );
    expect(r.call_next_for_room.found).toBe(true);
    expect(r.call_next_for_room.exames_chamados).toBe(2);

    // E uma unica chamada de TV, nao duas.
    const tv = await env.um<{ total: number }>(
      `select count(*)::int as total from public.tv_calls
        where tenant_id = '${env.tenant}' and room_name = '${sala.name}'`,
    );
    expect(tv.total).toBe(1);
  });
});
