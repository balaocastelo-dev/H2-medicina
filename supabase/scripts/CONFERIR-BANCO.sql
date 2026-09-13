-- ============================================================
-- CONFERIR O BANCO ANTES DE PUBLICAR
--
-- Nao altera nada. So responde: o que ja foi aplicado, o que
-- falta, e o que fazer em cada caso.
--
-- Rode no SQL Editor do Supabase do projeto da H2 e leia de cima
-- para baixo: o que precisa de acao vem primeiro.
--
-- Devolve UMA tabela so. O SQL Editor do Supabase mostra apenas o
-- resultado da ultima consulta, entao tudo foi reunido num
-- resultado unico -- senao metade da resposta se perde na tela.
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

with estrutura as (

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
),

medicos as (
  select pg_temp.conta($q$
           select count(*) from profiles
           where council_number is not null and deleted_at is null
         $q$) as quantos
),

-- Tudo vira uma tabela so, com uma ordem de leitura.
tudo as (

  -- 1. Estrutura do banco
  select case when existe then 3 else 1 end as ordem,
         case when existe then 'OK' else 'FALTA' end as situacao,
         item,
         case when existe then '' else fazer end as o_que_fazer
    from estrutura

  union all

  -- 2. Medicos: precisam de login proprio, entao nao se criam por SQL.
  select case when quantos >= 8 then 3 else 1 end,
         case when quantos >= 8 then 'OK' else 'FALTA' end,
         'Medicos cadastrados: ' || greatest(quantos, 0) || ' de 8',
         case when quantos >= 8 then ''
              else 'Cadastrar os que faltam em Usuarios, dentro do '
                   || 'sistema. Medico precisa de login, entao nao da '
                   || 'para criar por SQL.' end
    from medicos

  union all

  -- 3. Seguranca: tabela sem RLS fica exposta a quem tiver a chave publica.
  select 2,
         'RISCO',
         'Tabela sem protecao de acesso: ' || tablename,
         'Nao ligue a protecao sem antes escrever as regras: sem '
           || 'regra, a tabela bloqueia todo mundo e derruba a tela '
           || 'que usa ela.'
    from pg_tables
   where schemaname = 'public' and not rowsecurity

  union all

  -- 4. Fecho, para nao restar duvida de que a parte de RLS rodou.
  select 3, 'OK', 'Protecao de acesso (RLS) em todas as tabelas', ''
   where not exists (select 1 from pg_tables
                      where schemaname = 'public' and not rowsecurity)
)

select situacao, item, o_que_fazer
  from tudo
 order by ordem, item;
