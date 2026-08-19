#!/usr/bin/env node
/**
 * Verificacao estatica dos erros que costumam quebrar o build do Next
 * (e que o tsc nao pega):
 *
 *  1. import de pacote que nao esta no package.json / node_modules
 *  2. componente client importando modulo exclusivo de servidor
 *  3. arquivo 'use server' exportando algo que nao e funcao async
 *  4. import de env de servidor em codigo client
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

const BUILTIN = /^(node:|fs$|path$|crypto$|url$|os$|util$|stream$|buffer$|child_process$)/;
const SERVER_ONLY = [
  'server-only',
  'next/headers',
  '@/lib/supabase/server',
  '@/lib/supabase/admin',
  '@/lib/audit',
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(ROOT, 'src'));
const problems = [];

function pkgNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolves(spec) {
  const name = pkgNameOf(spec);
  if (declared.has(name)) return true;
  return existsSync(join(ROOT, 'node_modules', name));
}

/** Resolve "@/x" e "./x" para um arquivo real, se existir. */
function resolveLocal(spec, from) {
  const base = spec.startsWith('@/')
    ? join(ROOT, 'src', spec.slice(2))
    : resolve(dirname(from), spec);
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
}

const clientFiles = new Set();
const meta = new Map();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const head = src.slice(0, 400);
  const isClient = /^\s*['"]use client['"]/m.test(head);
  const isServerAction = /^\s*['"]use server['"]/m.test(head);
  if (isClient) clientFiles.add(file);

  // "import type" e apagado na compilacao: nao entra no grafo do bundle.
  const imports = [
    ...src.matchAll(/(?:^|\n)\s*import\s+(?!type\s)(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/g),
  ].map((m) => m[1]);
  const typeImports = [
    ...src.matchAll(/(?:^|\n)\s*import\s+type\s+[^'"]*from\s+['"]([^'"]+)['"]/g),
  ].map((m) => m[1]);
  meta.set(file, { isClient, isServerAction, imports, typeImports, src });

  for (const spec of [...imports, ...typeImports]) {
    if (spec.startsWith('.') || spec.startsWith('@/')) {
      if (!resolveLocal(spec, file)) {
        problems.push(`${rel(file)}: caminho nao resolvido -> ${spec}`);
      }
      continue;
    }
    if (BUILTIN.test(spec)) continue;
    if (!resolves(spec)) {
      problems.push(`${rel(file)}: pacote ausente no package.json -> ${spec}`);
    }
  }
}

// 2 + 4. client importando servidor
for (const file of clientFiles) {
  const { imports } = meta.get(file);
  for (const spec of imports) {
    if (SERVER_ONLY.includes(spec)) {
      problems.push(`${rel(file)}: componente client importa modulo de servidor -> ${spec}`);
    }
    // Server Actions ('use server') podem ser importadas por client — isso e valido.
    const local = spec.startsWith('@/') || spec.startsWith('.') ? resolveLocal(spec, file) : null;
    if (local && meta.has(local)) {
      const target = meta.get(local);
      if (!target.isClient && !target.isServerAction) {
        const usesServerApi = target.imports.some((i) => SERVER_ONLY.includes(i));
        if (usesServerApi) {
          problems.push(
            `${rel(file)}: importa ${spec}, que usa API exclusiva de servidor sem 'use server'`,
          );
        }
      }
    }
  }
}

// 3. 'use server' so pode exportar funcao async
for (const [file, m] of meta) {
  if (!m.isServerAction) continue;
  const exports = [...m.src.matchAll(/^export\s+(?!type|interface|default\s+async)([a-z]+)/gm)].map(
    (x) => x[1],
  );
  for (const kw of exports) {
    if (kw !== 'async') {
      problems.push(`${rel(file)}: arquivo 'use server' exporta "${kw}" (so async function e permitido)`);
    }
  }
}

function rel(f) {
  return f.replace(ROOT + '/', '');
}

// ---------------------------------------------------------------------
// Permissao inventada trava a tela em producao e passa por tsc, lint e
// teste sem reclamar. Aqui as strings usadas no codigo sao conferidas
// contra o catalogo de permissoes do banco.
// ---------------------------------------------------------------------
const catalogo = new Set();
const sqlCatalogo = join(ROOT, 'supabase/migrations/0011_permissions_catalog.sql');
if (existsSync(sqlCatalogo)) {
  const sql = readFileSync(sqlCatalogo, 'utf8');
  for (const m of sql.matchAll(/\('([a-z_]+\.[a-z_]+)'/g)) catalogo.add(m[1]);
}

if (catalogo.size > 0) {
  const chamadas =
    /(?:assertPermission|requirePermission|permissions\.has|has_permission)\(\s*'([a-z_]+\.[a-z_]+)'/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(chamadas)) {
      if (!catalogo.has(m[1])) {
        problems.push(`${rel(file)}: permissao "${m[1]}" nao existe no catalogo`);
      }
    }
  }
}

console.log(`Arquivos analisados: ${files.length} (${clientFiles.size} client components)`);
if (problems.length) {
  console.error(`\n${problems.length} problema(s) que quebrariam o build:\n`);
  problems.forEach((p) => console.error(' ✗ ' + p));
  process.exit(1);
}
console.log('Nenhum bloqueador de build encontrado.');
