/**
 * Prova o script de limpeza com dados de verdade dentro.
 *
 * O validador geral levanta o banco so com as migrations, e o script de
 * limpeza recusa banco sem clinica -- corretamente. Aqui o caminho e o
 * mesmo da clinica: migrations, seed, um paciente inteiro passando pelo
 * sistema, e so entao a limpeza.
 *
 * O que ele checa depois:
 *   - o movimento sumiu mesmo, tabela por tabela;
 *   - o cadastro ficou: usuarios, EMPRESAS, salas, exames, procedimentos;
 *   - nenhuma sala ficou presa em "ocupada";
 *   - rodar duas vezes nao quebra.
 *
 *   node scripts/prova-do-zerar.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { citext } from '@electric-sql/pglite/contrib/citext';

const raiz = process.cwd();
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, pg_trgm, unaccent, citext } });

// O mesmo esqueleto que os testes usam: schemas e funcoes que o Supabase
// oferece de fabrica e o PGlite nao tem.
await db.exec(`
  create schema if not exists auth;
  create schema if not exists storage;
  create schema if not exists extensions;
  do $$ begin
    create role anon; exception when duplicate_object then null; end $$;
  do $$ begin
    create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin
    create role service_role; exception when duplicate_object then null; end $$;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
  create table if not exists storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $$ select string_to_array(name, '/') $$;
`);

const migrations = readdirSync(join(raiz, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of migrations) {
  await db.exec(readFileSync(join(raiz, 'supabase/migrations', f), 'utf8'));
}

const seeds = readdirSync(join(raiz, 'supabase/seed')).filter((f) => f.endsWith('.sql')).sort();
for (const f of seeds) {
  await db.exec(readFileSync(join(raiz, 'supabase/seed', f), 'utf8'));
}
console.log(`banco montado: ${migrations.length} migrations + ${seeds.length} seeds`);

// -----------------------------------------------------------------------
// Um paciente de teste com movimento pendurado nele, como o da clinica.
// -----------------------------------------------------------------------
await db.exec(`
do $$
declare
  v_tenant uuid; v_empresa uuid; v_paciente uuid; v_atend uuid;
  v_exame uuid; v_tipo uuid; v_proc uuid; v_medico uuid := gen_random_uuid();
begin
  select id into v_tenant from public.tenants limit 1;

  -- Um medico, para o repasse ter dono. Ele NAO pode ser apagado pela
  -- limpeza: e cadastro, nao movimento.
  insert into auth.users (id, email) values (v_medico, 'medico@teste.local');
  insert into public.profiles (id, tenant_id, full_name, email, council_type, council_number)
  values (v_medico, v_tenant, 'Medico De Teste', 'medico@teste.local', 'CRM', '123456');

  insert into public.companies (tenant_id, legal_name, trade_name, document)
  values (v_tenant, 'EMPRESA DE TESTE LTDA', 'Empresa Teste', '44555666000181')
  returning id into v_empresa;

  insert into public.patients (tenant_id, full_name, cpf, birth_date, company_id)
  values (v_tenant, 'Paciente Do Teste', '22804243800', date '1990-01-15', v_empresa)
  returning id into v_paciente;

  insert into public.attendances (tenant_id, patient_id, company_id, stage_code)
  values (v_tenant, v_paciente, v_empresa, 'em_exames')
  returning id into v_atend;

  insert into public.queue_tickets (tenant_id, attendance_id, patient_id, prefix, sequence)
  values (v_tenant, v_atend, v_paciente, 'A', 1);

  select id into v_tipo from public.exam_types where tenant_id = v_tenant limit 1;
  insert into public.patient_exams (tenant_id, attendance_id, patient_id, exam_type_id, status)
  values (v_tenant, v_atend, v_paciente, v_tipo, 'concluido')
  returning id into v_exame;

  insert into public.exam_results (tenant_id, patient_exam_id, patient_id, values, conclusion)
  values (v_tenant, v_exame, v_paciente, '{"x":"1"}'::jsonb, 'normal');

  insert into public.documents (tenant_id, kind, title, patient_id, attendance_id, bucket, file_path)
  values (v_tenant, 'recibo', 'Recibo', v_paciente, v_atend, 'clinical-documents', 'x.pdf');

  insert into public.payments (tenant_id, attendance_id, patient_id, description, amount, method, status)
  values (v_tenant, v_atend, v_paciente, 'Exames', 100, 'pix', 'pendente');

  insert into public.audit_logs (tenant_id, action, entity, patient_id, description)
  values (v_tenant, 'create', 'patients', v_paciente, 'Paciente Do Teste cadastrado');

  -- Tentativa de login no portal do paciente (0048).
  insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
  values (v_tenant, 'digest-de-teste', false);

  -- O catalogo de procedimentos nao vem do seed: ele e criado pela tela de
  -- Repasse. Entra aqui porque a clinica TEM, e ele nao pode ser apagado.
  insert into public.procedure_types (tenant_id, code, name, default_fee, sort_order)
  values (v_tenant, 'consulta_ocupacional', 'Consulta ocupacional', 100, 100)
  returning id into v_proc;

  insert into public.fee_entries
    (tenant_id, profile_id, attendance_id, patient_id, procedure_type_id,
     procedure_code, procedure_name, fee, competencia)
  values (v_tenant, v_medico, v_atend, v_paciente, v_proc,
          'consulta_ocupacional', 'Consulta ocupacional', 100, date_trunc('month', now())::date);

  -- Sala ocupada pelo atendimento, como fica na vida real.
  update public.rooms set status = 'ocupada', current_attendance_id = v_atend
   where tenant_id = v_tenant and kind = 'exame'
     and id = (select id from public.rooms where tenant_id = v_tenant and kind = 'exame' limit 1);
end$$;
`);

const antes = await db.query(`
  select (select count(*) from public.patients) as pacientes,
         (select count(*) from public.attendances) as atendimentos,
         (select count(*) from public.documents) as documentos,
         (select count(*) from public.payments) as cobrancas,
         (select count(*) from public.audit_logs) as auditoria,
         (select count(*) from public.companies) as empresas,
         (select count(*) from public.rooms where status = 'ocupada') as salas_ocupadas;
`);
console.log('antes  ', antes.rows[0]);

// -----------------------------------------------------------------------
const limpeza = readFileSync(join(raiz, 'supabase/scripts/ZERAR-O-MOVIMENTO.sql'), 'utf8');
await db.exec(limpeza);
console.log('✓ primeira execucao');
await db.exec(limpeza);
console.log('✓ segunda execucao (nao quebra rodando de novo)');

const depois = await db.query(`
  select (select count(*) from public.patients) as pacientes,
         (select count(*) from public.attendances) as atendimentos,
         (select count(*) from public.documents) as documentos,
         (select count(*) from public.payments) as cobrancas,
         (select count(*) from public.exam_results) as resultados,
         (select count(*) from public.queue_tickets) as senhas,
         (select count(*) from public.audit_logs) as auditoria,
         (select count(*) from public.fee_entries) as repasses,
         (select count(*) from public.portal_login_attempts) as tentativas_do_portal,
         (select count(*) from public.rooms where status = 'ocupada') as salas_ocupadas,
         (select count(*) from public.companies) as empresas,
         (select count(*) from public.profiles) as usuarios,
         (select count(*) from public.rooms) as salas,
         (select count(*) from public.exam_types) as exames,
         (select count(*) from public.procedure_types) as procedimentos;
`);
const d = depois.rows[0];
console.log('depois ', d);

const problemas = [];
for (const campo of ['pacientes','atendimentos','documentos','cobrancas','resultados','senhas','auditoria','repasses','tentativas_do_portal','salas_ocupadas']) {
  if (Number(d[campo]) !== 0) problemas.push(`${campo} deveria estar zero, veio ${d[campo]}`);
}
for (const campo of ['empresas','salas','exames','procedimentos','usuarios']) {
  if (Number(d[campo]) === 0) problemas.push(`${campo} NAO deveria ter sido apagado`);
}

if (problemas.length > 0) {
  console.error('\n✗ ' + problemas.join('\n✗ '));
  process.exit(1);
}
console.log('\nScript de limpeza validado: movimento zerado, cadastro intacto, salas livres.');
