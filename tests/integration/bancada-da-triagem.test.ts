/**
 * A bancada da triagem nao pode prender o paciente.
 *
 * "todos os pacientes tao ficando presos na triagem mesmo depois de clicar
 *  em concluir triagem"
 * "finalizei todos os exames salvei as fichas e o paciente nao foi pro
 *  modulo medico e sumiu do fluxo"
 *                                              -- Isabella, 21/09
 *
 * Acuidade, visao de cores, Romberg e fadiga sao feitos na mesa da
 * triagem. Sao exames como os outros, mas la nao ha chamada de sala nem
 * botao de concluir: preencher a ficha e fazer o exame.
 *
 * Salvar a ficha nunca mudava o status do exame. Ele ficava 'pendente'
 * para sempre e, desde 15/09 — quando as salas de triagem sairam do quadro
 * de Filas —, nao havia sala nenhuma que pudesse chama-lo. O paciente
 * ficava parado com "exames 0/15".
 *
 * Este teste percorre o caminho inteiro e, a cada passo, pergunta a mesma
 * coisa: alguma tela mostra este paciente?
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;
let usuario = '';
let paciente = '';
let atendimento = '';
let salaTriagem = '';

const um = <T,>(sql: string) => amb.um<T>(sql);
const linhas = async <T,>(sql: string): Promise<T[]> => (await amb.db.query<T>(sql)).rows;
const como = <T,>(fn: () => Promise<T>) => amb.como(usuario, fn);

/** Exames de bancada do atendimento que ainda nao foram feitos. */
async function bancadaPorFazer(): Promise<string[]> {
  const r = await linhas<{ code: string }>(`
    select et.code from public.patient_exams pe
      join public.exam_types et on et.id = pe.exam_type_id
      join public.rooms r on r.id = et.default_room_id
     where pe.attendance_id = '${atendimento}' and r.kind = 'triagem'
       and pe.status in ('pendente','em_fila','chamado','em_andamento')
     order by et.code`);
  return r.map((x) => x.code);
}

/**
 * As telas em que este paciente aparece agora.
 *
 * E a pergunta que importa: um paciente que nao esta em tela nenhuma esta
 * perdido, por mais correto que o banco esteja.
 */
async function telasQueMostram(): Promise<string[]> {
  const a = await um<{ etapa: string }>(
    `select stage_code as etapa from public.attendances where id = '${atendimento}'`,
  );
  const pendentesDeBancada = (await bancadaPorFazer()).length > 0;
  const telas: string[] = [];

  // Triagem: quem foi encaminhado, mais quem tem bancada por fazer.
  if (
    ['aguardando_triagem', 'em_triagem'].includes(a.etapa) ||
    (a.etapa === 'aguardando_exames' && pendentesDeBancada)
  ) {
    telas.push('triagem');
  }

  // Filas e salas: exame de sala que nao seja de bancada.
  const emSala = await um<{ total: number }>(`
    select count(*)::int as total from public.patient_exams pe
      join public.exam_types et on et.id = pe.exam_type_id
      left join public.rooms r on r.id = et.default_room_id
     where pe.attendance_id = '${atendimento}' and et.ocupa_sala
       and coalesce(r.kind, '') <> 'triagem'
       and pe.status in ('pendente','em_fila','chamado','em_andamento')`);
  if (['aguardando_exames', 'em_exames'].includes(a.etapa) && emSala.total > 0) {
    telas.push('filas');
  }

  if (a.etapa === 'aguardando_medico') telas.push('medico');
  if (a.etapa === 'em_consulta') telas.push('consultorio');
  if (a.etapa === 'aguardando_pagamento') telas.push('pagamentos');
  if (['na_recepcao', 'aguardando_recepcao'].includes(a.etapa)) telas.push('recepcao');
  if (a.etapa === 'finalizado') telas.push('encerrado');

  return telas;
}

/** Preenche a ficha do exame como a tela de Triagem passou a fazer. */
async function preencherNaBancada(codigo: string): Promise<void> {
  const exame = await um<{ id: string; patient_id: string; started_at: string | null }>(`
    select pe.id, pe.patient_id, pe.started_at::text
      from public.patient_exams pe
      join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = '${atendimento}' and et.code = '${codigo}'`);

  await como(async () => {
    await amb.db.exec(`
      insert into public.exam_results
        (tenant_id, patient_exam_id, patient_id, professional_id, values, conclusion, created_by)
      values ('${amb.tenant}', '${exame.id}', '${exame.patient_id}', '${usuario}',
              '{"od":"20/20","oe":"20/20"}'::jsonb, 'Normal', '${usuario}')
      on conflict do nothing`);

    // O que `saveExamResult` com `concluir` faz.
    await amb.db.exec(`
      update public.patient_exams
         set status = 'concluido',
             started_at = coalesce(started_at, now()),
             finished_at = now(),
             professional_id = '${usuario}',
             updated_by = '${usuario}'
       where id = '${exame.id}' and status not in ('concluido','cancelado','nao_realizado')`);
  });
}

beforeAll(async () => {
  amb = await montarAmbiente();
  usuario = await amb.criarUsuario('Examinadora', 'bancada@teste.com');

  salaTriagem = (
    await um<{ id: string }>(
      `select id from public.rooms where tenant_id = '${amb.tenant}' and kind = 'triagem' and is_active order by sort_order limit 1`,
    )
  ).id;

  paciente = (
    await como(async () =>
      um<{ id: string }>(`
        insert into public.patients (tenant_id, full_name, cpf, birth_date)
        values ('${amb.tenant}', 'Izabella de Oliveira', '52998224725', '2002-04-18')
        returning id`),
    )
  ).id;

  const checkin = await como(async () =>
    um<{ payload: { attendance_id: string } }>(
      `select public.checkin_patient('${amb.tenant}', null, '${paciente}', 'normal', null, null) as payload`,
    ),
  );
  atendimento = checkin.payload.attendance_id;

  // Recepcao: acuidade e cores (bancada), audiometria (sala) e a consulta.
  await como(async () => {
    await amb.db.exec(`
      insert into public.patient_exams
        (tenant_id, attendance_id, patient_id, exam_type_id, room_id, sort_order, status, created_by)
      select '${amb.tenant}', '${atendimento}', '${paciente}', et.id, et.default_room_id,
             et.sort_order, 'pendente', '${usuario}'
        from public.exam_types et
       where et.tenant_id = '${amb.tenant}'
         and et.code in ('ACUIDADE','ISHIHARA','AUDIO','CLINICO')`);

    // Com exame de bancada, a recepcao encaminha para a triagem.
    await amb.db.exec(`
      update public.attendances
         set stage_code = 'aguardando_triagem', needs_triage = true,
             origin_kind = 'particular', procedure_code = 'consulta_ocupacional',
             reception_finished_at = now(), updated_by = '${usuario}'
       where id = '${atendimento}'`);
  });
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

describe('o paciente nunca fica sem tela', () => {
  it('depois da recepcao, esta na triagem', async () => {
    expect(await telasQueMostram()).toEqual(['triagem']);
    expect(await bancadaPorFazer()).toEqual(['ACUIDADE', 'ISHIHARA']);
  });

  it('chamado para a triagem, continua na triagem', async () => {
    await como(async () => {
      await amb.db.exec(`
        update public.attendances
           set stage_code = 'em_triagem', current_room_id = '${salaTriagem}', in_service = true
         where id = '${atendimento}'`);
      await amb.db.exec(`
        update public.rooms set status = 'ocupada', current_attendance_id = '${atendimento}'
         where id = '${salaTriagem}'`);
    });
    expect(await telasQueMostram()).toEqual(['triagem']);
  });

  it('preencher a primeira ficha da bancada nao tira o paciente da triagem', async () => {
    await preencherNaBancada('ACUIDADE');

    const etapa = await um<{ etapa: string }>(
      `select stage_code as etapa from public.attendances where id = '${atendimento}'`,
    );
    // Era aqui que ele sumia: o gatilho dos exames o jogava em 'em_exames'.
    expect(etapa.etapa).toBe('em_triagem');
    expect(await telasQueMostram()).toEqual(['triagem']);
  });

  it('salvar a ficha conclui o exame — era o defeito', async () => {
    const e = await um<{ status: string; tem_ficha: boolean }>(`
      select pe.status::text,
             exists (select 1 from public.exam_results er where er.patient_exam_id = pe.id) as tem_ficha
        from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
       where pe.attendance_id = '${atendimento}' and et.code = 'ACUIDADE'`);
    expect(e.tem_ficha).toBe(true);
    expect(e.status).toBe('concluido');
  });

  it('com a segunda ficha preenchida, a bancada acaba', async () => {
    await preencherNaBancada('ISHIHARA');
    expect(await bancadaPorFazer()).toEqual([]);
    // A triagem ainda nao foi finalizada: o paciente continua ali.
    expect(await telasQueMostram()).toEqual(['triagem']);
  });

  it('finalizar a triagem manda o paciente para a fila de exames', async () => {
    await como(async () => {
      await amb.db.exec(`
        insert into public.triages
          (tenant_id, attendance_id, patient_id, professional_id, blood_pressure_systolic,
           blood_pressure_diastolic, weight_kg, height_cm, created_by)
        values ('${amb.tenant}', '${atendimento}', '${paciente}', '${usuario}',
                118, 76, 62.0, 165.0, '${usuario}')`);
      await amb.db.exec(`
        update public.triages set finished_at = now(), updated_by = '${usuario}'
         where attendance_id = '${atendimento}'`);
    });

    const a = await um<{ etapa: string; in_service: boolean; sala: string | null }>(
      `select stage_code as etapa, in_service, current_room_id::text as sala
         from public.attendances where id = '${atendimento}'`,
    );
    expect(a.etapa).toBe('aguardando_exames');
    expect(a.in_service).toBe(false);
    expect(a.sala).toBeNull();
    expect(await telasQueMostram()).toEqual(['filas']);
  });

  it('a sala de triagem volta a ficar livre', async () => {
    const r = await um<{ status: string; preso: string | null }>(
      `select status::text, current_attendance_id::text as preso from public.rooms where id = '${salaTriagem}'`,
    );
    expect(r.status).toBe('disponivel');
    expect(r.preso).toBeNull();
  });

  it('a audiometria pode ser chamada normalmente', async () => {
    const sala = await um<{ id: string }>(`
      select r.id from public.rooms r
        join public.exam_types et on et.default_room_id = r.id
       where et.tenant_id = '${amb.tenant}' and et.code = 'AUDIO'`);

    const chamada = await como(async () =>
      um<{ payload: { found: boolean; exam: { id: string } } }>(
        `select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`,
      ),
    );
    expect(chamada.payload.found).toBe(true);

    await como(async () => {
      await amb.db.exec(`
        update public.patient_exams set status = 'concluido', started_at = now(), finished_at = now()
         where id = '${chamada.payload.exam.id}'`);
    });
  });

  it('terminados os exames, vai ao medico — nao some do fluxo', async () => {
    const a = await um<{ etapa: string }>(
      `select stage_code as etapa from public.attendances where id = '${atendimento}'`,
    );
    expect(a.etapa).toBe('aguardando_medico');
    expect(await telasQueMostram()).toEqual(['medico']);
  });

  it('nenhum exame ficou pendente sem sala que o chame', async () => {
    const r = await linhas<{ code: string }>(`
      select et.code from public.patient_exams pe
        join public.exam_types et on et.id = pe.exam_type_id
        left join public.rooms r on r.id = et.default_room_id
       where pe.attendance_id = '${atendimento}'
         and pe.status in ('pendente','em_fila','chamado','em_andamento')
         and et.ocupa_sala
         and coalesce(r.kind, '') = 'triagem'`);
    expect(r.map((x) => x.code)).toEqual([]);
  });
});

describe('o conserto do que ja estava preso', () => {
  let travado = '';

  beforeAll(async () => {
    // Reproduz o estado da clinica: ficha preenchida, exame pendente,
    // triagem concluida e o paciente parado.
    const p = await como(async () =>
      um<{ id: string }>(`
        insert into public.patients (tenant_id, full_name, cpf)
        values ('${amb.tenant}', 'Caique de Oliveira Silva', '11144477735') returning id`),
    );
    const checkin = await como(async () =>
      um<{ payload: { attendance_id: string } }>(
        `select public.checkin_patient('${amb.tenant}', null, '${p.id}', 'normal', null, null) as payload`,
      ),
    );
    travado = checkin.payload.attendance_id;

    await como(async () => {
      await amb.db.exec(`
        insert into public.patient_exams
          (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status, created_by)
        select '${amb.tenant}', '${travado}', '${p.id}', et.id, et.default_room_id, 'pendente', '${usuario}'
          from public.exam_types et
         where et.tenant_id = '${amb.tenant}' and et.code in ('ACUIDADE','CLINICO')`);

      // A ficha foi salva, mas o exame nunca foi concluido.
      await amb.db.exec(`
        insert into public.exam_results
          (tenant_id, patient_exam_id, patient_id, professional_id, values, conclusion, created_by)
        select '${amb.tenant}', pe.id, '${p.id}', '${usuario}', '{"od":"20/20"}'::jsonb, 'Normal', '${usuario}'
          from public.patient_exams pe
          join public.exam_types et on et.id = pe.exam_type_id
         where pe.attendance_id = '${travado}' and et.code = 'ACUIDADE'`);

      await amb.db.exec(`
        update public.attendances set stage_code = 'em_triagem', in_service = true,
               current_room_id = '${salaTriagem}'
         where id = '${travado}'`);
      await amb.db.exec(`
        update public.rooms set status = 'ocupada', current_attendance_id = '${travado}'
         where id = '${salaTriagem}'`);

      // Triagem concluida sem que o paciente saisse dali.
      await amb.db.exec(`
        insert into public.triages (tenant_id, attendance_id, patient_id, professional_id, created_by)
        values ('${amb.tenant}', '${travado}', '${p.id}', '${usuario}', '${usuario}')`);
      await amb.db.exec(`
        update public.triages set finished_at = now() where attendance_id = '${travado}'`);
      await amb.db.exec(`
        update public.attendances set stage_code = 'em_triagem', in_service = true,
               current_room_id = '${salaTriagem}'
         where id = '${travado}'`);
    });
  });

  it('antes do conserto, o paciente esta preso', async () => {
    const a = await um<{ etapa: string; pendentes: number }>(`
      select a.stage_code as etapa,
             (select count(*)::int from public.patient_exams pe
               where pe.attendance_id = a.id and pe.status = 'pendente') as pendentes
        from public.attendances a where a.id = '${travado}'`);
    expect(a.etapa).toBe('em_triagem');
    expect(a.pendentes).toBe(2);
  });

  it('o script conclui a bancada com ficha e devolve o paciente ao fluxo', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0035_destrava_quem_ficou_preso_na_bancada.sql'),
      'utf8',
    );
    await amb.db.exec(sql);

    const a = await um<{
      etapa: string;
      acuidade: string;
      in_service: boolean;
      sala: string | null;
    }>(`
      select a.stage_code as etapa, a.in_service, a.current_room_id::text as sala,
             (select pe.status::text from public.patient_exams pe
                join public.exam_types et on et.id = pe.exam_type_id
               where pe.attendance_id = a.id and et.code = 'ACUIDADE') as acuidade
        from public.attendances a where a.id = '${travado}'`);

    expect(a.acuidade).toBe('concluido');
    expect(a.etapa).toBe('aguardando_medico');
    expect(a.in_service).toBe(false);
    expect(a.sala).toBeNull();
  });

  it('rodar o script de novo nao muda nada', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0035_destrava_quem_ficou_preso_na_bancada.sql'),
      'utf8',
    );
    await amb.db.exec(sql);

    const a = await um<{ etapa: string }>(
      `select stage_code as etapa from public.attendances where id = '${travado}'`,
    );
    expect(a.etapa).toBe('aguardando_medico');
  });

  it('nenhuma sala ficou presa a quem ja saiu', async () => {
    const r = await linhas<{ name: string }>(`
      select r.name from public.rooms r
        join public.attendances a on a.id = r.current_attendance_id
       where a.stage_code not in ('em_triagem','em_exames','em_consulta')`);
    expect(r.map((x) => x.name)).toEqual([]);
  });
});

/**
 * O caminho de cima prova que o banco se comporta. Estas quatro conferem
 * que a APLICACAO continua fazendo a sua parte.
 *
 * Sao leituras do codigo-fonte, e isso e feio de proposito: a ligacao entre
 * a tela e a acao nao tem como ser exercitada aqui dentro, e foi
 * exatamente ela que faltou por seis dias. Se alguem apagar uma destas
 * linhas, o teste cai — que e tudo o que se pede dele.
 */
describe('a aplicacao continua fechando o exame da bancada', () => {
  const ler = async (caminho: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(process.cwd(), caminho), 'utf8');
  };

  it('a tela de Triagem manda concluir ao salvar', async () => {
    const fonte = await ler('src/app/(painel)/triagem/workspace.tsx');
    expect(fonte).toContain('concluirAoSalvar');
  });

  it('a ficha repassa o pedido de concluir para a acao', async () => {
    const fonte = await ler('src/modules/clinical/ficha-de-exame.tsx');
    expect(fonte).toMatch(/saveExamResult\([\s\S]*concluirAoSalvar/);
  });

  it('a acao muda o status do exame, nao so grava a ficha', async () => {
    const fonte = await ler('src/modules/clinical/actions.ts');
    expect(fonte).toMatch(/from\('patient_exams'\)[\s\S]{0,200}status: 'concluido'/);
  });

  it('finalizar a triagem encaminha o paciente pela propria acao', async () => {
    const fonte = await ler('src/modules/clinical/actions.ts');
    expect(fonte).toContain('encaminharDepoisDaTriagem');
  });

  it('salvar uma correcao nao desfaz o que ja foi concluido', async () => {
    // Valia para a triagem e para a consulta: gravar de novo zerava o
    // `finished_at`. Quem assinasse e depois corrigisse uma observacao
    // desfazia a propria conclusao, sem aviso nenhum.
    const fonte = await ler('src/modules/clinical/actions.ts');
    expect(fonte).not.toMatch(/finished_at: finish \? new Date\(\)\.toISOString\(\) : null/);
    expect(fonte).not.toMatch(/signed_at: finish \? new Date\(\)\.toISOString\(\) : null/);
  });

  it('o quadro de Filas continua com o botao de concluir proprio', async () => {
    // A bancada conclui ao salvar; a sala, nao. Trocar isso faria o
    // operador fechar o exame sem querer ao anotar um valor no meio.
    const fonte = await ler('src/app/(painel)/filas/rooms-board.tsx');
    expect(fonte).toContain('updateExamStatus');
    expect(fonte).not.toContain('concluirAoSalvar');
  });
});
