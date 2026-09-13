-- ============================================================
-- CONFERIR O BANCO ANTES DE PUBLICAR
--
-- Nao altera nada. So responde: o que ja foi aplicado e o que
-- ainda falta. Rode no SQL Editor do Supabase do projeto da H2.
--
-- Leia a coluna "situacao". Tudo "OK" = pode publicar.
-- Qualquer "FALTA" = faca o que diz a coluna "o que fazer".
--
-- E seguro rodar quantas vezes quiser, em qualquer estado do
-- banco: se a tabela nem existir, aparece "FALTA" em vez de erro.
-- ============================================================

-- Funcao temporaria: some sozinha quando voce fecha o SQL Editor.
-- Serve para perguntar "quantos?" sem quebrar se a tabela nao existe.
--
-- So engole "tabela nao existe", que e justamente o caso de FALTA.
-- Erro de coluna estoura de proposito: se eu digitar o nome errado de
-- uma coluna aqui, quero ver um erro vermelho e nao um "FALTA" educado
-- que parece resultado de verdade.
create or replace function pg_temp.conta(consulta text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute consulta into n;
  return n;
exception when undefined_table then
  return -1;
end $$;

with checagens as (

  select 'Catalogo de procedimentos'            as item,
         to_regclass('public.procedure_types')  is not null as existe,
         'Rodar RODAR-NO-SUPABASE-COMPLETO.sql' as fazer
  union all
  select 'Destino de cada TV (recepcao x salas)',
         to_regprocedure('public.tv_destino_da_sala(text)') is not null
           and exists (select 1 from information_schema.columns
                       where table_schema = 'public'
                         and table_name   = 'tv_calls'
                         and column_name  = 'destination'),
         'Rodar RODAR-NO-SUPABASE-4-TVS.sql'
  union all
  select 'Campos de assinatura do medico',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name   = 'profiles'
                   and column_name  = 'signature_path'),
         'Rodar RODAR-NO-SUPABASE-5-ASSINATURAS.sql'
  union all
  select 'Riscos ocupacionais por empresa',
         to_regclass('public.company_risk_profiles') is not null,
         'Rodar RODAR-NO-SUPABASE-7-RISCOS.sql'
  union all
  select 'Valores por empresa',
         to_regclass('public.company_exam_prices') is not null,
         'Rodar RODAR-NO-SUPABASE-8-VALORES.sql'
  union all
  select 'Preco padrao do exame',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public'
                   and table_name   = 'exam_types'
                   and column_name  = 'default_price'),
         'Rodar RODAR-NO-SUPABASE-8-VALORES.sql'
  union all
  -- Atencao: a tabela usa group_key/settings, nao key/value.
  select 'Dados da clinica preenchidos',
         pg_temp.conta($q$
           select count(*) from tenant_settings
           where group_key = 'contato'
             and coalesce(settings ->> 'telefone', '') <> ''
         $q$) > 0,
         'Rodar RODAR-NO-SUPABASE-6-DADOS-DA-CLINICA.sql'
  union all
  -- Medico precisa de login proprio, entao nao da para criar por SQL:
  -- o cadastro e feito no sistema, que cria o acesso junto.
  select 'Os 8 medicos cadastrados',
         pg_temp.conta($q$
           select count(*) from profiles
           where council_number is not null and deleted_at is null
         $q$) >= 8,
         'Cadastrar em Usuarios, dentro do sistema (nao e SQL)'
)

select
  case when existe then 'OK' else 'FALTA' end as situacao,
  item,
  case when existe then '' else fazer end     as o_que_fazer
from checagens
order by existe, item;

-- ------------------------------------------------------------
-- Quantos medicos existem hoje, para o caso de dar FALTA acima.
-- Passa pela funcao protegida para nao quebrar em banco recem-criado.
-- ------------------------------------------------------------
select pg_temp.conta($q$
         select count(*) from profiles
         where council_number is not null and deleted_at is null
       $q$) as medicos_com_registro_no_conselho;

-- ------------------------------------------------------------
-- Seguranca: nenhuma tabela pode ficar sem RLS.
-- O resultado esperado aqui e ZERO linhas.
-- ------------------------------------------------------------
select tablename as tabela_sem_rls
from pg_tables
where schemaname = 'public'
  and not rowsecurity
order by tablename;
