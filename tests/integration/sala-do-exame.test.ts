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
