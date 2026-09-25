/**
 * Pericia, SISPER e ingresso terminam no consultorio — nunca no caixa.
 *
 * "os pacientes que eu categorizo como sisper ao clicar em encaminhar para
 *  o medico vao direto para a aba pagamentos sem passar pela chamada do
 *  medico" -- Isabella, 24/09.
 *
 * A regra "so vai ao medico quem tem Consulta clinica ocupacional marcada"
 * e de 17/09 e continua certa para o particular. Para estas tres
 * procedencias a avaliacao medica e o motivo da visita e nao e cobrada
 * como exame: nao ha o que marcar na recepcao.
 *
 * O teste cobre os tres pontos onde a decisao e tomada — a recepcao, o fim
 * dos exames e o fim da triagem — porque nao adianta acertar um e deixar o
 * paciente cair no caixa pelo outro.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';
import { proximaEtapaDaRecepcao, VAI_AO_MEDICO } from '@/modules/queue/origin-kind';

let amb: Ambiente;
let usuario = '';

const um = <T,>(sql: string) => amb.um<T>(sql);
const como = <T,>(fn: () => Promise<T>) => amb.como(usuario, fn);

/** Cria um atendimento pronto, no estado em que a recepcao o deixa. */
async function montar(opcoes: {
  origem: 'particular' | 'estado' | 'sisper' | 'ingresso';
  exames: string[];
  triagem: boolean;
}): Promise<string> {
  const paciente = (
    await como(async () =>
      um<{ id: string }>(`
        insert into public.patients (tenant_id, full_name)
        values ('${amb.tenant}', 'Paciente ${opcoes.origem} ${Math.random()}')
        returning id`),
    )
  ).id;

  const checkin = await como(async () =>
    um<{ payload: { attendance_id: string } }>(
      `select public.checkin_patient('${amb.tenant}', null, '${paciente}', 'normal', null, null) as payload`,
    ),
  );
  const atendimento = checkin.payload.attendance_id;

  await como(async () => {
    if (opcoes.exames.length > 0) {
      const codigos = opcoes.exames.map((c) => `'${c}'`).join(',');
      await amb.db.exec(`
        insert into public.patient_exams
          (tenant_id, attendance_id, patient_id, exam_type_id, room_id, status, created_by)
        select '${amb.tenant}', '${atendimento}', '${paciente}', et.id, et.default_room_id,
               'pendente', '${usuario}'
          from public.exam_types et
         where et.tenant_id = '${amb.tenant}' and et.code in (${codigos})`);
    }

    // Mesma decisao da tela da recepcao, com a mesma funcao.
    const etapa = proximaEtapaDaRecepcao({
      originKind: opcoes.origem,
      needsTriage: opcoes.triagem,
      temExames: opcoes.exames.some((c) => !['CLINICO', 'PSICO', 'RAIOX'].includes(c)),
      temConsulta: opcoes.exames.some((c) => ['CLINICO', 'PSICO'].includes(c)),
    });

    await amb.db.exec(`
      update public.attendances
         set stage_code = '${etapa}', needs_triage = ${opcoes.triagem},
             origin_kind = '${opcoes.origem}', reception_finished_at = now(),
             updated_by = '${usuario}'
       where id = '${atendimento}'`);
  });

  return atendimento;
}

const etapaDe = async (id: string) =>
  (await um<{ etapa: string }>(`select stage_code as etapa from public.attendances where id = '${id}'`))
    .etapa;

beforeAll(async () => {
  amb = await montarAmbiente();
  usuario = await amb.criarUsuario('Recepção', 'sisper@teste.com');
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

describe('a recepção manda para o médico', () => {
  it.each(VAI_AO_MEDICO)('%s sem nenhum exame marcado vai ao médico', async (origem) => {
    const at = await montar({ origem, exames: [], triagem: false });
    expect(await etapaDe(at)).toBe('aguardando_medico');
  });

  it('o particular sem consulta marcada continua indo ao pagamento', async () => {
    const at = await montar({ origem: 'particular', exames: [], triagem: false });
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });
});

describe('o fim dos exames manda para o médico', () => {
  it.each(VAI_AO_MEDICO)(
    '%s com exame de sala e sem consulta marcada termina no consultório',
    async (origem) => {
      const at = await montar({ origem, exames: ['AUDIO'], triagem: false });

      // A procedencia leva direto ao medico, mas o exame continua na lista
      // e pode ser feito antes. Concluir nao pode desviar para o caixa.
      await como(async () => {
        await amb.db.exec(`
          update public.attendances set stage_code = 'aguardando_exames' where id = '${at}'`);
        await amb.db.exec(`
          update public.patient_exams
             set status = 'concluido', started_at = now(), finished_at = now()
           where attendance_id = '${at}'`);
      });

      expect(await etapaDe(at)).toBe('aguardando_medico');
    },
  );

  it('o particular sem consulta vai ao pagamento quando o exame acaba', async () => {
    const at = await montar({ origem: 'particular', exames: ['AUDIO'], triagem: false });
    await como(async () => {
      await amb.db.exec(`
        update public.patient_exams
           set status = 'concluido', started_at = now(), finished_at = now()
         where attendance_id = '${at}'`);
    });
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });

  it('o particular COM consulta marcada vai ao médico — a regra de 17/09 continua', async () => {
    const at = await montar({
      origem: 'particular',
      exames: ['AUDIO', 'CLINICO'],
      triagem: false,
    });
    await como(async () => {
      await amb.db.exec(`
        update public.patient_exams pe
           set status = 'concluido', started_at = now(), finished_at = now()
          from public.exam_types et
         where et.id = pe.exam_type_id and et.code = 'AUDIO' and pe.attendance_id = '${at}'`);
    });
    expect(await etapaDe(at)).toBe('aguardando_medico');
  });
});

describe('o fim da triagem manda para o médico', () => {
  it.each(VAI_AO_MEDICO)('%s sai da triagem para o consultório', async (origem) => {
    const at = await montar({ origem, exames: [], triagem: true });
    expect(await etapaDe(at)).toBe('aguardando_triagem');

    const paciente = await um<{ patient_id: string }>(
      `select patient_id from public.attendances where id = '${at}'`,
    );

    await como(async () => {
      await amb.db.exec(`
        insert into public.triages (tenant_id, attendance_id, patient_id, professional_id, created_by)
        values ('${amb.tenant}', '${at}', '${paciente.patient_id}', '${usuario}', '${usuario}')`);
      await amb.db.exec(`
        update public.triages set finished_at = now() where attendance_id = '${at}'`);
    });

    expect(await etapaDe(at)).toBe('aguardando_medico');
  });

  it('o particular sem nada a fazer sai da triagem para o pagamento', async () => {
    const at = await montar({ origem: 'particular', exames: [], triagem: true });
    const paciente = await um<{ patient_id: string }>(
      `select patient_id from public.attendances where id = '${at}'`,
    );

    await como(async () => {
      await amb.db.exec(`
        insert into public.triages (tenant_id, attendance_id, patient_id, professional_id, created_by)
        values ('${amb.tenant}', '${at}', '${paciente.patient_id}', '${usuario}', '${usuario}')`);
      await amb.db.exec(`
        update public.triages set finished_at = now() where attendance_id = '${at}'`);
    });

    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });
});

describe('quem já tinha caído no caixa', () => {
  it('o script devolve o paciente ao consultório', async () => {
    const at = await montar({ origem: 'sisper', exames: [], triagem: false });

    // Reproduz o estado em que a clinica estava: parado no pagamento, sem
    // consulta nenhuma registrada.
    await como(async () => {
      await amb.db.exec(`
        update public.attendances set stage_code = 'aguardando_pagamento' where id = '${at}'`);
    });
    expect(await etapaDe(at)).toBe('aguardando_pagamento');

    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0039_pericia_e_sisper_vao_ao_medico.sql'),
      'utf8',
    );
    await amb.db.exec(sql);

    expect(await etapaDe(at)).toBe('aguardando_medico');
  });

  it('não mexe em quem já foi atendido pelo médico', async () => {
    const at = await montar({ origem: 'sisper', exames: [], triagem: false });
    const paciente = await um<{ patient_id: string }>(
      `select patient_id from public.attendances where id = '${at}'`,
    );

    await como(async () => {
      await amb.db.exec(`
        insert into public.medical_consultations
          (tenant_id, attendance_id, patient_id, doctor_id, verdict, created_by)
        values ('${amb.tenant}', '${at}', '${paciente.patient_id}', '${usuario}', 'apto', '${usuario}')`);
      await amb.db.exec(`
        update public.medical_consultations set finished_at = now(), signed_at = now()
         where attendance_id = '${at}'`);
      await amb.db.exec(`
        update public.attendances set stage_code = 'aguardando_pagamento' where id = '${at}'`);
    });

    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/0039_pericia_e_sisper_vao_ao_medico.sql'),
      'utf8',
    );
    await amb.db.exec(sql);

    // Ja passou pelo medico: o lugar dele e o caixa mesmo.
    expect(await etapaDe(at)).toBe('aguardando_pagamento');
  });
});
