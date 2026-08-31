/**
 * Simulacao de um dia cheio: tres medicos, salas de exame em paralelo e
 * dezenas de pacientes chegando com procedencias e prioridades misturadas.
 *
 * O percurso de um paciente so mostra que o caminho existe. O que quebra de
 * verdade numa clinica lotada e a disputa: duas salas chamando ao mesmo
 * tempo, paciente atendido em dois lugares, fila que nao esvazia, sala que
 * fica presa. E isso que este arquivo procura.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

const TOTAL_PACIENTES = 42;

/** Como a clinica recebe: a maioria particular, o resto pelos convenios. */
const PROCEDENCIAS = ['particular', 'particular', 'particular', 'estado', 'sisper', 'ingresso'];
const PRIORIDADES = ['normal', 'normal', 'normal', 'normal', 'prioritario', 'encaixe'];

let amb: Ambiente;
let recepcao = '';
const medicos: string[] = [];
const pacientes: { id: string; nome: string; procedencia: string; prioridade: string }[] = [];
let consultorios: { id: string; name: string }[] = [];
let salasDeExame: { id: string; name: string }[] = [];

beforeAll(async () => {
  amb = await montarAmbiente();

  recepcao = await amb.criarUsuario('Recepcao', 'recepcao@teste.com');
  for (let i = 1; i <= 3; i++) {
    medicos.push(await amb.criarUsuario(`Medico ${i}`, `medico${i}@teste.com`));
  }

  const empresa = (
    await amb.um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, trade_name)
      values ('${amb.tenant}', 'Transportadora Teste Ltda', 'Transportadora')
      returning id
    `)
  ).id;

  // Tres consultorios, como a clinica tem (Salas 3, 8 e 9).
  await amb.db.exec(`
    insert into public.rooms (tenant_id, code, name, kind, sort_order) values
      ('${amb.tenant}','M1','Consultorio 1','consultorio',30),
      ('${amb.tenant}','M2','Consultorio 2','consultorio',31),
      ('${amb.tenant}','M3','Consultorio 3','consultorio',32)
    on conflict (tenant_id, code) do nothing;

    insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
    select '${amb.tenant}', r.id, et.id
      from public.rooms r, public.exam_types et
     where r.tenant_id = '${amb.tenant}' and r.code in ('M1','M2','M3')
       and et.tenant_id = '${amb.tenant}' and et.code = 'CLINICO'
    on conflict do nothing;
  `);

  consultorios = (
    await amb.db.query<{ id: string; name: string }>(
      `select id, name from public.rooms where tenant_id = '${amb.tenant}' and code in ('M1','M2','M3') order by sort_order`,
    )
  ).rows;

  salasDeExame = (
    await amb.db.query<{ id: string; name: string }>(
      `select id, name from public.rooms
        where tenant_id = '${amb.tenant}' and kind = 'exame' and is_active
        order by sort_order`,
    )
  ).rows;

  // Dezenas de pacientes, com CPF valido gerado a partir do indice.
  for (let i = 0; i < TOTAL_PACIENTES; i++) {
    const nome = `Paciente ${String(i + 1).padStart(2, '0')}`;
    const { id } = await amb.como(recepcao, () =>
      amb.um<{ id: string }>(`
        insert into public.patients (tenant_id, full_name, company_id, birth_date)
        values ('${amb.tenant}', '${nome}', '${empresa}', '1985-01-01')
        returning id
      `),
    );
    pacientes.push({
      id,
      nome,
      procedencia: PROCEDENCIAS[i % PROCEDENCIAS.length]!,
      prioridade: PRIORIDADES[i % PRIORIDADES.length]!,
    });
  }
});

afterAll(async () => {
  await amb?.fechar();
});

/**
 * Quem a sala escolheria agora. Separado de `tomarPaciente` de proposito:
 * numa clinica real as tres salas leem a fila antes de qualquer uma
 * confirmar, e e nesse intervalo que duas poderiam levar o mesmo paciente.
 */
async function escolherProximo(medico: string): Promise<string | null> {
  return amb.como(medico, async () => {
    const fila = await amb.db.query<{ id: string }>(
      `select id from public.attendances
        where tenant_id = '${amb.tenant}' and stage_code = 'aguardando_medico'
          and in_service = false and finished_at is null and cancelled_at is null and deleted_at is null
        order by case priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end, checkin_at
        limit 1`,
    );
    return fila.rows[0]?.id ?? null;
  });
}

/** Confirma a chamada, igual a chamarProximoNoConsultorio. */
async function tomarPaciente(
  atendimento: string,
  sala: string,
  medico: string,
): Promise<string | null> {
  return amb.como(medico, async () => {
    const tomado = await amb.db.query<{ id: string }>(
      `update public.attendances
          set stage_code = 'em_consulta', in_service = true, current_room_id = '${sala}',
              consultation_started_at = now(), updated_by = '${medico}'
        where id = '${atendimento}' and tenant_id = '${amb.tenant}' and in_service = false
       returning id`,
    );
    if (tomado.rows.length === 0) return null; // outra sala chegou primeiro

    await amb.db.exec(
      `update public.rooms set status = 'ocupada', current_attendance_id = '${atendimento}'
        where id = '${sala}';
       insert into public.tv_calls (tenant_id, ticket_code, room_name, destination, priority)
       select '${amb.tenant}', coalesce(qt.code, '---'),
              (select name from public.rooms where id = '${sala}'), 'sala', a.priority
         from public.attendances a
         left join public.queue_tickets qt on qt.attendance_id = a.id
        where a.id = '${atendimento}' limit 1;`,
    );
    return atendimento;
  });
}

/** Consulta salva e finalizada, como saveConsultation. */
async function atenderEFinalizar(atendimento: string, medico: string): Promise<void> {
  await amb.como(medico, async () => {
    const a = await amb.um<{ current_room_id: string | null; patient_id: string }>(
      `select current_room_id, patient_id from public.attendances where id = '${atendimento}'`,
    );

    await amb.db.exec(`
      insert into public.medical_consultations
        (tenant_id, attendance_id, patient_id, doctor_id, room_id, verdict, finished_at, signed_at, created_by)
      values ('${amb.tenant}', '${atendimento}', '${a.patient_id}', '${medico}',
              ${a.current_room_id ? `'${a.current_room_id}'` : 'null'}, 'apto', now(), now(), '${medico}')
    `);
    await amb.db.exec(`
      update public.attendances
         set stage_code = 'finalizado', consultation_finished_at = now(), finished_at = now(),
             exit_at = now(), in_service = false, current_room_id = null, updated_by = '${medico}'
       where id = '${atendimento}'
    `);
    if (a.current_room_id) {
      await amb.db.exec(`
        update public.rooms set status = 'disponivel', current_attendance_id = null
         where id = '${a.current_room_id}' and tenant_id = '${amb.tenant}'
      `);
    }
  });
}

describe('clinica lotada — 3 medicos e dezenas de pacientes', () => {
  it('todos fazem check-in e recebem senha unica', async () => {
    for (const p of pacientes) {
      await amb.como(recepcao, async () => {
        await amb.um(
          `select public.checkin_patient('${amb.tenant}', null, '${p.id}', '${p.prioridade}', null, null)`,
        );
      });
    }

    const senhas = await amb.um<{ total: number; distintas: number }>(`
      select count(*)::int as total, count(distinct code)::int as distintas
        from public.queue_tickets where tenant_id = '${amb.tenant}'
    `);
    expect(senhas.total).toBe(TOTAL_PACIENTES);
    expect(senhas.distintas).toBe(TOTAL_PACIENTES);
  });

  it('a recepcao encaminha cada um conforme a procedencia', async () => {
    for (const p of pacientes) {
      const atendimento = await amb.um<{ id: string }>(
        `select id from public.attendances where patient_id = '${p.id}' order by checkin_at desc limit 1`,
      );

      await amb.como(recepcao, async () => {
        // Particular faz exames; as demais procedencias vao direto ao medico.
        if (p.procedencia === 'particular') {
          await amb.db.exec(`
            insert into public.patient_exams
              (tenant_id, attendance_id, patient_id, exam_type_id, room_id, sort_order, priority, status, created_by)
            select '${amb.tenant}', '${atendimento.id}', '${p.id}', et.id, et.default_room_id,
                   et.sort_order, '${p.prioridade}', 'pendente', '${recepcao}'
              from public.exam_types et
             where et.tenant_id = '${amb.tenant}' and et.code in ('AUDIO','ECG')
          `);
        }
        await amb.db.exec(`
          update public.attendances
             set stage_code = '${p.procedencia === 'particular' ? 'aguardando_exames' : 'aguardando_medico'}',
                 needs_triage = false, origin_kind = '${p.procedencia}',
                 procedure_code = 'consulta_ocupacional', priority = '${p.prioridade}',
                 reception_finished_at = now(), updated_by = '${recepcao}'
           where id = '${atendimento.id}'
        `);
      });
    }

    const dist = await amb.db.query<{ stage_code: string; total: number }>(`
      select stage_code, count(*)::int as total from public.attendances
       where tenant_id = '${amb.tenant}' and deleted_at is null
       group by stage_code order by stage_code
    `);
    const mapa = Object.fromEntries(dist.rows.map((r) => [r.stage_code, r.total]));
    expect((mapa.aguardando_exames ?? 0) + (mapa.aguardando_medico ?? 0)).toBe(TOTAL_PACIENTES);
  });

  it('as salas de exame esvaziam a fila sem chamar ninguem duas vezes', async () => {
    const chamados: string[] = [];
    let rodadas = 0;

    // Salas trabalhando em paralelo, em rodadas, ate nao sobrar exame.
    for (;;) {
      let chamou = false;
      for (const sala of salasDeExame) {
        const r = await amb.como(recepcao, () =>
          amb.um<{ payload: { found: boolean; exam?: { id: string } } }>(
            `select public.call_next_for_room('${amb.tenant}', '${sala.id}') as payload`,
          ),
        );
        if (!r.payload.found || !r.payload.exam) continue;

        chamou = true;
        chamados.push(r.payload.exam.id);
        await amb.como(recepcao, async () => {
          await amb.db.exec(`
            update public.patient_exams set status = 'concluido', finished_at = now()
             where id = '${r.payload.exam!.id}'
          `);
          await amb.db.exec(`
            update public.rooms set status = 'disponivel', current_attendance_id = null
             where id = '${sala.id}'
          `);
        });
      }
      if (!chamou) break;
      if (++rodadas > 500) throw new Error('a fila de exames nao esvaziou');
    }

    expect(new Set(chamados).size).toBe(chamados.length);

    const pendentes = await amb.um<{ total: number }>(`
      select count(*)::int as total from public.patient_exams
       where tenant_id = '${amb.tenant}' and status in ('pendente','em_fila','chamado','em_andamento')
    `);
    expect(pendentes.total).toBe(0);
  });

  it('todo mundo chega a fila do medico', async () => {
    const espera = await amb.um<{ total: number }>(`
      select count(*)::int as total from public.attendances
       where tenant_id = '${amb.tenant}' and stage_code = 'aguardando_medico' and deleted_at is null
    `);
    expect(espera.total).toBe(TOTAL_PACIENTES);
  });

  it('os tres consultorios dividem a fila sem atender o mesmo paciente', async () => {
    const atendidos: string[] = [];
    let rodadas = 0;
    let disputas = 0;

    for (;;) {
      let chamou = false;

      // Primeiro as tres leem a fila, sem nenhuma confirmar: com a fila
      // cheia, as tres enxergam o mesmo nome no topo.
      const escolhas = await Promise.all(medicos.map((m) => escolherProximo(m)));
      const escolhidos = escolhas.filter((e): e is string => e !== null);
      const miraramNoMesmo = escolhidos.length > 1 && new Set(escolhidos).size === 1;

      // So entao confirmam. Apenas uma pode levar.
      const emAtendimento: { atendimento: string; medico: string }[] = [];
      for (let i = 0; i < consultorios.length; i++) {
        const escolhido = escolhas[i];
        if (!escolhido) continue;
        const id = await tomarPaciente(escolhido, consultorios[i]!.id, medicos[i]!);
        if (id) {
          emAtendimento.push({ atendimento: id, medico: medicos[i]! });
          chamou = true;
        }
      }

      if (miraramNoMesmo) {
        disputas++;
        expect(emAtendimento).toHaveLength(1);
      }

      // Ninguem pode estar em duas salas ao mesmo tempo.
      const ocupacao = await amb.db.query<{ total: number }>(`
        select count(*)::int as total from public.rooms
         where tenant_id = '${amb.tenant}' and current_attendance_id is not null
      `);
      const distintos = new Set(emAtendimento.map((x) => x.atendimento));
      expect(distintos.size).toBe(emAtendimento.length);
      expect(Number(ocupacao.rows[0]!.total)).toBeLessThanOrEqual(consultorios.length);

      for (const { atendimento, medico } of emAtendimento) {
        atendidos.push(atendimento);
        await atenderEFinalizar(atendimento, medico);
      }

      if (!chamou) break;
      if (++rodadas > 500) throw new Error('a fila do medico nao esvaziou');
    }

    expect(new Set(atendidos).size).toBe(atendidos.length);
    expect(atendidos).toHaveLength(TOTAL_PACIENTES);
    // O teste so prova alguma coisa se a disputa tiver acontecido de fato.
    expect(disputas).toBeGreaterThan(0);
  });

  it('nenhuma sala fica presa no fim do dia', async () => {
    const presas = await amb.db.query<{ name: string }>(`
      select name from public.rooms
       where tenant_id = '${amb.tenant}'
         and (current_attendance_id is not null or status = 'ocupada')
    `);
    expect(presas.rows.map((r) => r.name)).toEqual([]);
  });

  it('nenhum atendimento fica aberto ou marcado em atendimento', async () => {
    const soltos = await amb.um<{ abertos: number; em_servico: number }>(`
      select count(*) filter (where finished_at is null)::int as abertos,
             count(*) filter (where in_service)::int as em_servico
        from public.attendances where tenant_id = '${amb.tenant}' and deleted_at is null
    `);
    expect(soltos.abertos).toBe(0);
    expect(soltos.em_servico).toBe(0);
  });

  it('todo prioritario foi atendido antes de qualquer normal', async () => {
    // Todos chegaram no mesmo lote, entao a prioridade e o unico criterio que
    // separa: nenhum normal pode ter passado na frente de um prioritario.
    const ordem = await amb.db.query<{ priority: string }>(
      `select a.priority
         from public.medical_consultations c
         join public.attendances a on a.id = c.attendance_id
        where c.tenant_id = '${amb.tenant}'
        order by c.created_at, c.id`,
    );
    const posicoes = ordem.rows.map((r) => r.priority);
    const ultimoPrioritario = posicoes.lastIndexOf('prioritario');
    const primeiroNormal = posicoes.indexOf('normal');

    expect(posicoes.filter((p) => p === 'prioritario').length).toBeGreaterThan(0);
    expect(ultimoPrioritario).toBeLessThan(primeiroNormal);
  });

  it('cada consulta registra em qual sala aconteceu', async () => {
    const semSala = await amb.um<{ total: number }>(`
      select count(*)::int as total from public.medical_consultations
       where tenant_id = '${amb.tenant}' and room_id is null
    `);
    expect(semSala.total).toBe(0);
  });


  it('ninguem e chamado em duas salas ao mesmo tempo', async () => {
    // O indice uq_patient_exam_in_service impede dois exames do mesmo
    // atendimento em curso. Se algum dia a fila deixar passar, o banco
    // recusa — e este teste garante que a trava continua de pe.
    const emDuas = await amb.db.query(
      `select attendance_id from public.patient_exams
        where tenant_id = '${amb.tenant}' and status in ('chamado','em_andamento')
        group by attendance_id having count(*) > 1`,
    );
    expect(emDuas.rows).toEqual([]);

    const paciente = pacientes[0]!;
    const exames = await amb.db.query<{ id: string }>(
      `select pe.id from public.patient_exams pe
         join public.attendances a on a.id = pe.attendance_id
        where a.patient_id = '${paciente.id}' limit 2`,
    );

    if (exames.rows.length === 2) {
      let recusou = false;
      try {
        await amb.db.exec(
          `update public.patient_exams set status = 'chamado'
            where id in ('${exames.rows[0]!.id}', '${exames.rows[1]!.id}')`,
        );
      } catch {
        recusou = true;
      }
      expect(recusou).toBe(true);
    }
  });

  it('toda chamada foi ao painel', async () => {
    const chamadas = await amb.um<{ total: number }>(
      `select count(*)::int as total from public.tv_calls where tenant_id = '${amb.tenant}'`,
    );
    expect(chamadas.total).toBeGreaterThanOrEqual(TOTAL_PACIENTES);
  });
});
