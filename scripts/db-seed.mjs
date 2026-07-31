#!/usr/bin/env node
/**
 * Aplica os seeds (dados iniciais do tenant). Idempotente.
 * Uso: SUPABASE_DB_URL="postgresql://..." node scripts/db-seed.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Defina SUPABASE_DB_URL.');
  process.exit(1);
}

const dir = join(process.cwd(), 'supabase/seed');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8');
  await client.query(sql);
  console.log(`✓ seed ${file}`);
}

await client.end();
console.log('\nSeeds aplicados.');
