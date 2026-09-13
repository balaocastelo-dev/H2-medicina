-- ============================================================
-- CONFERIR O BANCO ANTES DE PUBLICAR
--
-- Nao altera nada. So responde: o que ja foi aplicado e o que
-- ainda falta. Rode no SQL Editor do Supabase do projeto da H2.
--
-- Leia a coluna "situacao". Tudo "OK" = pode publicar.
-- Qualquer "FALTA" = rode o script indicado na coluna "rodar".
--
-- E seguro rodar quantas vezes quiser, em qualquer estado do
-- banco: se a tabela nem existir, aparece "FALTA" em vez de erro.
-- ============================================================

-- Funcao temporaria: some sozinha quando voce fecha o SQL Editor.
-- Serve para perguntar "quantos?" sem quebrar se a tabela nao existe.
create or replace function pg_temp.conta(consulta text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute consulta into n;
  return n;
exception when undefined_table or undefined_column then
  return -1;  -- tabela/coluna ainda nao existe
end $$;

with checagens as (

  select 'Catalogo de procedimentos'            as item,
         to_regclass('public.procedure_types')  is not null as existe,
         'RODAR-NO-SUPABASE-COMPLETO.sql'       as rodar
  union all
  select 'Destino de cada TV (recepcao x salas)',
         to_regprocedure('public.tv_destino_da_sala(text)') is not null
           and exists (select 1 from information_schema.columns
                       where table_schema = 'public'
                         and table_name   = 'tv_calls'
                         and column_name  = 'destination'),
         'RODAR-NO-SUPABASE-COMPLETO-4-TVS.sql'
  union all
  select 'Assinatura dos medicos',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name   = 'profiles'
                   and column_name  = 'signature_path'),
         'RODAR-NO-SUPABASE-COMPLETO-5-ASSINATURAS.sql'
  union all
  select 'Riscos ocupacionais por empresa',
         to_regclass('public.company_risk_profiles') is not null,
         'RODAR-NO-SUPABASE-COMPLETO-7-RISCOS.sql'
  union all
  select 'Valores por empresa',
         to_regclass('public.company_exam_prices') is not null,
         'RODAR-NO-SUPABASE-COMPLETO-8-VALORES.sql'
  union all
  select 'Preco padrao do exame',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name   = 'exam_types'
                   and column_name  = 'default_price'),
         'RODAR-NO-SUPABASE-COMPLETO-8-VALORES.sql'
  union all
  select 'Dados da clinica preenchidos',
         pg_temp.conta($q$
           select count(*) from tenant_settings
           where key = 'contato'
             and coalesce(value ->> 'telefone', '') <> ''
         $q$) > 0,
         'RODAR-NO-SUPABASE-COMPLETO-6-DADOS-DA-CLINICA.sql'
  union all
  select 'Os 8 medicos cadastrados',
         pg_temp.conta($q$
           select count(*) from profiles
           where council_number is not null and deleted_at is null
         $q$) >= 8,
         'RODAR-NO-SUPABASE-COMPLETO-5-ASSINATURAS.sql'
)

select
  case when existe then 'OK' else 'FALTA' end as situacao,
  item,
  case when existe then '' else rodar end     as rodar
from checagens
order by existe, item;

-- ------------------------------------------------------------
-- Seguranca: nenhuma tabela pode ficar sem RLS.
-- O resultado esperado aqui e ZERO linhas.
-- ------------------------------------------------------------
select tablename as tabela_sem_rls
from pg_tables
where schemaname = 'public'
  and not rowsecurity
order by tablename;
