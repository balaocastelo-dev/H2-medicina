/**
 * Unificar cadastros sem travar, e o totem juntando o duplicado do eSisla.
 *
 * "vi agora que ele ainda esta duplicando os pacientes quando cadastra de
 *  forma automatica" / "o cpf nao esta ficando vinculado ao perfil da pessoa
 *  quando ela passa pelo totem" -- Isa, 26/10. Ver migration 0056.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;
let usuario = '';

const comoUsuario = <T,>(fn: () => Promise<T>) => amb.como(usuario, fn);
const um = <T,>(sql: string) => amb.um<T>(sql);

beforeAll(async () => {
  amb = await montarAmbiente();
  usuario = await amb.criarUsuario('Recepção Teste', 'unificar@teste.com');
});

afterAll(async () => {
  await amb?.fechar();
});

async function paciente(nome: string, cpf: string | null, extra = ''): Promise<string> {
  return (
    await um<{ id: string }>(`
      insert into public.patients (tenant_id, full_name, cpf ${extra ? ', ' + extra.split('=')[0] : ''})
      values ('${amb.tenant}', '${nome}', ${cpf ? `'${cpf}'` : 'null'} ${extra ? ', ' + extra.split('=')[1] : ''})
      returning id
    `)
  ).id;
}

async function agendarHoje(patientId: string, hora = '08:00'): Promise<string> {
  return (
    await um<{ id: string }>(`
      insert into public.appointments (tenant_id, patient_id, scheduled_at, attendance_kind)
      values ('${amb.tenant}', '${patientId}',
              ((now() at time zone 'America/Sao_Paulo')::date + time '${hora}') at time zone 'America/Sao_Paulo',
              'consulta')
      returning id
    `)
  ).id;
}

describe('chave_nome', () => {
  it('ignora acento, caixa, pontuacao e espaco sobrando', async () => {
    const r = await um<{ k: string }>(`select public.chave_nome('  JOSÉ   da Silva-Júnior ') as k`);
    expect(r.k).toBe('jose da silva junior');
  });
});

describe('merge_patients', () => {
  it('unifica no cadastro com CPF mesmo quando a tela estava no sem CPF', async () => {
    // Era o caso que travava: o CPF entrava no destino antes de a origem ser
    // arquivada, e o indice unico de CPF recusava.
    const comCpf = await paciente('Raquel Patricia Felipe', '39053344705');
    const semCpf = await paciente('Raquel Patricia Felipe', null, "phone='19988887777'");

    const r = await comoUsuario(async () =>
      um<{ r: { target: string } }>(`select public.merge_patients('${comCpf}', '${semCpf}') as r`),
    );

    expect(r.r.target).toBe(comCpf);
    const ficou = await um<{ cpf: string; phone: string; deleted_at: string | null; needs_review: boolean }>(
      `select cpf, phone, deleted_at, needs_review from public.patients where id = '${comCpf}'`,
    );
    expect(ficou.cpf).toBe('39053344705');
    expect(ficou.phone).toBe('19988887777');
    expect(ficou.deleted_at).toBeNull();
    expect(ficou.needs_review).toBe(false);
    const saiu = await um<{ deleted_at: string | null }>(
      `select deleted_at from public.patients where id = '${semCpf}'`,
    );
    expect(saiu.deleted_at).not.toBeNull();
  });

  it('com agendamento dos dois no mesmo dia, fica um e o outro e cancelado', async () => {
    const a = await paciente('Raquel Vieira dos Santos', null);
    const b = await paciente('Raquel Vieira dos Santos', null);
    await agendarHoje(a, '08:00');
    await agendarHoje(b, '09:00');

    await comoUsuario(async () => {
      await amb.db.query(`select public.merge_patients('${a}', '${b}')`);
    });

    const ativos = await um<{ n: number }>(`
      select count(*)::int as n from public.appointments
       where patient_id = '${b}' and status not in ('cancelado','remarcado') and deleted_at is null
    `);
    expect(ativos.n).toBe(1);
    // Sem CPF nos dois, continua pedindo conferencia.
    const ficou = await um<{ needs_review: boolean }>(
      `select needs_review from public.patients where id = '${b}'`,
    );
    expect(ficou.needs_review).toBe(true);
  });

  it('recusa unificar CPFs diferentes', async () => {
    const a = await paciente('Pessoa Um Teste', '12345678909');
    const b = await paciente('Pessoa Um Teste', '11144477735');
    let recusou = false;
    try {
      await comoUsuario(async () => {
        await amb.db.query(`select public.merge_patients('${a}', '${b}')`);
      });
    } catch {
      recusou = true;
    }
    expect(recusou).toBe(true);
  });
});

describe('unificar_no_totem', () => {
  it('junta o cadastro sem CPF agendado hoje ao dono do CPF', async () => {
    const dono = await paciente('Mara Lucia de Souza', '52998224725');
    const doEsisla = await paciente('MARA LÚCIA DE SOUZA', null);
    const agendamento = await agendarHoje(doEsisla);

    await comoUsuario(async () => {
      await amb.db.query(`select public.unificar_no_totem('${dono}', '${doEsisla}')`);
    });

    const ag = await um<{ patient_id: string }>(
      `select patient_id from public.appointments where id = '${agendamento}'`,
    );
    expect(ag.patient_id).toBe(dono);
  });

  it('recusa quando os nomes nao conferem', async () => {
    const dono = await paciente('Nome Totalmente Diferente', '86288366757');
    const outro = await paciente('Outra Pessoa Qualquer', null);
    await agendarHoje(outro);
    let recusou = false;
    try {
      await comoUsuario(async () => {
        await amb.db.query(`select public.unificar_no_totem('${dono}', '${outro}')`);
      });
    } catch {
      recusou = true;
    }
    expect(recusou).toBe(true);
  });
});

describe('script de limpeza dos duplicados', () => {
  it('unifica os grupos seguros e deixa os duvidosos', async () => {
    const certo = await paciente('Joana Maria Pereira Lima', '71428793860');
    const dup1 = await paciente('Joana Maria Pereira Lima', null);
    const dup2 = await paciente('JOANA MARIA PEREIRA LIMA', null);
    // Nome curto: fica para a recepcao.
    const curto1 = await paciente('Ana Lima', null);
    const curto2 = await paciente('Ana Lima', null);

    const script = readFileSync(
      join(process.cwd(), 'supabase/scripts/UNIFICAR-PACIENTES-DUPLICADOS.sql'),
      'utf8',
    );
    const inicio = script.indexOf('do $$');
    const fim = script.indexOf('end$$;', inicio) + 'end$$;'.length;
    await amb.db.exec(script.slice(inicio, fim));

    const vivos = await amb.db.query<{ id: string }>(`
      select id from public.patients
       where id in ('${certo}', '${dup1}', '${dup2}', '${curto1}', '${curto2}') and deleted_at is null
       order by id
    `);
    expect(vivos.rows.map((r) => r.id).sort()).toEqual([certo, curto1, curto2].sort());
  });
});
