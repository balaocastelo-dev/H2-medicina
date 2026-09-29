/**
 * O que o medico responde na consulta.
 *
 * "o teste de romberg tem que mudar para ser realizado na aba medica"
 *                                              -- Isabella, 28/09.
 *
 * Ate 0042 essa lista era `et.code in ('CLINICO','PSICO')`, copiada em
 * quatro funcoes e mais uma constante do TypeScript. Ela mudou duas vezes em
 * uma semana, e errar UMA das copias nao da erro: so deixa o paciente numa
 * fila onde ninguem vai chama-lo -- exatamente o que aconteceu em 15/09.
 *
 * Agora quem manda e a coluna `exam_types.respondido_pelo_medico`. Este
 * teste cobra as duas coisas que a coluna precisa garantir: que o banco e o
 * codigo digam o mesmo, e que o paciente chegue ao consultorio.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';
import { RESPONDIDOS_PELO_MEDICO } from '@/modules/queue/origin-kind';

let amb: Ambiente;
let usuario = '';

beforeAll(async () => {
  amb = await montarAmbiente();
  usuario = await amb.criarUsuario('Administradora', 'romberg@teste.com');
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

describe('o cadastro e o código dizem a mesma coisa', () => {
  it('a coluna lista exatamente os códigos da constante', async () => {
    const r = await amb.db.query<{ code: string }>(
      `select code from public.exam_types
        where tenant_id = '${amb.tenant}' and respondido_pelo_medico
        order by code`,
    );
    expect(r.rows.map((x) => x.code)).toEqual([...RESPONDIDOS_PELO_MEDICO].sort());
  });

  it('nenhum deles ocupa sala', async () => {
    // Ocupar sala e ser respondido pelo medico sao coisas que se excluem.
    // Um exame nos dois estados entra numa fila que ninguem opera.
    const r = await amb.db.query<{ code: string }>(
      `select code from public.exam_types
        where tenant_id = '${amb.tenant}'
          and respondido_pelo_medico and coalesce(ocupa_sala, true)`,
    );
    expect(r.rows).toEqual([]);
  });

  it('nenhum deles é chamado por uma sala de exame ou de triagem', async () => {
    // A consulta clinica aponta para o consultorio, e isso esta certo: e
    // onde ela acontece. O que nao pode existir e vinculo com sala de exame
    // ou de bancada -- e dai que sai a chamada que ninguem atende.
    const r = await amb.db.query<{ code: string }>(
      `select et.code from public.exam_types et
        left join public.rooms rp on rp.id = et.default_room_id
        where et.tenant_id = '${amb.tenant}' and et.respondido_pelo_medico
          and (rp.kind in ('exame','triagem')
               or exists (select 1 from public.room_exam_types ret
                           join public.rooms r on r.id = ret.room_id
                          where ret.exam_type_id = et.id
                            and r.kind in ('exame','triagem')))`,
    );
    expect(r.rows).toEqual([]);
  });

  it('o Romberg está entre eles', async () => {
    // A frase da Isabella, virada em asserção.
    const r = await amb.um<{ respondido_pelo_medico: boolean }>(
      `select respondido_pelo_medico from public.exam_types
        where tenant_id = '${amb.tenant}' and code = 'ROMBERG'`,
    );
    expect(r.respondido_pelo_medico).toBe(true);
  });
});

describe('quem só tem Romberg chega ao consultório', () => {
  let atendimento = '';
  let exame = '';

  beforeAll(async () => {
    const paciente = (
      await amb.como(usuario, async () =>
        amb.um<{ id: string }>(`
          insert into public.patients (tenant_id, full_name)
          values ('${amb.tenant}', 'Paciente do Romberg') returning id`),
      )
    ).id;

    const checkin = await amb.como(usuario, async () =>
      amb.um<{ payload: { attendance_id: string } }>(
        `select public.checkin_patient('${amb.tenant}', null, '${paciente}', 'normal', null, null) as payload`,
      ),
    );
    atendimento = checkin.payload.attendance_id;

    await amb.como(usuario, async () => {
      exame = (
        await amb.um<{ id: string }>(`
          insert into public.patient_exams
            (tenant_id, attendance_id, patient_id, exam_type_id, status, created_by)
          select '${amb.tenant}', '${atendimento}', '${paciente}', et.id, 'pendente', '${usuario}'
            from public.exam_types et
           where et.tenant_id = '${amb.tenant}' and et.code = 'ROMBERG'
          returning id`)
      ).id;
      await amb.db.exec(`
        update public.attendances set stage_code = 'aguardando_exames', needs_triage = false
         where id = '${atendimento}'`);
    });
  });

  it('nenhuma sala de exame o chama', async () => {
    // Era o risco do dia: tirar o exame da bancada sem mandar o paciente ao
    // medico o deixaria esperando uma chamada que nao vem de lugar nenhum.
    const salas = await amb.db.query<{ id: string }>(
      `select id from public.rooms
        where tenant_id = '${amb.tenant}' and kind in ('exame','triagem') and is_active`,
    );
    for (const sala of salas.rows) {
      const r = await amb.como(usuario, async () =>
        amb.um<{ payload: { found: boolean } }>(
          `select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`,
        ),
      );
      expect(r.payload.found).toBe(false);
    }
  });

  it('o gatilho o manda para a fila do médico', async () => {
    // Um toque em qualquer exame do atendimento faz o gatilho recontar.
    await amb.como(usuario, async () => {
      await amb.db.exec(
        `update public.patient_exams set status = 'em_fila' where id = '${exame}'`,
      );
      await amb.db.exec(
        `update public.patient_exams set status = 'pendente' where id = '${exame}'`,
      );
    });

    const a = await amb.um<{ stage_code: string }>(
      `select stage_code from public.attendances where id = '${atendimento}'`,
    );
    expect(a.stage_code).toBe('aguardando_medico');
  });

  it('assinar a consulta conclui o Romberg que ficou em branco', async () => {
    // Se o medico preencheu a ficha, o exame ja esta concluido e isto nao
    // faz nada. Se ele nao preencheu, o item nao pode ficar pendente para
    // sempre num atendimento assinado.
    await amb.como(usuario, async () => {
      await amb.db.exec(`
        insert into public.medical_consultations
          (tenant_id, attendance_id, patient_id, doctor_id, verdict)
        select '${amb.tenant}', '${atendimento}', a.patient_id, '${usuario}', 'apto'
          from public.attendances a where a.id = '${atendimento}'`);
      await amb.db.exec(`
        update public.medical_consultations set finished_at = now()
         where attendance_id = '${atendimento}'`);
    });

    const e = await amb.um<{ status: string }>(
      `select status from public.patient_exams where id = '${exame}'`,
    );
    expect(e.status).toBe('concluido');
  });
});
