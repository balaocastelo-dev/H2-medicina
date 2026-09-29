/**
 * Uma clinica inteira de mentira, para exercitar o sistema de verdade.
 *
 * Aqui nao se escreve SQL para simular o que a tela faz: chama-se a propria
 * server action que a tela chama. O paciente entra pelo totem com
 * `checkinPatient`, a recepcao libera com `finalizarRecepcao`, a sala chama
 * com `callNextForRoom`, o medico assina com a acao da consulta. Se uma
 * dessas acoes quebrar, o teste quebra -- que e exatamente o que nao
 * acontecia antes.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lerEsquema } from '../integration/postgrest-de-mentira';
import { ligarBanco, desligarBanco, trocarUsuario } from '../integration/banco-vivo';

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
grant usage on schema auth to anon, authenticated;
grant select on auth.users to anon, authenticated;
`;

export interface Pessoa {
  id: string;
  email: string;
  nome: string;
  papel: string;
}

export interface Clinica {
  db: PGlite;
  tenant: string;
  /** Primeira linha de uma consulta SQL, para CONFERIR — nunca para agir. */
  um<T>(sql: string): Promise<T>;
  linhas<T>(sql: string): Promise<T[]>;
  /** Cria um usuario com um papel real do seed. */
  criarPessoa(nome: string, email: string, papel: string): Promise<Pessoa>;
  /** Executa as acoes como aquela pessoa, com o RLS valendo. */
  como<T>(pessoa: Pessoa, fn: () => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
}

export async function montarClinica(): Promise<Clinica> {
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
  const linhas = async <T,>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;

  const tenant = (await um<{ id: string }>(`select id from public.tenants where slug = 'h2'`)).id;

  // O catalogo de procedimentos que a migration 0020 popula para tenants ja
  // existentes. Num banco novo o tenant so nasce no seed, que vem depois.
  await db.exec(`
    insert into public.procedure_types (tenant_id, code, name, default_fee, sort_order, emite_ficha_clinica)
    values ('${tenant}', 'consulta_ocupacional', 'Consulta ocupacional', 0, 100, true),
           ('${tenant}', 'pericia', 'Pericia', 30, 40, false),
           ('${tenant}', 'junta_medica', 'Junta Medica', 64, 80, false)
    on conflict (tenant_id, code) do nothing;`);

  const esquema = await lerEsquema(db);
  ligarBanco(db, esquema);

  return {
    db,
    tenant,
    um,
    linhas,

    async criarPessoa(nome, email, papel) {
      const { id } = await um<{ id: string }>(
        `insert into auth.users (email) values ('${email}') returning id`,
      );
      const conselho = Math.floor(Math.random() * 900000 + 100000);
      await db.exec(`
        insert into public.profiles (id, tenant_id, full_name, email, council_type, council_number, council_state)
        values ('${id}', '${tenant}', '${nome.replace(/'/g, "''")}', '${email}', 'CRM', '${conselho}', 'SP');
        insert into public.user_roles (user_id, role_id, tenant_id)
        select '${id}', r.id, '${tenant}' from public.roles r
         where r.tenant_id = '${tenant}' and r.code = '${papel}';`);

      const temPapel = await um<{ total: number }>(
        `select count(*)::int as total from public.user_roles where user_id = '${id}'`,
      );
      if (temPapel.total === 0) {
        throw new Error(`papel "${papel}" nao existe no seed — o teste estaria provando nada`);
      }

      return { id, email, nome, papel };
    },

    async como(pessoa, fn) {
      // Duas coisas ao mesmo tempo, e as duas precisam ser verdade:
      // o RLS passa a valer (set role) e o sistema passa a enxergar aquela
      // pessoa como a logada (auth.getUser + auth.uid()).
      await db.exec('set role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', '${pessoa.id}', false)`);
      trocarUsuario({ id: pessoa.id, email: pessoa.email });
      try {
        return await fn();
      } finally {
        trocarUsuario(null);
        await db.exec('reset role');
        await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      }
    },

    async fechar() {
      desligarBanco();
      await db.close();
    },
  };
}
