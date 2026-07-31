#!/usr/bin/env node
/** Concatena migrations + seed em um unico arquivo para colar no SQL Editor. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const parts = [];
for (const [label, dir] of [
  ['MIGRATIONS', 'supabase/migrations'],
  ['SEED', 'supabase/seed'],
]) {
  const base = join(process.cwd(), dir);
  for (const file of readdirSync(base).filter((f) => f.endsWith('.sql')).sort()) {
    parts.push(
      `\n-- ==========================================================\n-- ${label}: ${file}\n-- ==========================================================\n`,
    );
    parts.push(readFileSync(join(base, file), 'utf8'));
  }
}

writeFileSync(join(process.cwd(), 'supabase/full_schema.sql'), parts.join('\n'));
console.log('supabase/full_schema.sql gerado.');
