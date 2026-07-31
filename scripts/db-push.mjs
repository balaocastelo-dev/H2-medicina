#!/usr/bin/env node
/**
 * Aplica as migrations em ordem no banco do Supabase.
 *
 * Uso:
 *   SUPABASE_DB_URL="postgresql://postgres:SENHA@db.<ref>.supabase.co:5432/postgres" \
 *   node scripts/db-push.mjs
 *
 * Alternativas equivalentes:
 *   - supabase db push (CLI oficial, com o projeto linkado)
 *   - colar supabase/full_schema.sql no SQL Editor do painel
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Defina SUPABASE_DB_URL. A senha NUNCA deve ser commitada.');
  process.exit(1);
}

const dir = join(process.cwd(), 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
`);

for (const file of files) {
  const version = file.replace('.sql', '');
  const { rowCount } = await client.query(
    'select 1 from public.schema_migrations where version = $1',
    [version],
  );
  if (rowCount > 0) {
    console.log(`· ${file} (ja aplicada)`);
    continue;
  }

  const sql = readFileSync(join(dir, file), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migrations (version) values ($1)', [version]);
    await client.query('commit');
    console.log(`✓ ${file}`);
  } catch (error) {
    await client.query('rollback');
    console.error(`✗ ${file}\n  ${error.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log('\nMigrations aplicadas.');
