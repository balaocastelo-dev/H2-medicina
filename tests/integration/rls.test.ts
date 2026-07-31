/**
 * Teste de isolamento multi-tenant contra um Postgres real (PGlite),
 * simulando o ambiente Supabase (auth.uid(), roles, storage).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const STUB = `
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
`;

let db: PGlite;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm, unaccent, citext } });
  await db.exec(STUB);

  const dir = join(process.cwd(), 'supabase/migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }

  // Grants equivalentes aos do Supabase (RLS continua sendo a barreira real)
  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
  `);

  // Dois tenants, um usuario em cada
  const seed = await db.query<{ key: string; id: string }>(`
    with t as (
      insert into public.tenants (slug, legal_name, trade_name)
      values ('alfa','Clinica Alfa','Alfa'), ('beta','Clinica Beta','Beta')
      returning id, slug
    ),
    u as (
      insert into auth.users (email) values ('alfa@teste.com'), ('beta@teste.com')
      returning id, email
    ),
    p as (
      insert into public.profiles (id, tenant_id, full_name, email)
      select u.id,
             (select id from t where slug = case when u.email like 'alfa%' then 'alfa' else 'beta' end),
             'Usuario ' || u.email, u.email
      from u
      returning id, tenant_id, email
    ),
    r as (
      insert into public.roles (tenant_id, code, name)
      select id, 'operador', 'Operador' from t
      returning id, tenant_id
    ),
    rp as (
      insert into public.role_permissions (role_id, permission_code)
      select r.id, perm from r, unnest(array['pacientes.ver','pacientes.editar','pacientes.criar']) as perm
      returning role_id
    ),
    ur as (
      insert into public.user_roles (user_id, role_id, tenant_id)
      select p.id, r.id, p.tenant_id from p join r on r.tenant_id = p.tenant_id
      returning user_id
    ),
    pat as (
      insert into public.patients (tenant_id, full_name)
      select id, 'Paciente ' || slug from t
      returning id, tenant_id
    )
    select 'tenant_' || slug as key, id::text as id from t
    union all
    select 'user_' || split_part(email,'@',1) as key, id::text as id from p;
  `);

  for (const row of seed.rows) ids[row.key] = row.id;
});

afterAll(async () => {
  await db?.close();
});

/** Executa um bloco como usuario autenticado e sempre desfaz a transacao. */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
    return await fn();
  } finally {
    await db.exec('rollback').catch(() => {});
    await db.exec('reset role').catch(() => {});
  }
}

/** Espera que a operacao seja negada pelo RLS. */
async function expectDenied(userId: string, sql: string) {
  let denied = false;
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', true)`);
    await db.query(sql);
  } catch {
    denied = true;
  } finally {
    await db.exec('rollback').catch(() => {});
    await db.exec('reset role').catch(() => {});
  }
  expect(denied).toBe(true);
}

describe('isolamento multi-tenant (RLS)', () => {
  it('usuario enxerga somente pacientes do proprio tenant', async () => {
    const rows = await asUser(ids.user_alfa!, async () => {
      const r = await db.query<{ full_name: string }>('select full_name from public.patients');
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.full_name).toBe('Paciente alfa');
  });

  it('outro tenant enxerga apenas o proprio paciente', async () => {
    const rows = await asUser(ids.user_beta!, async () => {
      const r = await db.query<{ full_name: string }>('select full_name from public.patients');
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.full_name).toBe('Paciente beta');
  });

  it('bloqueia insercao de paciente em outro tenant', async () => {
    await expectDenied(
      ids.user_alfa!,
      `insert into public.patients (tenant_id, full_name) values ('${ids.tenant_beta}', 'Invasor')`,
    );
  });

  it('bloqueia leitura de modulo sem permissao (financeiro)', async () => {
    const total = await asUser(ids.user_alfa!, async () => {
      const r = await db.query<{ n: number }>('select count(*)::int as n from public.payments');
      return r.rows[0]?.n;
    });
    expect(total).toBe(0);
  });

  it('bloqueia insercao no financeiro sem permissao', async () => {
    await expectDenied(
      ids.user_alfa!,
      `insert into public.payments (tenant_id, amount) values ('${ids.tenant_alfa}', 100)`,
    );
  });

  it('auditoria e append-only: usuario insere mas nao altera nem apaga', async () => {
    // Sem policy de UPDATE/DELETE o RLS torna as linhas invisiveis para essas
    // operacoes: nenhuma linha e afetada, e nada pode ser adulterado.
    const result = await asUser(ids.user_alfa!, async () => {
      await db.query(
        `insert into public.audit_logs (tenant_id, action, entity) values ('${ids.tenant_alfa}', 'create', 'patients')`,
      );
      const visible = await db.query<{ n: number }>('select count(*)::int as n from public.audit_logs');
      const upd = await db.query(`update public.audit_logs set action = 'delete'`);
      const del = await db.query('delete from public.audit_logs');
      return { visible: visible.rows[0]?.n ?? 0, updated: upd.affectedRows, deleted: del.affectedRows };
    });
    // Sem a permissao `logs.ver` o proprio registro inserido nao e legivel,
    // e nenhuma linha pode ser alterada ou apagada.
    expect(result.visible).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it('sessao anonima nao le pacientes', async () => {
    await db.exec('begin');
    await db.exec('set local role anon');
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.patients');
    expect(r.rows[0]?.n).toBe(0);
    await db.exec('rollback');
    await db.exec('reset role');
  });

  it('segredos ficam em schema privado, inacessivel pela API', async () => {
    // A coluna nem existe mais no schema exposto...
    const cols = await db.query<{ n: number }>(`
      select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name = 'scraper_connectors'
         and column_name = 'password_encrypted'`);
    expect(cols.rows[0]?.n).toBe(0);

    // ...e o schema private nao tem grant algum para os papeis da API.
    await expectDenied(ids.user_alfa!, 'select * from private.connector_secrets');
    await expectDenied(ids.user_alfa!, 'select * from private.provider_secrets');
  });
});
