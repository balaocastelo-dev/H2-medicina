/**
 * Valida as migrations e o seed contra um Postgres real (PGlite/WASM),
 * simulando o ambiente Supabase (schemas auth/storage, auth.uid(), etc.).
 * Uso: node scripts/validate-sql.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const SEEDS = join(process.cwd(), 'supabase/seed');

const SUPABASE_STUB = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

create or replace function auth.role() returns text language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $f$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
`;

function listSql(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm, unaccent, citext } });
await db.exec(SUPABASE_STUB);
console.log('· ambiente Supabase simulado');

let failures = 0;
for (const file of listSql(MIGRATIONS)) {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  try {
    await db.exec(sql);
    console.log(`✓ ${file}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${file}\n   ${err.message}`);
  }
}

// idempotencia: reaplica tudo
for (const file of listSql(MIGRATIONS)) {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  try {
    await db.exec(sql);
  } catch (err) {
    failures++;
    console.error(`✗ [reaplicacao] ${file}\n   ${err.message}`);
  }
}
console.log('· migrations reaplicadas (idempotencia)');

for (const file of listSql(SEEDS)) {
  const sql = readFileSync(join(SEEDS, file), 'utf8');
  try {
    await db.exec(sql);
    await db.exec(sql); // seed tambem precisa ser idempotente
    console.log(`✓ seed ${file}`);
  } catch (err) {
    failures++;
    console.error(`✗ seed ${file}\n   ${err.message}`);
  }
}

const tables = await db.query(
  `select count(*)::int as n from pg_tables where schemaname='public'`,
);
const policies = await db.query(
  `select count(*)::int as n from pg_policies where schemaname='public'`,
);
const rlsOff = await db.query(
  `select tablename from pg_tables t
    where schemaname='public'
      and not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=t.tablename and c.relrowsecurity)`,
);

console.log(`\ntabelas public: ${tables.rows[0].n}`);
console.log(`policies public: ${policies.rows[0].n}`);
if (rlsOff.rows.length) {
  failures++;
  console.error('✗ tabelas SEM RLS:', rlsOff.rows.map((r) => r.tablename).join(', '));
} else {
  console.log('✓ todas as tabelas com RLS habilitado');
}

await db.close();
if (failures > 0) {
  console.error(`\n${failures} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log('\nTudo validado.');
