import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

/**
 * O gatilho que move o atendimento quando os exames acabam.
 *
 * "a consulta clinica ocupacional e a propria avaliacao com o medico.
 *  entao o paciente so deve passar pelo medico se o icone 'consulta
 *  clinica ocupacional' estiver ticado. se nao, ele finaliza os exames e
 *  pode ir embora (acontece casos do paciente ir la apenas para fazer
 *  eletroencefalo por exemplo e nao precisar ir pro medico)"
 *                                               -- Isabella, 17/09/2026
 *
 * Roda contra Postgres de verdade porque a regra vive num trigger: testar
 * o TypeScript em volta nao provaria nada sobre o que o banco faz.
 */

let env: Ambiente;

beforeAll(async () => {
  env = await montarAmbiente();
});

afterAll(async () => {
  await env.fechar();
});

/** Cria um atendimento em exames com os exames pedidos. */
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
      `insert into public.patient_exams (tenant_id, attendance_id, patient_id, exam_type_id, status)
       select '${env.tenant}', '${atendimento.id}', '${paciente.id}', et.id, 'pendente'
         from public.exam_types et
        where et.tenant_id = '${env.tenant}' and et.code = '${codigo}'`,
    );
  }

  return atendimento.id;
}

async function etapaDe(id: string): Promise<string> {
  const r = await env.um<{ stage_code: string }>(
    `select stage_code from public.attendances where id = '${id}'`,
  );
  return r.stage_code;
}

async function mudarStatus(id: string, codigo: string, status: string) {
  await env.db.exec(
    `update public.patient_exams pe
        set status = '${status}'
       from public.exam_types et
      where et.id = pe.exam_type_id
        and pe.attendance_id = '${id}'
        and et.code = '${codigo}'`,
  );
}

describe('so vai ao medico quem tem consulta marcada', () => {
  it('sem consulta clinica: termina os exames e segue para o pagamento', async () => {
    // O caso que a clinica citou: veio so fazer um eletroencefalograma.
    const at = await montarAtendimento(['EEG']);
    await mudarStatus(at, 'EEG', 'concluido');
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });

  it('com consulta clinica: vai para o consultorio', async () => {
    const at = await montarAtendimento(['EEG', 'CLINICO']);
    await mudarStatus(at, 'EEG', 'concluido');
    expect(await etapaDe(at)).toBe('aguardando_medico');
  });

  it('a consulta nao segura a saida das filas', async () => {
    // A consulta e um item de patient_exams e fica pendente ate o medico
    // atender. Se contasse como exame de fila, o paciente ficaria preso em
    // aguardando_exames para sempre -- ninguem concluiria o que ainda nao
    // aconteceu.
    const at = await montarAtendimento(['AUDIO', 'CLINICO']);
    await mudarStatus(at, 'AUDIO', 'concluido');
    expect(await etapaDe(at)).toBe('aguardando_medico');

    const consulta = await env.um<{ status: string }>(
      `select pe.status from public.patient_exams pe
         join public.exam_types et on et.id = pe.exam_type_id
        where pe.attendance_id = '${at}' and et.code = 'CLINICO'`,
    );
    expect(consulta.status).toBe('pendente');
  });

  it('exame ainda pendente mantem o paciente nas filas', async () => {
    const at = await montarAtendimento(['EEG', 'AUDIO']);
    await mudarStatus(at, 'EEG', 'concluido');
    expect(await etapaDe(at)).toBe('aguardando_exames');
  });

  it('exame em andamento coloca o atendimento em exames', async () => {
    const at = await montarAtendimento(['EEG', 'AUDIO']);
    await mudarStatus(at, 'EEG', 'em_andamento');
    expect(await etapaDe(at)).toBe('em_exames');
  });

  it('so muda de etapa quando o ultimo exame termina', async () => {
    const at = await montarAtendimento(['EEG', 'AUDIO', 'ECG']);
    await mudarStatus(at, 'EEG', 'concluido');
    await mudarStatus(at, 'AUDIO', 'concluido');
    expect(await etapaDe(at)).toBe('aguardando_exames');
    await mudarStatus(at, 'ECG', 'concluido');
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });

  it('exame nao realizado tambem libera a etapa', async () => {
    // Paciente que nao fez o exame nao pode ficar preso na fila.
    const at = await montarAtendimento(['EEG']);
    await mudarStatus(at, 'EEG', 'nao_realizado');
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });
});
