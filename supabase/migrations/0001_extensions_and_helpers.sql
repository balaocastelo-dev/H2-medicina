-- =====================================================================
-- 0001 - Extensoes, tipos, helpers e infraestrutura comum
-- Plataforma white label multi-tenant de medicina ocupacional
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";
create extension if not exists "citext";

-- ---------------------------------------------------------------------
-- Tipos enumerados estaveis (os variaveis ficam em tabelas configuraveis)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'gender_type') then
    create type gender_type as enum ('masculino','feminino','outro','nao_informado');
  end if;

  if not exists (select 1 from pg_type where typname = 'priority_level') then
    create type priority_level as enum ('normal','prioritario','encaixe');
  end if;

  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum
      ('agendado','confirmado','checkin','em_atendimento','realizado','cancelado','ausente','remarcado');
  end if;

  if not exists (select 1 from pg_type where typname = 'exam_execution_status') then
    create type exam_execution_status as enum
      ('pendente','em_fila','chamado','em_andamento','concluido','nao_realizado','cancelado');
  end if;

  if not exists (select 1 from pg_type where typname = 'room_status') then
    create type room_status as enum ('disponivel','ocupada','pausada','inativa');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type payment_method as enum
      ('pix','cartao','dinheiro','link','faturamento','manual','cortesia','cupom');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum
      ('pendente','em_analise','pago','cancelado','estornado','falhou');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum
      ('carrinho','aguardando_pagamento','pago','em_analise','agendamento_pendente',
       'agendado','em_atendimento','concluido','cancelado','reembolsado','pagamento_recusado');
  end if;

  if not exists (select 1 from pg_type where typname = 'data_origin') then
    create type data_origin as enum
      ('manual','importacao_excel','importacao_csv','scraper','ecommerce','totem','api','seed');
  end if;

  if not exists (select 1 from pg_type where typname = 'medical_verdict') then
    create type medical_verdict as enum
      ('apto','apto_com_restricoes','inapto','inconclusivo');
  end if;

  if not exists (select 1 from pg_type where typname = 'scraper_run_status') then
    create type scraper_run_status as enum
      ('pendente','executando','concluido','concluido_com_erros','erro','cancelado');
  end if;

  if not exists (select 1 from pg_type where typname = 'import_review_status') then
    create type import_review_status as enum
      ('pendente','aprovado','ignorado','conflito','erro','importado');
  end if;

  if not exists (select 1 from pg_type where typname = 'campaign_status') then
    create type campaign_status as enum
      ('rascunho','aguardando_aprovacao','aprovada','agendada','enviando','enviada','cancelada');
  end if;

  if not exists (select 1 from pg_type where typname = 'product_kind') then
    create type product_kind as enum
      ('exame','consulta','pacote','servico','servico_empresarial','avaliacao','produto_fisico','combo');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_kind') then
    create type document_kind as enum
      ('resumo_atendimento','ficha_clinica','relacao_exames','resultado_exame','recibo',
       'comprovante_comparecimento','atestado_comparecimento','documento_final',
       'comprovante_compra','resumo_pedido','relatorio_empresarial');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- Utilidades gerais
-- ---------------------------------------------------------------------

-- Mantem updated_at sempre coerente
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Normalizacao de texto para busca (sem acento, minusculo)
create or replace function public.normalize_text(input text)
returns text
language sql
immutable
as $$
  select nullif(btrim(lower(unaccent(coalesce(input, '')))), '');
$$;

-- Mantem apenas digitos (CPF, CNPJ, telefone, CEP)
create or replace function public.only_digits(input text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(input, ''), '\D', '', 'g'), '');
$$;

-- Validacao real de CPF (digitos verificadores)
create or replace function public.is_valid_cpf(input text)
returns boolean
language plpgsql
immutable
as $$
declare
  d text := public.only_digits(input);
  s int := 0;
  r int;
  i int;
begin
  if d is null or length(d) <> 11 then return false; end if;
  if d ~ '^(\d)\1{10}$' then return false; end if;

  for i in 1..9 loop
    s := s + (substr(d, i, 1))::int * (11 - i);
  end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  if r <> (substr(d, 10, 1))::int then return false; end if;

  s := 0;
  for i in 1..10 loop
    s := s + (substr(d, i, 1))::int * (12 - i);
  end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  return r = (substr(d, 11, 1))::int;
end;
$$;

-- Validacao real de CNPJ
create or replace function public.is_valid_cnpj(input text)
returns boolean
language plpgsql
immutable
as $$
declare
  d text := public.only_digits(input);
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int := 0;
  r int;
  i int;
begin
  if d is null or length(d) <> 14 then return false; end if;
  if d ~ '^(\d)\1{13}$' then return false; end if;

  for i in 1..12 loop
    s := s + (substr(d, i, 1))::int * w1[i];
  end loop;
  r := s % 11;
  r := case when r < 2 then 0 else 11 - r end;
  if r <> (substr(d, 13, 1))::int then return false; end if;

  s := 0;
  for i in 1..13 loop
    s := s + (substr(d, i, 1))::int * w2[i];
  end loop;
  r := s % 11;
  r := case when r < 2 then 0 else 11 - r end;
  return r = (substr(d, 14, 1))::int;
end;
$$;

-- Calculo de idade a partir da data de nascimento
create or replace function public.calc_age(birth date)
returns int
language sql
immutable
as $$
  select case when birth is null then null
              else extract(year from age(current_date, birth))::int end;
$$;

-- IMC
create or replace function public.calc_bmi(weight_kg numeric, height_cm numeric)
returns numeric
language sql
immutable
as $$
  select case
    when weight_kg is null or height_cm is null or height_cm <= 0 then null
    else round(weight_kg / power(height_cm / 100.0, 2), 2)
  end;
$$;

comment on function public.is_valid_cpf is 'Valida CPF com digitos verificadores; usado em constraints e normalizacao de importacao.';
