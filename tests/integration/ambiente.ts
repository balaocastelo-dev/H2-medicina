/**
 * Ambiente de teste com um Postgres real (PGlite) rodando as migrations, os
 * seeds e o RLS do projeto, com auth.uid() como no Supabase.
 *
 * Existe para que os testes de percurso e de carga partam exatamente do
 * mesmo banco que a clinica tem, sem subir a aplicacao e sem tocar em
 * producao.
 */
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
-- No Supabase o papel authenticated enxerga o schema auth para chamar
-- auth.uid(); sem isso qualquer gatilho que grave quem alterou explode.
grant usage on schema auth to anon, authenticated;
grant select on auth.users to anon, authenticated;
`;

export interface Ambiente {
  db: PGlite;
  tenant: string;
  /** Executa como um usuario autenticado, com o RLS valendo. */
  como<T>(usuario: string, fn: () => Promise<T>): Promise<T>;
  /** Primeira linha do resultado. */
  um<T>(sql: string): Promise<T>;
  /** Cria um usuario com todas as permissoes do catalogo. */
  criarUsuario(nome: string, email: string): Promise<string>;
  fechar(): Promise<void>;
}

export async function montarAmbiente(): Promise<Ambiente> {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm, unaccent, citext } });
  await db.exec(STUB);

  for (const pasta of ['supabase/migrations', 'supabase/seed']) {
    const dir = join(process.cwd(), pasta);
    for (const arquivo of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await db.exec(readFileSync(join(dir, arquivo), 'utf8'));
    }
  }

  await db.exec(`
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant usage, select on all sequences in schema public to anon, authenticated;
    grant execute on all functions in schema public to anon, authenticated;
  `);

  const um = async <T,>(sql: string): Promise<T> => {
    const r = await db.query<T>(sql);
    return r.rows[0] as T;
  };

  const tenant = (await um<{ id: string }>(`select id from public.tenants where slug = 'h2'`)).id;

  // Um papel com todas as permissoes: o isolamento por permissao ja tem o
  // teste dele em rls.test.ts, e aqui o objetivo e o fluxo de trabalho.
  await db.exec(`
    insert into public.roles (tenant_id, code, name) values ('${tenant}', 'tudo', 'Tudo');
    insert into public.role_permissions (role_id, permission_code)
    select r.id, p.code from public.roles r, public.permissions p
     where r.tenant_id = '${tenant}' and r.code = 'tudo';
  `);

  /**
   * A migration 0020 popula o catalogo de procedimentos dos tenants que
   * existem no momento em que ela roda. Num banco novo o tenant so nasce no
   * seed, que vem depois — em producao o catalogo existe porque a migration
   * foi aplicada com a clinica ja cadastrada. Aqui reproduzimos esse estado.
   */
  await db.exec(`
    insert into public.procedure_types (tenant_id, code, name, default_fee, sort_order, emite_ficha_clinica)
    values ('${tenant}', 'consulta_ocupacional', 'Consulta ocupacional', 0, 100, true),
           ('${tenant}', 'pericia', 'Pericia', 30, 40, false),
           ('${tenant}', 'junta_medica', 'Junta Medica', 64, 80, false)
    on conflict (tenant_id, code) do nothing;
  `);

  return {
    db,
    tenant,
    um,
    async como<T>(usuario: string, fn: () => Promise<T>): Promise<T> {
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', '${usuario}', false)`);
      try {
        return await fn();
      } finally {
        await db.exec('reset role');
      }
    },
    async criarUsuario(nome: string, email: string): Promise<string> {
      const { id } = await um<{ id: string }>(
        `insert into auth.users (email) values ('${email}') returning id`,
      );
      await db.exec(`
        insert into public.profiles (id, tenant_id, full_name, email, council_type, council_number, council_state)
        values ('${id}', '${tenant}', '${nome}', '${email}', 'CRM', '${Math.floor(Math.random() * 900000 + 100000)}', 'SP');
        insert into public.user_roles (user_id, role_id, tenant_id)
        select '${id}', id, '${tenant}' from public.roles
         where tenant_id = '${tenant}' and code = 'tudo';
      `);
      return id;
    },
    async fechar() {
      await db.close();
    },
  };
}
