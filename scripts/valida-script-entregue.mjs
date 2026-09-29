/**
 * Prova o script que a clinica vai colar no Supabase.
 *
 * O validador geral roda as migrations do repositorio. Isso nao e a mesma
 * coisa: o banco da clinica esta PARADO numa migration anterior, e o que
 * vai ser colado la e um arquivo unico, montado por concatenacao. Um erro
 * de ordem entre as partes so aparece nesse arranjo.
 *
 * Aqui o banco e levantado ate a migration informada como "ja aplicada", e
 * so entao o arquivo entregue e executado -- duas vezes, porque a clinica
 * repete o RUN quando fica em duvida se funcionou.
 *
 *   node scripts/valida-script-entregue.mjs <arquivo.sql> <ultima-migration>
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { citext } from '@electric-sql/pglite/contrib/citext';

const [arquivo, ultima] = process.argv.slice(2);
if (!arquivo || !ultima) {
  console.error('uso: node scripts/valida-script-entregue.mjs <arquivo.sql> <prefixo-da-ultima-migration>');
  process.exit(2);
}

// O mesmo esqueleto que o ambiente de teste usa: schemas, papeis e
// auth.uid(), que no Supabase existem antes de qualquer migration.
const STUB = (() => {
  const fonte = readFileSync(join(process.cwd(), 'tests/integration/ambiente.ts'), 'utf8');
  const m = fonte.match(/const STUB = `([\s\S]*?)`;/);
  if (!m) throw new Error('nao achei o STUB em tests/integration/ambiente.ts');
  return m[1];
})();

const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm, unaccent, citext } });
await db.exec(STUB);

const dir = join(process.cwd(), 'supabase/migrations');
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const corte = migrations.findIndex((f) => f.startsWith(ultima));
if (corte < 0) {
  console.error(`migration "${ultima}" nao encontrada`);
  process.exit(2);
}

for (const f of migrations.slice(0, corte + 1)) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
  console.log(`  aplicada ${f}`);
}
console.log(`\nbanco no estado da clinica (ate ${migrations[corte]})\n`);

const sql = readFileSync(arquivo, 'utf8');
for (const vez of ['primeira', 'segunda']) {
  try {
    await db.exec(sql);
    console.log(`✓ ${vez} execucao`);
  } catch (e) {
    console.error(`✗ ${vez} execucao: ${e.message}`);
    process.exit(1);
  }
}

// O seed vem depois, e nao antes: ele descreve o catalogo da clinica hoje,
// e pode usar colunas que o script acabou de criar. Rodar antes seria
// testar uma ordem que nao existe em lugar nenhum.
for (const f of readdirSync(join(process.cwd(), 'supabase/seed')).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(process.cwd(), 'supabase/seed', f), 'utf8'));
  } catch (e) {
    console.error(`✗ seed ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log('✓ seed aplicado sobre o script');

// O que a clinica vai conferir na tela, perguntado ao banco.
const { rows } = await db.query(`
  select
    (select count(*)::int from public.exam_types where code = 'ROMBERG' and respondido_pelo_medico
       and not coalesce(ocupa_sala, true) and default_room_id is null) as romberg_ok,
    (select count(*)::int from public.room_exam_types ret
       join public.exam_types et on et.id = ret.exam_type_id where et.code = 'ROMBERG') as romberg_em_sala,
    (select count(*)::int from pg_proc where proname = 'can_access_any') as tem_can_access_any,
    (select count(*)::int from pg_proc where proname = 'atendimento_tem_parecer') as tem_parecer_fn,
    (select count(*)::int from pg_proc where proname = 'registrar_acesso_clinico') as tem_log_fn,
    (select count(*)::int from public.role_permissions rp
       join public.roles r on r.id = rp.role_id
      where r.code = 'atendimento' and rp.permission_code = 'exames.concluir') as recepcao_conclui`);
const r = rows[0];
console.log('\nconferencia:', JSON.stringify(r));

const faltando = Object.entries(r)
  .filter(([k, v]) => (k === 'romberg_em_sala' ? v !== 0 : v < 1))
  .map(([k]) => k);

if (faltando.length > 0) {
  console.error(`✗ faltou no banco: ${faltando.join(', ')}`);
  console.error('✗ o script rodou mas nao deixou o banco no estado esperado');
  process.exit(1);
}

await db.close();
console.log('\nScript entregue validado.');
