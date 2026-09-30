
-- ==========================================================
-- MIGRATIONS: 0001_extensions_and_helpers.sql
-- ==========================================================

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


-- ==========================================================
-- MIGRATIONS: 0002_tenants_and_identity.sql
-- ==========================================================

-- =====================================================================
-- 0002 - Tenants, white label, identidade, papeis e permissoes
-- =====================================================================

-- ---------------------------------------------------------------------
-- TENANTS
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            citext not null unique,
  legal_name      text not null,
  trade_name      text not null,
  document        text,
  is_active       boolean not null default true,
  primary_domain  text,
  timezone        text not null default 'America/Sao_Paulo',
  locale          text not null default 'pt-BR',
  currency        text not null default 'BRL',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint tenants_document_valid
    check (document is null or public.is_valid_cnpj(document) or public.is_valid_cpf(document))
);
create index if not exists idx_tenants_active on public.tenants (is_active) where deleted_at is null;

-- Configuracoes gerais (chave/valor tipado por grupo) -------------------
create table if not exists public.tenant_settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  group_key   text not null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, group_key)
);
comment on table public.tenant_settings is
  'Configuracoes editaveis pelo painel. group_key: empresa, contato, documentos, responsavel_tecnico, totem, painel_tv, filas, ecommerce, scraper, email, ia, pagamento, app, institucional.';

-- Marca / identidade visual --------------------------------------------
create table if not exists public.tenant_branding (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  system_name      text not null default 'Sistema Clinico',
  logo_url         text,
  logo_compact_url text,
  favicon_url      text,
  color_primary    text not null default '#0F766E',
  color_secondary  text not null default '#0EA5E9',
  color_accent     text not null default '#F59E0B',
  color_sidebar    text not null default '#0B1220',
  footer_text      text,
  pdf_header_html  text,
  pdf_footer_html  text,
  login_background_url text,
  status_colors    jsonb not null default jsonb_build_object(
    'aguardando','#9CA3AF',
    'chamado','#FACC15',
    'pendente','#FB923C',
    'em_atendimento','#3B82F6',
    'concluido','#22C55E',
    'alerta','#EF4444',
    'aguardando_medico','#A855F7',
    'cancelado','#4B5563'
  ),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Modulos habilitados ---------------------------------------------------
create table if not exists public.tenant_modules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  module_key  text not null,
  is_enabled  boolean not null default true,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, module_key)
);

-- ---------------------------------------------------------------------
-- IDENTIDADE
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  tenant_id         uuid references public.tenants(id) on delete set null,
  full_name         text not null default '',
  email             citext,
  phone             text,
  avatar_url        text,
  job_title         text,
  council_type      text,               -- CRM, COREN, etc.
  council_number    text,
  council_state     text,
  signature_url     text,
  is_active         boolean not null default true,
  is_platform_admin boolean not null default false,
  blocked_at        timestamptz,
  blocked_reason    text,
  last_sign_in_at   timestamptz,
  must_change_password boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz
);
create index if not exists idx_profiles_tenant on public.profiles (tenant_id) where deleted_at is null;

-- Papeis ---------------------------------------------------------------
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  code         text not null,
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Catalogo global de permissoes ----------------------------------------
create table if not exists public.permissions (
  code        text primary key,
  module      text not null,
  name        text not null,
  description text,
  is_sensitive boolean not null default false
);

create table if not exists public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, role_id)
);

-- Permissoes concedidas/revogadas individualmente ----------------------
create table if not exists public.user_permissions (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  is_granted      boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  primary key (user_id, permission_code)
);

-- Convites --------------------------------------------------------------
create table if not exists public.user_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       citext not null,
  full_name   text,
  role_id     uuid references public.roles(id) on delete set null,
  token_hash  text not null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (tenant_id, email, token_hash)
);

-- Sessoes/auditoria de acesso -------------------------------------------
create table if not exists public.auth_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete set null,
  user_id     uuid,
  email       citext,
  event       text not null,       -- login, logout, login_failed, password_reset, blocked
  ip_address  inet,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_auth_events_tenant_date on public.auth_events (tenant_id, created_at desc);

-- ---------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tenants','tenant_settings','tenant_branding','tenant_modules',
    'profiles','roles'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Helpers de seguranca (usados por todas as policies de RLS)
-- ---------------------------------------------------------------------

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_platform_admin and is_active and deleted_at is null
                   from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_active and blocked_at is null and deleted_at is null
                   from public.profiles where id = auth.uid()), false);
$$;

-- Pertence ao tenant informado (admin da plataforma passa em qualquer um)
create or replace function public.belongs_to_tenant(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
     and (public.is_platform_admin() or target = public.current_tenant_id());
$$;

-- Permissao efetiva = (papel concede OU concessao individual) E nao revogada
create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user() and (
    public.is_platform_admin()
    or (
      not exists (
        select 1 from public.user_permissions up
        where up.user_id = auth.uid() and up.permission_code = perm and up.is_granted = false
      )
      and (
        exists (
          select 1
          from public.user_roles ur
          join public.role_permissions rp on rp.role_id = ur.role_id
          where ur.user_id = auth.uid() and rp.permission_code = perm
        )
        or exists (
          select 1 from public.user_permissions up
          where up.user_id = auth.uid() and up.permission_code = perm and up.is_granted = true
        )
      )
    )
  );
$$;

-- Acesso a um registro do tenant exigindo permissao
create or replace function public.can_access(target_tenant uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.belongs_to_tenant(target_tenant) and public.has_permission(perm);
$$;

comment on function public.has_permission is
  'Permissao efetiva do usuario autenticado. Revogacao individual sempre prevalece sobre o papel.';


-- ==========================================================
-- MIGRATIONS: 0003_companies_and_patients.sql
-- ==========================================================

-- =====================================================================
-- 0003 - Empresas clientes, contatos, pacientes e vinculos empregaticios
-- =====================================================================

-- ---------------------------------------------------------------------
-- EMPRESAS (onde os pacientes trabalham)
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  legal_name            text not null,
  trade_name            text,
  document              text,                        -- CNPJ (somente digitos)
  state_registration    text,
  municipal_registration text,
  segment               text,
  zip_code              text,
  street                text,
  number                text,
  complement            text,
  district              text,
  city                  text,
  state                 char(2),
  phone                 text,
  whatsapp              text,
  website               text,
  email                 citext,
  email_admin           citext,
  email_financial       citext,
  email_commercial      citext,
  responsible_name      text,
  responsible_role      text,
  origin                data_origin not null default 'manual',
  external_id           text,
  situation             text not null default 'ativa',      -- ativa | inativa | prospect | bloqueada
  legal_basis           text,                                -- base legal LGPD para comunicacao
  consent_at            timestamptz,
  allow_marketing       boolean not null default false,
  marketing_blocked_at  timestamptz,
  last_campaign_at      timestamptz,
  last_attendance_at    timestamptz,
  employees_served      int not null default 0,
  notes                 text,
  search_key            text generated always as (public.normalize_text(legal_name || ' ' || coalesce(trade_name,''))) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  deleted_at            timestamptz,
  constraint companies_document_valid check (document is null or public.is_valid_cnpj(document)),
  constraint companies_state_valid check (state is null or state ~ '^[A-Z]{2}$')
);
create unique index if not exists uq_companies_tenant_document
  on public.companies (tenant_id, document) where document is not null and deleted_at is null;
create unique index if not exists uq_companies_tenant_external
  on public.companies (tenant_id, external_id) where external_id is not null and deleted_at is null;
create index if not exists idx_companies_search on public.companies using gin (search_key gin_trgm_ops);
create index if not exists idx_companies_tenant on public.companies (tenant_id) where deleted_at is null;

create table if not exists public.company_contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  role        text,
  department  text,
  email       citext,
  phone       text,
  whatsapp    text,
  is_primary  boolean not null default false,
  allow_marketing boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz
);
create index if not exists idx_company_contacts_company on public.company_contacts (company_id) where deleted_at is null;

-- Contratos / pacotes corporativos --------------------------------------
create table if not exists public.company_contracts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text,
  name          text not null,
  starts_on     date,
  ends_on       date,
  credits_total int,
  credits_used  int not null default 0,
  amount        numeric(12,2),
  status        text not null default 'ativo',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);
create index if not exists idx_company_contracts_company on public.company_contracts (company_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- PACIENTES
-- ---------------------------------------------------------------------
create table if not exists public.patients (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  full_name          text not null,
  social_name        text,
  cpf                text,
  rg                 text,
  external_document  text,
  birth_date         date,
  gender             gender_type not null default 'nao_informado',
  mother_name        text,
  phone              text,
  whatsapp           text,
  email              citext,
  zip_code           text,
  street             text,
  number             text,
  complement         text,
  district           text,
  city               text,
  state              char(2),
  company_id         uuid references public.companies(id) on delete set null,
  job_title          text,
  department         text,
  registration_number text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  notes              text,
  origin             data_origin not null default 'manual',
  external_id        text,
  portal_user_id     uuid,                       -- vinculo opcional com auth.users (PWA)
  needs_review       boolean not null default false,
  review_reason      text,
  search_key         text generated always as (public.normalize_text(full_name || ' ' || coalesce(social_name,''))) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  constraint patients_cpf_valid check (cpf is null or public.is_valid_cpf(cpf)),
  constraint patients_state_valid check (state is null or state ~ '^[A-Z]{2}$'),
  constraint patients_birth_sane check (birth_date is null or birth_date <= current_date)
);
create unique index if not exists uq_patients_tenant_cpf
  on public.patients (tenant_id, cpf) where cpf is not null and deleted_at is null;
create unique index if not exists uq_patients_tenant_external
  on public.patients (tenant_id, external_id) where external_id is not null and deleted_at is null;
create index if not exists idx_patients_search on public.patients using gin (search_key gin_trgm_ops);
create index if not exists idx_patients_tenant on public.patients (tenant_id) where deleted_at is null;
create index if not exists idx_patients_company on public.patients (company_id) where deleted_at is null;
create index if not exists idx_patients_name_birth on public.patients (tenant_id, search_key, birth_date);

-- Historico profissional -------------------------------------------------
create table if not exists public.patient_employments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  patient_id    uuid not null references public.patients(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  job_title     text,
  department    text,
  registration_number text,
  started_on    date,
  ended_on      date,
  is_current    boolean not null default true,
  origin        data_origin not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid
);
create index if not exists idx_patient_employments_patient on public.patient_employments (patient_id);
create unique index if not exists uq_patient_employment_current
  on public.patient_employments (patient_id, company_id) where is_current;

-- Fila de revisao de duplicidades ---------------------------------------
create table if not exists public.patient_duplicates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  candidate_id    uuid references public.patients(id) on delete cascade,
  match_rule      text not null,        -- cpf | documento_externo | nome_nascimento | nome_empresa_data
  confidence      numeric(5,2) not null default 0,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pendente',   -- pendente | vinculado | ignorado | separado
  resolved_at     timestamptz,
  resolved_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_patient_duplicates_status on public.patient_duplicates (tenant_id, status);

-- Consentimentos LGPD do paciente ---------------------------------------
create table if not exists public.patient_consents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete cascade,
  purpose     text not null,           -- atendimento | comunicacao | compartilhamento_empresa
  granted     boolean not null,
  legal_basis text,
  source      text,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  created_by  uuid
);
create index if not exists idx_patient_consents_patient on public.patient_consents (patient_id);

do $$
declare t text;
begin
  foreach t in array array[
    'companies','company_contacts','company_contracts',
    'patients','patient_employments','patient_duplicates'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0004_scheduling_queues_rooms.sql
-- ==========================================================

-- =====================================================================
-- 0004 - Agenda, atendimentos, salas, senhas e filas
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos de exame / servico clinico
-- ---------------------------------------------------------------------
create table if not exists public.exam_types (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  code                text not null,
  name                text not null,
  description         text,
  average_minutes     int not null default 15,
  default_room_id     uuid,
  default_professional_id uuid references public.profiles(id) on delete set null,
  custom_fields       jsonb not null default '[]'::jsonb,
  instructions        text,
  preparation         text,
  result_template     text,
  requires_result_document boolean not null default false,
  sort_order          int not null default 0,
  price               numeric(12,2),
  available_online    boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  deleted_at          timestamptz,
  unique (tenant_id, code)
);
create index if not exists idx_exam_types_tenant on public.exam_types (tenant_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Salas
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  kind                  text not null default 'exame',   -- recepcao | triagem | exame | consultorio | guiche
  capacity              int not null default 1,
  status                room_status not null default 'disponivel',
  responsible_id        uuid references public.profiles(id) on delete set null,
  current_attendance_id uuid,
  is_active             boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  deleted_at            timestamptz,
  unique (tenant_id, code)
);
create index if not exists idx_rooms_tenant on public.rooms (tenant_id) where deleted_at is null;

alter table public.exam_types
  drop constraint if exists exam_types_default_room_fk;
alter table public.exam_types
  add constraint exam_types_default_room_fk
  foreign key (default_room_id) references public.rooms(id) on delete set null;

-- Salas habilitadas por tipo de exame ------------------------------------
create table if not exists public.room_exam_types (
  room_id      uuid not null references public.rooms(id) on delete cascade,
  exam_type_id uuid not null references public.exam_types(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  primary key (room_id, exam_type_id)
);

create table if not exists public.room_status_history (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  status        room_status not null,
  attendance_id uuid,
  changed_by    uuid,
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_room_status_history_room on public.room_status_history (room_id, created_at desc);

-- ---------------------------------------------------------------------
-- Estagios do CRM (configuraveis por tenant)
-- ---------------------------------------------------------------------
create table if not exists public.crm_stages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  color       text not null default '#9CA3AF',
  sort_order  int not null default 0,
  is_terminal boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

-- ---------------------------------------------------------------------
-- AGENDAMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  patient_id         uuid not null references public.patients(id) on delete cascade,
  company_id         uuid references public.companies(id) on delete set null,
  order_id           uuid,
  scheduled_at       timestamptz not null,
  scheduled_date     date generated always as ((scheduled_at at time zone 'America/Sao_Paulo')::date) stored,
  duration_minutes   int not null default 30,
  attendance_kind    text not null default 'admissional',  -- admissional | periodico | demissional | mudanca_funcao | retorno_trabalho | consulta | outro
  priority           priority_level not null default 'normal',
  status             appointment_status not null default 'agendado',
  professional_id    uuid references public.profiles(id) on delete set null,
  room_id            uuid references public.rooms(id) on delete set null,
  origin             data_origin not null default 'manual',
  external_id        text,
  external_link      text,
  source_connector_id uuid,
  confirmed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  rescheduled_from   uuid references public.appointments(id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz
);
create index if not exists idx_appointments_tenant_date
  on public.appointments (tenant_id, scheduled_date) where deleted_at is null;
create index if not exists idx_appointments_company on public.appointments (company_id, scheduled_date);
create index if not exists idx_appointments_patient on public.appointments (patient_id, scheduled_at desc);
create unique index if not exists uq_appointments_external
  on public.appointments (tenant_id, source_connector_id, external_id)
  where external_id is not null and deleted_at is null;
-- Evita duplicidade logica: mesmo paciente, mesmo dia, mesmo tenant
create unique index if not exists uq_appointments_patient_day
  on public.appointments (tenant_id, patient_id, scheduled_date)
  where deleted_at is null and status not in ('cancelado','remarcado');

create table if not exists public.appointment_exams (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  exam_type_id   uuid not null references public.exam_types(id) on delete restrict,
  origin         data_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (appointment_id, exam_type_id)
);

-- ---------------------------------------------------------------------
-- ATENDIMENTOS (jornada do dia)
-- ---------------------------------------------------------------------
create table if not exists public.attendances (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  appointment_id      uuid references public.appointments(id) on delete set null,
  patient_id          uuid not null references public.patients(id) on delete cascade,
  company_id          uuid references public.companies(id) on delete set null,
  order_id            uuid,
  attendance_number   bigint,
  stage_code          text not null default 'aguardando_recepcao',
  priority            priority_level not null default 'normal',
  needs_triage        boolean not null default true,
  checkin_at          timestamptz not null default now(),
  reception_started_at   timestamptz,
  reception_finished_at  timestamptz,
  triage_started_at   timestamptz,
  triage_finished_at  timestamptz,
  exams_started_at    timestamptz,
  exams_finished_at   timestamptz,
  consultation_started_at  timestamptz,
  consultation_finished_at timestamptz,
  finished_at         timestamptz,
  exit_at             timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  absent_at           timestamptz,
  current_room_id     uuid references public.rooms(id) on delete set null,
  in_service          boolean not null default false,
  payment_status      payment_status not null default 'pendente',
  origin              data_origin not null default 'totem',
  notes               text,
  stage_changed_at    timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  deleted_at          timestamptz
);
create index if not exists idx_attendances_tenant_stage on public.attendances (tenant_id, stage_code) where deleted_at is null;
create index if not exists idx_attendances_patient on public.attendances (patient_id, checkin_at desc);
create index if not exists idx_attendances_open
  on public.attendances (tenant_id, checkin_at desc) where finished_at is null and deleted_at is null;

create sequence if not exists public.attendance_number_seq;

alter table public.rooms
  drop constraint if exists rooms_current_attendance_fk;
alter table public.rooms
  add constraint rooms_current_attendance_fk
  foreign key (current_attendance_id) references public.attendances(id) on delete set null;

alter table public.room_status_history
  drop constraint if exists room_status_history_attendance_fk;
alter table public.room_status_history
  add constraint room_status_history_attendance_fk
  foreign key (attendance_id) references public.attendances(id) on delete set null;

-- ---------------------------------------------------------------------
-- SENHAS (totem)
-- ---------------------------------------------------------------------
create table if not exists public.totems (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  location    text,
  is_active   boolean not null default true,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.queue_tickets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  attendance_id  uuid references public.attendances(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id     uuid references public.patients(id) on delete set null,
  totem_id       uuid references public.totems(id) on delete set null,
  prefix         text not null default 'A',
  sequence       int not null,
  code           text generated always as (prefix || lpad(sequence::text, 3, '0')) stored,
  ticket_type    priority_level not null default 'normal',
  service_date   date not null default (now() at time zone 'America/Sao_Paulo')::date,
  issued_at      timestamptz not null default now(),
  printed_at     timestamptz,
  origin         data_origin not null default 'totem',
  device_info    text,
  ip_address     inet,
  created_at     timestamptz not null default now(),
  unique (tenant_id, service_date, prefix, sequence)
);
create index if not exists idx_queue_tickets_day on public.queue_tickets (tenant_id, service_date, issued_at desc);

-- Chamadas / eventos de fila --------------------------------------------
create table if not exists public.queue_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ticket_id     uuid references public.queue_tickets(id) on delete set null,
  attendance_id uuid references public.attendances(id) on delete set null,
  room_id       uuid references public.rooms(id) on delete set null,
  exam_id       uuid,
  event         text not null,   -- emitida | chamada | rechamada | iniciada | concluida | transferida | pausada | ausente | cancelada
  destination   text,            -- recepcao | triagem | sala | exame
  called_by     uuid,
  is_manual     boolean not null default false,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_queue_events_tenant_date on public.queue_events (tenant_id, created_at desc);
create index if not exists idx_queue_events_attendance on public.queue_events (attendance_id, created_at desc);

-- Painel de TV: ultimas chamadas (view materializada logica via tabela) --
create table if not exists public.tv_calls (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ticket_code   text not null,
  patient_label text,
  room_name     text,
  destination   text,
  priority      priority_level not null default 'normal',
  is_recall     boolean not null default false,
  called_at     timestamptz not null default now()
);
create index if not exists idx_tv_calls_tenant on public.tv_calls (tenant_id, called_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'exam_types','rooms','crm_stages','appointments','attendances','totems'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0005_clinical.sql
-- ==========================================================

-- =====================================================================
-- 0005 - Triagem, exames do paciente, resultados e modulo medico
-- =====================================================================

-- ---------------------------------------------------------------------
-- TRIAGEM
-- ---------------------------------------------------------------------
create table if not exists public.triages (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  attendance_id      uuid not null references public.attendances(id) on delete cascade,
  patient_id         uuid not null references public.patients(id) on delete cascade,
  professional_id    uuid references public.profiles(id) on delete set null,
  blood_pressure_systolic  int,
  blood_pressure_diastolic int,
  temperature_c      numeric(4,1),
  weight_kg          numeric(6,2),
  height_cm          numeric(5,1),
  bmi                numeric(5,2) generated always as (public.calc_bmi(weight_kg, height_cm)) stored,
  heart_rate         int,
  respiratory_rate   int,
  oxygen_saturation  int,
  glucose            numeric(6,2),
  symptoms           text,
  alerts             text,
  restrictions       text,
  initial_notes      text,
  observations       text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  constraint triages_bp_sane check (
    (blood_pressure_systolic is null or blood_pressure_systolic between 40 and 300) and
    (blood_pressure_diastolic is null or blood_pressure_diastolic between 20 and 200)),
  constraint triages_saturation_sane check (oxygen_saturation is null or oxygen_saturation between 30 and 100),
  unique (attendance_id)
);
create index if not exists idx_triages_patient on public.triages (patient_id, created_at desc);

-- Historico de alteracoes da triagem ------------------------------------
create table if not exists public.triage_revisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  triage_id   uuid not null references public.triages(id) on delete cascade,
  changed_by  uuid,
  previous    jsonb not null,
  current     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_triage_revisions_triage on public.triage_revisions (triage_id, created_at desc);

-- ---------------------------------------------------------------------
-- EXAMES DO PACIENTE (filas por sala)
-- ---------------------------------------------------------------------
create table if not exists public.patient_exams (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  attendance_id      uuid not null references public.attendances(id) on delete cascade,
  patient_id         uuid not null references public.patients(id) on delete cascade,
  appointment_id     uuid references public.appointments(id) on delete set null,
  exam_type_id       uuid not null references public.exam_types(id) on delete restrict,
  order_item_id      uuid,
  room_id            uuid references public.rooms(id) on delete set null,
  professional_id    uuid references public.profiles(id) on delete set null,
  status             exam_execution_status not null default 'pendente',
  priority           priority_level not null default 'normal',
  queued_at          timestamptz,
  called_at          timestamptz,
  recalled_count     int not null default 0,
  started_at         timestamptz,
  finished_at        timestamptz,
  duration_seconds   int generated always as (
    case when started_at is not null and finished_at is not null
         then extract(epoch from (finished_at - started_at))::int end) stored,
  not_performed_reason text,
  sort_order         int not null default 0,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  unique (attendance_id, exam_type_id)
);
create index if not exists idx_patient_exams_queue
  on public.patient_exams (tenant_id, status, priority, queued_at);
create index if not exists idx_patient_exams_room on public.patient_exams (room_id, status);
create index if not exists idx_patient_exams_attendance on public.patient_exams (attendance_id);
-- Garante que o paciente nao seja chamado em duas salas ao mesmo tempo
create unique index if not exists uq_patient_exam_in_service
  on public.patient_exams (attendance_id)
  where status in ('chamado','em_andamento');

alter table public.queue_events
  drop constraint if exists queue_events_exam_fk;
alter table public.queue_events
  add constraint queue_events_exam_fk
  foreign key (exam_id) references public.patient_exams(id) on delete set null;

-- Resultados -------------------------------------------------------------
create table if not exists public.exam_results (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  patient_exam_id uuid not null references public.patient_exams(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  professional_id uuid references public.profiles(id) on delete set null,
  values          jsonb not null default '{}'::jsonb,
  conclusion      text,
  is_altered      boolean not null default false,
  file_path       text,
  released_to_patient boolean not null default false,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);
create index if not exists idx_exam_results_patient on public.exam_results (patient_id, created_at desc);

-- ---------------------------------------------------------------------
-- CONSULTA MEDICA
-- ---------------------------------------------------------------------
create table if not exists public.medical_consultations (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  attendance_id         uuid not null references public.attendances(id) on delete cascade,
  patient_id            uuid not null references public.patients(id) on delete cascade,
  doctor_id             uuid references public.profiles(id) on delete set null,
  room_id               uuid references public.rooms(id) on delete set null,
  chief_complaint       text,
  anamnesis             text,
  clinical_history      text,
  personal_history      text,
  family_history        text,
  medications           text,
  allergies             text,
  physical_exam         text,
  diagnosis             text,
  icd_codes             text[],
  conclusion            text,
  conduct               text,
  recommendations       text,
  verdict               medical_verdict,
  restrictions          text,
  valid_until           date,
  additional_exams_requested jsonb not null default '[]'::jsonb,
  observations          text,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  signed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  unique (attendance_id)
);
create index if not exists idx_medical_consultations_patient
  on public.medical_consultations (patient_id, created_at desc);

create table if not exists public.medical_notes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  consultation_id uuid references public.medical_consultations(id) on delete cascade,
  attendance_id   uuid references public.attendances(id) on delete cascade,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  author_id       uuid references public.profiles(id) on delete set null,
  note_type       text not null default 'evolucao',
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_medical_notes_patient on public.medical_notes (patient_id, created_at desc);

-- Anexos clinicos --------------------------------------------------------
create table if not exists public.patient_attachments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  patient_id   uuid not null references public.patients(id) on delete cascade,
  attendance_id uuid references public.attendances(id) on delete set null,
  title        text not null,
  description  text,
  bucket       text not null default 'clinical-documents',
  file_path    text not null,
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_patient_attachments_patient on public.patient_attachments (patient_id);

do $$
declare t text;
begin
  foreach t in array array[
    'triages','patient_exams','exam_results','medical_consultations'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0006_crm_documents_notifications.sql
-- ==========================================================

-- =====================================================================
-- 0006 - CRM visual, documentos/PDF, entregas e notificacoes
-- =====================================================================

create table if not exists public.crm_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  attendance_id  uuid not null references public.attendances(id) on delete cascade,
  from_stage     text,
  to_stage       text not null,
  is_manual      boolean not null default false,
  moved_by       uuid,
  reason         text,
  seconds_in_previous int,
  created_at     timestamptz not null default now()
);
create index if not exists idx_crm_movements_attendance on public.crm_movements (attendance_id, created_at);
create index if not exists idx_crm_movements_tenant_date on public.crm_movements (tenant_id, created_at desc);

-- ---------------------------------------------------------------------
-- DOCUMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.document_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         document_kind not null,
  name         text not null,
  body_html    text,
  header_html  text,
  footer_html  text,
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  unique (tenant_id, kind, name)
);

create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  kind           document_kind not null,
  title          text not null,
  patient_id     uuid references public.patients(id) on delete cascade,
  attendance_id  uuid references public.attendances(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete set null,
  order_id       uuid,
  payment_id     uuid,
  template_id    uuid references public.document_templates(id) on delete set null,
  bucket         text not null default 'clinical-documents',
  file_path      text,
  mime_type      text not null default 'application/pdf',
  size_bytes     bigint,
  payload        jsonb not null default '{}'::jsonb,
  verification_code text,
  is_patient_visible boolean not null default false,
  generated_by   uuid,
  generated_at   timestamptz not null default now(),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz
);
create index if not exists idx_documents_patient on public.documents (patient_id, generated_at desc);
create index if not exists idx_documents_attendance on public.documents (attendance_id);
create unique index if not exists uq_documents_verification
  on public.documents (verification_code) where verification_code is not null;

create table if not exists public.document_deliveries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  channel      text not null,           -- email | app | download | impressao | whatsapp
  destination  text,
  status       text not null default 'pendente',
  error_message text,
  sent_at      timestamptz,
  opened_at    timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_document_deliveries_doc on public.document_deliveries (document_id);

create table if not exists public.document_views (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  viewed_by    uuid,
  viewer_kind  text not null default 'usuario',   -- usuario | paciente
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- NOTIFICACOES
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  patient_id  uuid references public.patients(id) on delete cascade,
  title       text not null,
  body        text,
  level       text not null default 'info',
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_patient on public.notifications (patient_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['document_templates','documents'] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0007_finance.sql
-- ==========================================================

-- =====================================================================
-- 0007 - Financeiro, pagamentos, transacoes e cobrancas Pix
-- =====================================================================

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  attendance_id  uuid references public.attendances(id) on delete set null,
  order_id       uuid,
  patient_id     uuid references public.patients(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,
  contract_id    uuid references public.company_contracts(id) on delete set null,
  reference      text,
  description    text,
  amount         numeric(12,2) not null check (amount >= 0),
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  net_amount     numeric(12,2) generated always as (greatest(amount - discount, 0)) stored,
  method         payment_method not null default 'pix',
  status         payment_status not null default 'pendente',
  due_date       date,
  paid_at        timestamptz,
  cancelled_at   timestamptz,
  refunded_at    timestamptz,
  refund_amount  numeric(12,2),
  refund_reason  text,
  coupon_id      uuid,
  provider       text not null default 'manual',
  provider_reference text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  deleted_at     timestamptz
);
create index if not exists idx_payments_tenant_status on public.payments (tenant_id, status, created_at desc);
create index if not exists idx_payments_attendance on public.payments (attendance_id);
create index if not exists idx_payments_order on public.payments (order_id);

create table if not exists public.payment_transactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  payment_id   uuid not null references public.payments(id) on delete cascade,
  event        text not null,      -- criada | confirmada | falha | estorno | cancelamento | webhook
  status       payment_status not null,
  amount       numeric(12,2),
  provider     text not null default 'manual',
  provider_payload jsonb not null default '{}'::jsonb,
  performed_by uuid,
  is_manual    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_payment_transactions_payment on public.payment_transactions (payment_id, created_at desc);

create table if not exists public.pix_charges (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  payment_id    uuid not null references public.payments(id) on delete cascade,
  pix_key       text not null,
  key_kind      text not null default 'aleatoria',
  merchant_name text not null,
  merchant_city text not null,
  txid          text not null,
  amount        numeric(12,2) not null,
  payload       text not null,          -- BR Code (copia e cola)
  qrcode_data_url text,
  expires_at    timestamptz,
  confirmed_at  timestamptz,
  confirmed_by  uuid,
  confirmation_mode text not null default 'manual',  -- manual | webhook
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, txid)
);

create table if not exists public.cash_registers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  opened_by   uuid,
  opened_at   timestamptz not null default now(),
  closed_by   uuid,
  closed_at   timestamptz,
  opening_amount numeric(12,2) not null default 0,
  closing_amount numeric(12,2),
  notes       text,
  created_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['payments','pix_charges'] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0008_ecommerce.sql
-- ==========================================================

-- =====================================================================
-- 0008 - E-commerce white label: catalogo, carrinho, pedidos, cupons
-- =====================================================================

create table if not exists public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  parent_id   uuid references public.product_categories(id) on delete set null,
  slug        text not null,
  name        text not null,
  description text,
  image_url   text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  category_id        uuid references public.product_categories(id) on delete set null,
  kind               product_kind not null default 'exame',
  slug               text not null,
  code               text,
  sku                text,
  name               text not null,
  short_description  text,
  description        text,
  image_url          text,
  price              numeric(12,2) not null default 0 check (price >= 0),
  promo_price        numeric(12,2) check (promo_price is null or promo_price >= 0),
  promo_starts_at    timestamptz,
  promo_ends_at      timestamptz,
  stock              int,
  sales_limit        int,
  duration_minutes   int,
  requires_scheduling boolean not null default false,
  availability_rules jsonb not null default '{}'::jsonb,
  unit               text not null default 'un',
  weight_grams       int,
  width_cm           numeric(8,2),
  height_cm          numeric(8,2),
  length_cm          numeric(8,2),
  specific_terms     text,
  is_featured        boolean not null default false,
  sort_order         int not null default 0,
  is_active          boolean not null default true,
  search_key         text generated always as (public.normalize_text(name || ' ' || coalesce(short_description,''))) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  unique (tenant_id, slug)
);
create index if not exists idx_products_tenant_active on public.products (tenant_id, is_active) where deleted_at is null;
create index if not exists idx_products_search on public.products using gin (search_key gin_trgm_ops);

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  url         text not null,
  alt_text    text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  sku         text,
  name        text not null,
  attributes  jsonb not null default '{}'::jsonb,
  price       numeric(12,2),
  stock       int,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Pacotes de servicos (produto -> exames incluidos) ----------------------
create table if not exists public.service_packages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (product_id)
);

create table if not exists public.package_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  package_id    uuid not null references public.service_packages(id) on delete cascade,
  exam_type_id  uuid references public.exam_types(id) on delete restrict,
  product_id    uuid references public.products(id) on delete set null,
  quantity      int not null default 1 check (quantity > 0),
  sort_order    int not null default 0,
  constraint package_items_target check (exam_type_id is not null or product_id is not null)
);
create index if not exists idx_package_items_package on public.package_items (package_id);

-- ---------------------------------------------------------------------
-- CARRINHO
-- ---------------------------------------------------------------------
create table if not exists public.carts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid,
  session_token text,
  company_id    uuid references public.companies(id) on delete set null,
  status        text not null default 'aberto',    -- aberto | convertido | abandonado
  coupon_id     uuid,
  notes         text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_carts_user on public.carts (tenant_id, user_id) where status = 'aberto';
create unique index if not exists uq_carts_session on public.carts (tenant_id, session_token) where session_token is not null and status = 'aberto';

create table if not exists public.cart_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  cart_id      uuid not null references public.carts(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete restrict,
  variant_id   uuid references public.product_variants(id) on delete set null,
  patient_id   uuid references public.patients(id) on delete set null,
  beneficiary_name text,
  beneficiary_document text,
  quantity     int not null default 1 check (quantity > 0),
  unit_price   numeric(12,2) not null,
  discount     numeric(12,2) not null default 0,
  total        numeric(12,2) generated always as (greatest(unit_price * quantity - discount, 0)) stored,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_cart_items_cart on public.cart_items (cart_id);

-- ---------------------------------------------------------------------
-- PEDIDOS
-- ---------------------------------------------------------------------
create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  order_number      text not null,
  status            order_status not null default 'aguardando_pagamento',
  buyer_kind        text not null default 'pessoa_fisica',   -- pessoa_fisica | pessoa_juridica
  buyer_user_id     uuid,
  buyer_name        text not null,
  buyer_document    text,
  buyer_email       citext,
  buyer_phone       text,
  company_id        uuid references public.companies(id) on delete set null,
  contract_id       uuid references public.company_contracts(id) on delete set null,
  shipping_zip      text,
  shipping_street   text,
  shipping_number   text,
  shipping_complement text,
  shipping_district text,
  shipping_city     text,
  shipping_state    char(2),
  subtotal          numeric(12,2) not null default 0,
  discount          numeric(12,2) not null default 0,
  shipping_amount   numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  coupon_id         uuid,
  payment_method    payment_method,
  payment_status    payment_status not null default 'pendente',
  requires_scheduling boolean not null default false,
  scheduling_done   boolean not null default false,
  origin            data_origin not null default 'ecommerce',
  notes             text,
  terms_accepted_at timestamptz,
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  unique (tenant_id, order_number)
);
create index if not exists idx_orders_tenant_status on public.orders (tenant_id, status, created_at desc);
create index if not exists idx_orders_company on public.orders (company_id);

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  order_id       uuid not null references public.orders(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  patient_id     uuid references public.patients(id) on delete set null,
  beneficiary_name text,
  beneficiary_document text,
  beneficiary_birth_date date,
  product_name   text not null,
  product_kind   product_kind not null default 'exame',
  quantity       int not null default 1 check (quantity > 0),
  unit_price     numeric(12,2) not null,
  discount       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  requires_scheduling boolean not null default false,
  appointment_id uuid references public.appointments(id) on delete set null,
  fulfillment_status text not null default 'pendente', -- pendente | agendado | atendido | separado | enviado | entregue | cancelado
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items (order_id);

create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  reason      text,
  changed_by  uuid,
  is_manual   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_order_status_history_order on public.order_status_history (order_id, created_at);

-- ---------------------------------------------------------------------
-- CUPONS E PROMOCOES
-- ---------------------------------------------------------------------
create table if not exists public.coupons (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  code              citext not null,
  description       text,
  discount_kind     text not null default 'percentual',   -- percentual | valor
  discount_value    numeric(12,2) not null check (discount_value >= 0),
  minimum_amount    numeric(12,2) not null default 0,
  starts_at         timestamptz,
  ends_at           timestamptz,
  total_limit       int,
  per_buyer_limit   int,
  used_count        int not null default 0,
  allowed_products  uuid[],
  allowed_categories uuid[],
  allowed_companies uuid[],
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  unique (tenant_id, code)
);

create table if not exists public.coupon_usages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  coupon_id   uuid not null references public.coupons(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  user_id     uuid,
  buyer_document text,
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_coupon_usages_coupon on public.coupon_usages (coupon_id);

create table if not exists public.promotions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  description  text,
  banner_url   text,
  link         text,
  discount_kind text,
  discount_value numeric(12,2),
  product_ids  uuid[],
  category_ids uuid[],
  starts_at    timestamptz,
  ends_at      timestamptz,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  variant_id   uuid references public.product_variants(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  movement     text not null,   -- entrada | saida | ajuste | reserva | cancelamento
  quantity     int not null,
  balance_after int,
  reason       text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_inventory_movements_product on public.inventory_movements (product_id, created_at desc);

-- Chaves cruzadas adiadas ------------------------------------------------
alter table public.carts drop constraint if exists carts_coupon_fk;
alter table public.carts add constraint carts_coupon_fk
  foreign key (coupon_id) references public.coupons(id) on delete set null;

alter table public.orders drop constraint if exists orders_coupon_fk;
alter table public.orders add constraint orders_coupon_fk
  foreign key (coupon_id) references public.coupons(id) on delete set null;

alter table public.payments drop constraint if exists payments_order_fk;
alter table public.payments add constraint payments_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.payments drop constraint if exists payments_coupon_fk;
alter table public.payments add constraint payments_coupon_fk
  foreign key (coupon_id) references public.coupons(id) on delete set null;

alter table public.appointments drop constraint if exists appointments_order_fk;
alter table public.appointments add constraint appointments_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.attendances drop constraint if exists attendances_order_fk;
alter table public.attendances add constraint attendances_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.documents drop constraint if exists documents_order_fk;
alter table public.documents add constraint documents_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.documents drop constraint if exists documents_payment_fk;
alter table public.documents add constraint documents_payment_fk
  foreign key (payment_id) references public.payments(id) on delete set null;

alter table public.patient_exams drop constraint if exists patient_exams_order_item_fk;
alter table public.patient_exams add constraint patient_exams_order_item_fk
  foreign key (order_item_id) references public.order_items(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array[
    'product_categories','products','product_variants','service_packages',
    'carts','cart_items','orders','order_items','coupons','promotions'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0009_scraper_and_import.sql
-- ==========================================================

-- =====================================================================
-- 0009 - Conectores de importacao (scraper autorizado), normalizacao,
--        deduplicacao idempotente e prevIa de aprovacao
-- =====================================================================

create table if not exists public.scraper_connectors (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  code               text not null,
  name               text not null,
  kind               text not null default 'scraper',   -- scraper | api | csv | excel
  base_url           text,
  agenda_url         text,
  auth_kind          text not null default 'form',      -- form | basic | header | cookie | nenhum
  username           text,
  -- Credencial cifrada no servidor (pgcrypto). Nunca retorna ao navegador.
  password_encrypted bytea,
  extra_fields       jsonb not null default '{}'::jsonb,
  navigation_rules   jsonb not null default '{}'::jsonb,
  pagination_rules   jsonb not null default '{}'::jsonb,
  date_filter_rules  jsonb not null default '{}'::jsonb,
  timezone           text not null default 'America/Sao_Paulo',
  schedule_cron      text,
  run_mode           text not null default 'teste',     -- teste | homologacao | producao
  auto_approve       boolean not null default false,
  authorization_confirmed boolean not null default false,
  authorization_note text,
  is_active          boolean not null default false,
  last_run_at        timestamptz,
  next_run_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  unique (tenant_id, code)
);
-- A coluna password_encrypted e movida para o schema `private` na migration 0015.
comment on column public.scraper_connectors.authorization_confirmed is
  'O tenant declara possuir autorizacao para coletar dados do portal. Execucao bloqueada sem confirmacao.';

-- Seletores por campo -----------------------------------------------------
create table if not exists public.scraper_connector_fields (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  connector_id  uuid not null references public.scraper_connectors(id) on delete cascade,
  target_field  text not null,        -- nome canonico interno (ex.: patient.cpf)
  source_label  text,                 -- rotulo original na origem
  selector_css  text,
  selector_xpath text,
  attribute     text,
  transform     text,                 -- trim | digits | date | upper | lower | title | phone
  date_format   text,
  is_required   boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (connector_id, target_field)
);

-- Mapeamento de valores (exames, status, empresas) -----------------------
create table if not exists public.source_field_mappings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  connector_id  uuid references public.scraper_connectors(id) on delete cascade,
  domain        text not null,        -- exame | status | empresa | sexo | tipo_atendimento
  external_value text not null,
  internal_value text,
  internal_id   uuid,
  confidence    numeric(5,2) not null default 100,
  is_confirmed  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, connector_id, domain, external_value)
);

-- Execucoes ---------------------------------------------------------------
create table if not exists public.scraper_runs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  connector_id   uuid not null references public.scraper_connectors(id) on delete cascade,
  status         scraper_run_status not null default 'pendente',
  trigger        text not null default 'manual',   -- manual | agendado | api
  reference_date date,
  started_at     timestamptz,
  finished_at    timestamptz,
  duration_ms    int,
  attempt        int not null default 1,
  collected_count  int not null default 0,
  new_patients     int not null default 0,
  updated_patients int not null default 0,
  new_companies    int not null default 0,
  updated_companies int not null default 0,
  new_appointments int not null default 0,
  updated_appointments int not null default 0,
  duplicates_count int not null default 0,
  error_count      int not null default 0,
  summary        jsonb not null default '{}'::jsonb,
  error_message  text,
  evidence_path  text,
  lock_key       text,
  requested_by   uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_scraper_runs_connector on public.scraper_runs (connector_id, created_at desc);
-- Lock de concorrencia: uma execucao ativa por conector
create unique index if not exists uq_scraper_run_active
  on public.scraper_runs (connector_id)
  where status in ('pendente','executando');

create table if not exists public.scraper_run_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  run_id     uuid not null references public.scraper_runs(id) on delete cascade,
  level      text not null default 'info',
  step       text,
  message    text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_scraper_run_logs_run on public.scraper_run_logs (run_id, created_at);

-- Payload bruto -----------------------------------------------------------
create table if not exists public.scraper_raw_records (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  run_id        uuid not null references public.scraper_runs(id) on delete cascade,
  connector_id  uuid not null references public.scraper_connectors(id) on delete cascade,
  row_index     int not null,
  external_id   text,
  source_url    text,
  raw           jsonb not null,          -- { campo_original: valor_original }
  collected_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_scraper_raw_run on public.scraper_raw_records (run_id, row_index);

-- Registro normalizado ----------------------------------------------------
create table if not exists public.scraper_normalized_records (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  run_id          uuid not null references public.scraper_runs(id) on delete cascade,
  connector_id    uuid not null references public.scraper_connectors(id) on delete cascade,
  raw_record_id   uuid references public.scraper_raw_records(id) on delete cascade,
  external_id     text,
  reference_date  date,
  -- chave de origem composta (tenant + conector + id externo + data) garante idempotencia
  source_key      text,
  patient_data    jsonb not null default '{}'::jsonb,
  company_data    jsonb not null default '{}'::jsonb,
  appointment_data jsonb not null default '{}'::jsonb,
  exams_data      jsonb not null default '[]'::jsonb,
  field_trace     jsonb not null default '[]'::jsonb,  -- [{campo_original, valor_original, valor_normalizado, confianca}]
  confidence      numeric(5,2) not null default 0,
  validation_errors jsonb not null default '[]'::jsonb,
  is_valid        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists idx_scraper_norm_run on public.scraper_normalized_records (run_id);
create unique index if not exists uq_scraper_norm_source
  on public.scraper_normalized_records (tenant_id, connector_id, external_id, reference_date)
  where external_id is not null;

create or replace function public.tg_scraper_source_key()
returns trigger language plpgsql as $$
begin
  new.source_key := coalesce(new.external_id, '') || '|' ||
                    coalesce(to_char(new.reference_date, 'YYYY-MM-DD'), '');
  return new;
end$$;

drop trigger if exists set_source_key on public.scraper_normalized_records;
create trigger set_source_key before insert or update on public.scraper_normalized_records
for each row execute function public.tg_scraper_source_key();

-- Prevía / aprovacao ------------------------------------------------------
create table if not exists public.scraper_import_reviews (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  run_id             uuid not null references public.scraper_runs(id) on delete cascade,
  normalized_id      uuid not null references public.scraper_normalized_records(id) on delete cascade,
  status             import_review_status not null default 'pendente',
  action             text not null default 'criar',  -- criar | atualizar | vincular | ignorar
  matched_patient_id uuid references public.patients(id) on delete set null,
  matched_company_id uuid references public.companies(id) on delete set null,
  matched_appointment_id uuid references public.appointments(id) on delete set null,
  match_rule         text,
  overrides          jsonb not null default '{}'::jsonb,
  issues             jsonb not null default '[]'::jsonb,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  imported_at        timestamptz,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (normalized_id)
);
create index if not exists idx_scraper_reviews_run_status on public.scraper_import_reviews (run_id, status);

-- Conflitos de dados ------------------------------------------------------
create table if not exists public.import_conflicts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  run_id        uuid references public.scraper_runs(id) on delete set null,
  entity        text not null,        -- patient | company | appointment
  entity_id     uuid,
  field         text not null,
  current_value text,
  incoming_value text,
  source        text,
  resolution    text not null default 'pendente',  -- pendente | manter | substituir | ignorar
  resolved_by   uuid,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_import_conflicts_status on public.import_conflicts (tenant_id, resolution);

-- Importacoes por arquivo (Excel/CSV) -------------------------------------
create table if not exists public.file_imports (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  run_id       uuid references public.scraper_runs(id) on delete set null,
  file_name    text not null,
  bucket       text not null default 'imports',
  file_path    text not null,
  kind         text not null default 'agenda',
  rows_total   int not null default 0,
  rows_ok      int not null default 0,
  rows_error   int not null default 0,
  mapping      jsonb not null default '{}'::jsonb,
  status       text not null default 'pendente',
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.appointments drop constraint if exists appointments_connector_fk;
alter table public.appointments add constraint appointments_connector_fk
  foreign key (source_connector_id) references public.scraper_connectors(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array[
    'scraper_connectors','scraper_connector_fields','source_field_mappings',
    'scraper_runs','scraper_import_reviews','file_imports'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0010_campaigns_settings_audit.sql
-- ==========================================================

-- =====================================================================
-- 0010 - Campanhas comerciais, provedores, configuracoes e auditoria
-- =====================================================================

create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  subject     text not null,
  body_html   text not null,
  body_text   text not null,
  variables   jsonb not null default '[]'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  template_id     uuid references public.email_templates(id) on delete set null,
  subject         text not null,
  body_html       text not null,
  body_text       text not null,
  audience_filter jsonb not null default '{}'::jsonb,
  status          campaign_status not null default 'rascunho',
  mode            text not null default 'aprovacao_humana',   -- aprovacao_humana | automatico
  generated_by    text not null default 'template',           -- template | ia
  scheduled_for   timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  total_recipients int not null default 0,
  sent_count      int not null default 0,
  failed_count    int not null default 0,
  opened_count    int not null default 0,
  clicked_count   int not null default 0,
  unsubscribed_count int not null default 0,
  provider        text not null default 'manual',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);
create index if not exists idx_email_campaigns_tenant on public.email_campaigns (tenant_id, created_at desc);
comment on table public.email_campaigns is
  'Campanhas comerciais para empresas. Proibido usar qualquer dado clinico de paciente como criterio ou conteudo.';

create table if not exists public.email_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  campaign_id  uuid not null references public.email_campaigns(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete set null,
  contact_id   uuid references public.company_contacts(id) on delete set null,
  email        citext not null,
  name         text,
  status       text not null default 'pendente',   -- pendente | enviado | falha | bloqueado
  error_message text,
  sent_at      timestamptz,
  provider_message_id text,
  created_at   timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists idx_email_recipients_campaign on public.email_recipients (campaign_id, status);

create table if not exists public.email_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  campaign_id  uuid references public.email_campaigns(id) on delete cascade,
  recipient_id uuid references public.email_recipients(id) on delete cascade,
  event        text not null,      -- enviado | entregue | aberto | clique | bounce | reclamacao | descadastro
  link         text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_email_events_campaign on public.email_events (campaign_id, created_at desc);

create table if not exists public.unsubscribe_list (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       citext not null,
  company_id  uuid references public.companies(id) on delete set null,
  reason      text,
  source      text not null default 'link',
  created_at  timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ---------------------------------------------------------------------
-- PROVEDORES E CONFIGURACOES
-- ---------------------------------------------------------------------
create table if not exists public.provider_settings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  category      text not null,       -- email | ia | pagamento | armazenamento | sms
  provider      text not null,       -- manual | smtp | resend | sendgrid | openai | anthropic | pix_manual | ...
  is_active     boolean not null default false,
  is_default    boolean not null default false,
  public_config jsonb not null default '{}'::jsonb,
  secret_encrypted bytea,
  status        text not null default 'nao_configurado',
  last_checked_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  unique (tenant_id, category, provider)
);
-- A coluna secret_encrypted e movida para o schema `private` na migration 0015.

create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------------------------------------------------------------------
-- AUDITORIA (append-only para usuarios comuns)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id             bigserial primary key,
  tenant_id      uuid references public.tenants(id) on delete set null,
  user_id        uuid,
  user_name      text,
  user_roles     text[],
  action         text not null,           -- create | update | delete | view | login | export | print | send
  entity         text not null,
  entity_id      uuid,
  patient_id     uuid,
  company_id     uuid,
  order_id       uuid,
  description    text,
  previous_value jsonb,
  new_value      jsonb,
  origin         text not null default 'app',
  is_automatic   boolean not null default false,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_audit_logs_tenant_date on public.audit_logs (tenant_id, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity, entity_id, created_at desc);
create index if not exists idx_audit_logs_patient on public.audit_logs (patient_id, created_at desc);

-- Registro de acesso a dados clinicos (LGPD) -----------------------------
create table if not exists public.clinical_access_logs (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid,
  patient_id  uuid not null,
  context     text not null,     -- prontuario | exame | documento | triagem | consulta
  reference_id uuid,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_clinical_access_patient on public.clinical_access_logs (patient_id, created_at desc);

-- Solicitacoes de titular (LGPD) -----------------------------------------
create table if not exists public.data_subject_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  patient_id   uuid references public.patients(id) on delete set null,
  requester_name text not null,
  requester_document text,
  requester_email citext,
  kind         text not null,        -- acesso | portabilidade | correcao | anonimizacao | exclusao | revogacao
  status       text not null default 'aberta',
  notes        text,
  handled_by   uuid,
  handled_at   timestamptz,
  result_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array[
    'email_templates','email_campaigns','provider_settings','data_subject_requests'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0011_permissions_catalog.sql
-- ==========================================================

-- =====================================================================
-- 0011 - Catalogo global de permissoes
-- =====================================================================
insert into public.permissions (code, module, name, description, is_sensitive) values
  ('dashboard.ver',        'dashboard',  'Visualizar dashboard',            'Acessa paineis e indicadores', false),
  ('relatorios.ver',       'relatorios', 'Visualizar relatorios',           'Acessa relatorios gerenciais', false),

  ('pacientes.ver',        'pacientes',  'Visualizar pacientes',            'Consulta cadastro de pacientes', false),
  ('pacientes.criar',      'pacientes',  'Criar pacientes',                 'Cria novos pacientes', false),
  ('pacientes.editar',     'pacientes',  'Editar pacientes',                'Altera dados cadastrais', false),
  ('pacientes.excluir',    'pacientes',  'Excluir pacientes',               'Remove (soft delete) pacientes', true),
  ('clinico.ver',          'clinico',    'Consultar dados clinicos',        'Le prontuario, triagem, exames e consultas', true),

  ('agenda.ver',           'agenda',     'Visualizar agenda',               'Consulta agendamentos', false),
  ('agenda.administrar',   'agenda',     'Administrar agenda',              'Cria, remarca e cancela agendamentos', false),

  ('empresas.ver',         'empresas',   'Visualizar empresas',             'Consulta empresas clientes', false),
  ('empresas.administrar', 'empresas',   'Administrar empresas',            'Cria e edita empresas e contatos', false),

  ('totem.operar',         'totem',      'Operar totem',                    'Emite senhas no totem', false),
  ('recepcao.operar',      'recepcao',   'Operar recepcao',                 'Confirma chegada e organiza filas', false),
  ('filas.operar',         'filas',      'Operar filas e salas',            'Chama, inicia e conclui atendimentos', false),
  ('painel.operar',        'painel',     'Operar painel de chamadas',       'Controla o painel de TV', false),
  ('salas.administrar',    'salas',      'Administrar salas',               'Cadastra salas e tipos de exame', false),

  ('triagem.preencher',    'triagem',    'Preencher triagem',               'Registra sinais vitais e alertas', true),
  ('exames.preencher',     'exames',     'Preencher exames',                'Registra execucao e resultados', true),
  ('exames.concluir',      'exames',     'Concluir exames',                 'Finaliza exames do paciente', true),
  ('medico.atender',       'medico',     'Realizar atendimento medico',     'Registra anamnese, conclusao e aptidao', true),
  ('crm.mover_manual',     'crm',        'Mover paciente manualmente',      'Arrasta cartoes no CRM', false),

  ('documentos.emitir',    'documentos', 'Emitir documentos',               'Gera PDFs e atestados', true),

  ('financeiro.ver',       'financeiro', 'Consultar financeiro',            'Le cobrancas e pagamentos', false),
  ('financeiro.registrar', 'financeiro', 'Registrar pagamentos',            'Cria e confirma cobrancas', false),
  ('financeiro.estornar',  'financeiro', 'Realizar estornos',               'Estorna pagamentos confirmados', true),

  ('ecommerce.administrar','ecommerce',  'Administrar e-commerce',          'Configura loja, banners e promocoes', false),
  ('produtos.administrar', 'ecommerce',  'Administrar produtos',            'Cria e edita produtos e pacotes', false),
  ('pedidos.administrar',  'ecommerce',  'Administrar pedidos',             'Gerencia pedidos e status', false),

  ('scraper.administrar',  'importacao', 'Administrar conectores',          'Configura conectores de importacao', true),
  ('importacoes.executar', 'importacao', 'Executar importacoes',            'Dispara coletas e importacoes', false),
  ('importacoes.aprovar',  'importacao', 'Aprovar importacoes',             'Aprova a previa antes de sincronizar', false),

  ('campanhas.administrar','campanhas',  'Administrar campanhas',           'Cria campanhas comerciais', false),
  ('campanhas.aprovar',    'campanhas',  'Aprovar campanhas',               'Aprova o envio das campanhas', false),

  ('usuarios.administrar', 'admin',      'Administrar usuarios',            'Convida, bloqueia e edita usuarios', true),
  ('permissoes.administrar','admin',     'Administrar permissoes',          'Altera papeis e permissoes', true),
  ('whitelabel.configurar','admin',      'Configurar white label',          'Edita marca e dados da empresa', false),
  ('integracoes.configurar','admin',     'Configurar integracoes',          'Configura provedores externos', true),
  ('logs.ver',             'admin',      'Visualizar logs',                 'Consulta auditoria e logs', true),
  ('lgpd.administrar',     'admin',      'Administrar LGPD',                'Trata solicitacoes de titulares', true)
on conflict (code) do update
  set module = excluded.module,
      name = excluded.name,
      description = excluded.description,
      is_sensitive = excluded.is_sensitive;


-- ==========================================================
-- MIGRATIONS: 0012_rls_policies.sql
-- ==========================================================

-- =====================================================================
-- 0012 - Row Level Security em todas as tabelas
-- Regra geral: nenhum tenant enxerga dados de outro tenant.
-- =====================================================================

-- Habilita RLS em todas as tabelas do schema public
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', r.tablename);
    execute format('alter table public.%I force row level security;', r.tablename);
  end loop;
end$$;

-- Remove policies pre-existentes para tornar a migration reexecutavel
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I;', r.policyname, r.tablename);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Gerador de policies para tabelas com tenant_id
-- ---------------------------------------------------------------------
do $$
declare
  spec text[];
  tbl  text;
  rperm text;
  wperm text;
  specs text[][] := array[
    -- tabela                         leitura                escrita
    array['tenant_settings',          'dashboard.ver',       'whitelabel.configurar'],
    array['tenant_branding',          'dashboard.ver',       'whitelabel.configurar'],
    array['tenant_modules',           'dashboard.ver',       'whitelabel.configurar'],
    array['roles',                    'dashboard.ver',       'permissoes.administrar'],
    array['user_roles',               'dashboard.ver',       'permissoes.administrar'],
    array['user_permissions',         'dashboard.ver',       'permissoes.administrar'],
    array['user_invitations',         'usuarios.administrar','usuarios.administrar'],

    array['companies',                'empresas.ver',        'empresas.administrar'],
    array['company_contacts',         'empresas.ver',        'empresas.administrar'],
    array['company_contracts',        'empresas.ver',        'empresas.administrar'],

    array['patients',                 'pacientes.ver',       'pacientes.editar'],
    array['patient_employments',      'pacientes.ver',       'pacientes.editar'],
    array['patient_duplicates',       'pacientes.ver',       'pacientes.editar'],
    array['patient_consents',         'pacientes.ver',       'pacientes.editar'],

    array['exam_types',               'agenda.ver',          'salas.administrar'],
    array['rooms',                    'agenda.ver',          'salas.administrar'],
    array['room_exam_types',          'agenda.ver',          'salas.administrar'],
    array['room_status_history',      'agenda.ver',          'filas.operar'],
    array['crm_stages',               'agenda.ver',          'salas.administrar'],

    array['appointments',             'agenda.ver',          'agenda.administrar'],
    array['appointment_exams',        'agenda.ver',          'agenda.administrar'],
    array['attendances',              'agenda.ver',          'recepcao.operar'],
    array['totems',                   'agenda.ver',          'salas.administrar'],
    array['queue_tickets',            'agenda.ver',          'totem.operar'],
    array['queue_events',             'agenda.ver',          'filas.operar'],
    array['tv_calls',                 'agenda.ver',          'painel.operar'],

    array['triages',                  'clinico.ver',         'triagem.preencher'],
    array['triage_revisions',         'clinico.ver',         'triagem.preencher'],
    array['patient_exams',            'agenda.ver',          'filas.operar'],
    array['exam_results',             'clinico.ver',         'exames.preencher'],
    array['medical_consultations',    'clinico.ver',         'medico.atender'],
    array['medical_notes',            'clinico.ver',         'medico.atender'],
    array['patient_attachments',      'clinico.ver',         'exames.preencher'],

    array['crm_movements',            'agenda.ver',          'crm.mover_manual'],
    array['document_templates',       'documentos.emitir',   'whitelabel.configurar'],
    array['documents',                'documentos.emitir',   'documentos.emitir'],
    array['document_deliveries',      'documentos.emitir',   'documentos.emitir'],
    array['document_views',           'logs.ver',            'documentos.emitir'],

    array['payments',                 'financeiro.ver',      'financeiro.registrar'],
    array['payment_transactions',     'financeiro.ver',      'financeiro.registrar'],
    array['pix_charges',              'financeiro.ver',      'financeiro.registrar'],
    array['cash_registers',           'financeiro.ver',      'financeiro.registrar'],

    array['product_categories',       'dashboard.ver',       'produtos.administrar'],
    array['products',                 'dashboard.ver',       'produtos.administrar'],
    array['product_images',           'dashboard.ver',       'produtos.administrar'],
    array['product_variants',         'dashboard.ver',       'produtos.administrar'],
    array['service_packages',         'dashboard.ver',       'produtos.administrar'],
    array['package_items',            'dashboard.ver',       'produtos.administrar'],
    array['carts',                    'pedidos.administrar', 'pedidos.administrar'],
    array['cart_items',               'pedidos.administrar', 'pedidos.administrar'],
    array['orders',                   'pedidos.administrar', 'pedidos.administrar'],
    array['order_items',              'pedidos.administrar', 'pedidos.administrar'],
    array['order_status_history',     'pedidos.administrar', 'pedidos.administrar'],
    array['coupons',                  'pedidos.administrar', 'ecommerce.administrar'],
    array['coupon_usages',            'pedidos.administrar', 'ecommerce.administrar'],
    array['promotions',               'dashboard.ver',       'ecommerce.administrar'],
    array['inventory_movements',      'produtos.administrar','produtos.administrar'],

    array['scraper_connectors',       'scraper.administrar', 'scraper.administrar'],
    array['scraper_connector_fields', 'scraper.administrar', 'scraper.administrar'],
    array['source_field_mappings',    'importacoes.executar','scraper.administrar'],
    array['scraper_runs',             'importacoes.executar','importacoes.executar'],
    array['scraper_run_logs',         'importacoes.executar','importacoes.executar'],
    array['scraper_raw_records',      'importacoes.aprovar', 'importacoes.executar'],
    array['scraper_normalized_records','importacoes.aprovar','importacoes.executar'],
    array['scraper_import_reviews',   'importacoes.aprovar', 'importacoes.aprovar'],
    array['import_conflicts',         'importacoes.aprovar', 'importacoes.aprovar'],
    array['file_imports',             'importacoes.executar','importacoes.executar'],

    array['email_templates',          'campanhas.administrar','campanhas.administrar'],
    array['email_campaigns',          'campanhas.administrar','campanhas.administrar'],
    array['email_recipients',         'campanhas.administrar','campanhas.administrar'],
    array['email_events',             'campanhas.administrar','campanhas.administrar'],
    array['unsubscribe_list',         'campanhas.administrar','campanhas.administrar'],

    array['provider_settings',        'integracoes.configurar','integracoes.configurar'],
    array['data_subject_requests',    'lgpd.administrar',    'lgpd.administrar'],
    array['auth_events',              'logs.ver',            'logs.ver'],
    array['clinical_access_logs',     'logs.ver',            'logs.ver']
  ];
begin
  foreach spec slice 1 in array specs loop
    tbl := spec[1]; rperm := spec[2]; wperm := spec[3];

    execute format($f$
      create policy tenant_select on public.%1$I for select to authenticated
      using (public.can_access(tenant_id, %2$L));
    $f$, tbl, rperm);

    execute format($f$
      create policy tenant_insert on public.%1$I for insert to authenticated
      with check (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);

    execute format($f$
      create policy tenant_update on public.%1$I for update to authenticated
      using (public.can_access(tenant_id, %2$L))
      with check (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);

    execute format($f$
      create policy tenant_delete on public.%1$I for delete to authenticated
      using (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Policies especificas
-- ---------------------------------------------------------------------

-- TENANTS: usuario le o proprio tenant; so admin da plataforma cria/apaga
create policy tenants_select on public.tenants for select to authenticated
  using (public.is_platform_admin() or id = public.current_tenant_id());
create policy tenants_update on public.tenants for update to authenticated
  using (public.can_access(id, 'whitelabel.configurar'))
  with check (public.can_access(id, 'whitelabel.configurar'));
create policy tenants_insert on public.tenants for insert to authenticated
  with check (public.is_platform_admin());
create policy tenants_delete on public.tenants for delete to authenticated
  using (public.is_platform_admin());

-- PROFILES: o proprio usuario sempre se enxerga (evita recursao no login)
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_select_tenant on public.profiles for select to authenticated
  using (public.can_access(tenant_id, 'usuarios.administrar'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_platform_admin = (select p.is_platform_admin from public.profiles p where p.id = auth.uid()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.can_access(tenant_id, 'usuarios.administrar'))
  with check (public.can_access(tenant_id, 'usuarios.administrar'));
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check (public.can_access(tenant_id, 'usuarios.administrar'));

-- PERMISSIONS: catalogo global somente leitura
create policy permissions_select on public.permissions for select to authenticated using (true);

-- ROLE_PERMISSIONS: segue o tenant do papel
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.belongs_to_tenant(r.tenant_id)));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.can_access(r.tenant_id, 'permissoes.administrar')))
  with check (exists (select 1 from public.roles r where r.id = role_id and public.can_access(r.tenant_id, 'permissoes.administrar')));

-- NOTIFICACOES: destinatario le as proprias
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.can_access(tenant_id, 'dashboard.ver'));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.belongs_to_tenant(tenant_id));

-- AUDITORIA: append-only. Ninguem altera nem apaga pela API.
create policy audit_select on public.audit_logs for select to authenticated
  using (public.can_access(tenant_id, 'logs.ver'));
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (public.belongs_to_tenant(tenant_id));
-- (sem policy de update/delete => bloqueado para qualquer usuario autenticado)

-- SYSTEM_SETTINGS: somente admin da plataforma
create policy system_settings_all on public.system_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- Credenciais cifradas: ver migration 0015, que move os segredos para o
-- schema `private` (nao exposto pela API) e cria as views seguras
-- scraper_connectors_safe / provider_settings_safe.
-- Revogar por coluna nao funciona quando existe GRANT no nivel da tabela.
-- ---------------------------------------------------------------------


-- ==========================================================
-- MIGRATIONS: 0013_automation_and_rpc.sql
-- ==========================================================

-- =====================================================================
-- 0013 - Automacao do fluxo (CRM automatico), numeracao e RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- Numeracao
-- ---------------------------------------------------------------------
create or replace function public.tg_attendance_number()
returns trigger language plpgsql as $$
begin
  if new.attendance_number is null then
    new.attendance_number := nextval('public.attendance_number_seq');
  end if;
  return new;
end$$;

drop trigger if exists set_attendance_number on public.attendances;
create trigger set_attendance_number before insert on public.attendances
for each row execute function public.tg_attendance_number();

create or replace function public.tg_order_number()
returns trigger language plpgsql as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := to_char(now(), 'YYYYMM') || '-' ||
                        lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end$$;

drop trigger if exists set_order_number on public.orders;
create trigger set_order_number before insert on public.orders
for each row execute function public.tg_order_number();

-- ---------------------------------------------------------------------
-- CRM: registra movimentacoes sempre que o estagio muda
-- ---------------------------------------------------------------------
create or replace function public.tg_attendance_stage_movement()
returns trigger language plpgsql as $$
declare
  seconds_prev int;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_movements (tenant_id, attendance_id, from_stage, to_stage, is_manual, moved_by)
    values (new.tenant_id, new.id, null, new.stage_code, false, auth.uid());
    return new;
  end if;

  if new.stage_code is distinct from old.stage_code then
    seconds_prev := greatest(extract(epoch from (now() - coalesce(old.stage_changed_at, old.created_at)))::int, 0);
    new.stage_changed_at := now();
    insert into public.crm_movements
      (tenant_id, attendance_id, from_stage, to_stage, is_manual, moved_by, seconds_in_previous)
    values
      (new.tenant_id, new.id, old.stage_code, new.stage_code,
       coalesce(current_setting('app.manual_move', true) = 'on', false), auth.uid(), seconds_prev);
  end if;
  return new;
end$$;

drop trigger if exists attendance_stage_movement_ins on public.attendances;
create trigger attendance_stage_movement_ins after insert on public.attendances
for each row execute function public.tg_attendance_stage_movement();

drop trigger if exists attendance_stage_movement_upd on public.attendances;
create trigger attendance_stage_movement_upd before update on public.attendances
for each row execute function public.tg_attendance_stage_movement();

-- ---------------------------------------------------------------------
-- CRM automatico: reage ao ciclo de vida dos exames
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  pending_count int;
  running_count int;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  select count(*) filter (where status in ('pendente','em_fila','chamado','em_andamento')),
         count(*) filter (where status in ('chamado','em_andamento'))
    into pending_count, running_count
  from public.patient_exams where attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';
  elsif pending_count = 0 then
    update public.attendances
       set stage_code = 'aguardando_medico',
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');
  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();

-- Triagem concluida -> aguardando exames -----------------------------------
create or replace function public.tg_triage_finished()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_exames',
           triage_finished_at = new.finished_at,
           in_service = false
     where id = new.attendance_id;
  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;

drop trigger if exists triage_started on public.triages;
create trigger triage_started after insert on public.triages
for each row execute function public.tg_triage_finished();

drop trigger if exists triage_finished on public.triages;
create trigger triage_finished after update on public.triages
for each row execute function public.tg_triage_finished();

-- Consulta medica ----------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = new.attendance_id;
  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;
  end if;
  return new;
end$$;

drop trigger if exists consultation_started on public.medical_consultations;
create trigger consultation_started after insert on public.medical_consultations
for each row execute function public.tg_consultation_progress();

drop trigger if exists consultation_finished on public.medical_consultations;
create trigger consultation_finished after update on public.medical_consultations
for each row execute function public.tg_consultation_progress();

-- Historico de status do pedido -------------------------------------------
create or replace function public.tg_order_status_history()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by, is_manual)
    values (new.tenant_id, new.id, null, new.status, auth.uid(), false);
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by, is_manual)
    values (new.tenant_id, new.id, old.status, new.status, auth.uid(), true);
  end if;
  return new;
end$$;

drop trigger if exists order_status_history_trg on public.orders;
create trigger order_status_history_trg after insert or update on public.orders
for each row execute function public.tg_order_status_history();

-- Historico de status da sala ----------------------------------------------
create or replace function public.tg_room_status_history()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.room_status_history (tenant_id, room_id, status, attendance_id, changed_by)
  values (new.tenant_id, new.id, new.status, new.current_attendance_id, auth.uid());
  return new;
end$$;

drop trigger if exists room_status_history_trg on public.rooms;
create trigger room_status_history_trg after insert or update on public.rooms
for each row execute function public.tg_room_status_history();

-- Revisao de triagem --------------------------------------------------------
create or replace function public.tg_triage_revision()
returns trigger language plpgsql as $$
begin
  insert into public.triage_revisions (tenant_id, triage_id, changed_by, previous, current)
  values (new.tenant_id, new.id, auth.uid(), to_jsonb(old), to_jsonb(new));
  return new;
end$$;

drop trigger if exists triage_revision_trg on public.triages;
create trigger triage_revision_trg after update on public.triages
for each row execute function public.tg_triage_revision();

-- ---------------------------------------------------------------------
-- RPC: proxima sequencia de senha do dia
-- ---------------------------------------------------------------------
create or replace function public.next_ticket_sequence(p_tenant uuid, p_date date, p_prefix text)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare nxt int;
begin
  select coalesce(max(sequence), 0) + 1 into nxt
  from public.queue_tickets
  where tenant_id = p_tenant and service_date = p_date and prefix = p_prefix;
  return nxt;
end$$;

-- ---------------------------------------------------------------------
-- RPC: check-in no totem (cria atendimento + senha + fila de exames)
-- ---------------------------------------------------------------------
create or replace function public.checkin_patient(
  p_tenant uuid,
  p_appointment uuid default null,
  p_patient uuid default null,
  p_priority priority_level default 'normal',
  p_totem uuid default null,
  p_device text default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_app public.appointments%rowtype;
  v_patient uuid;
  v_company uuid;
  v_attendance uuid;
  v_prefix text;
  v_seq int;
  v_ticket public.queue_tickets%rowtype;
  v_needs_triage boolean := true;
  v_prefixes jsonb;
begin
  if not public.can_access(p_tenant, 'totem.operar') then
    raise exception 'Sem permissao para realizar check-in' using errcode = '42501';
  end if;

  if p_appointment is not null then
    select * into v_app from public.appointments
     where id = p_appointment and tenant_id = p_tenant and deleted_at is null;
    if not found then
      raise exception 'Agendamento nao encontrado' using errcode = 'P0002';
    end if;
    v_patient := v_app.patient_id;
    v_company := v_app.company_id;
    if p_priority = 'normal' then p_priority := v_app.priority; end if;
  else
    v_patient := p_patient;
    select company_id into v_company from public.patients where id = v_patient and tenant_id = p_tenant;
  end if;

  if v_patient is null then
    raise exception 'Paciente nao informado' using errcode = '22023';
  end if;

  -- Impede check-in duplicado no mesmo dia
  select id into v_attendance from public.attendances
   where tenant_id = p_tenant and patient_id = v_patient
     and finished_at is null and cancelled_at is null and deleted_at is null
     and checkin_at >= date_trunc('day', now())
   limit 1;

  if v_attendance is not null then
    select * into v_ticket from public.queue_tickets where attendance_id = v_attendance limit 1;
    return jsonb_build_object('attendance_id', v_attendance, 'ticket', to_jsonb(v_ticket), 'already_checked_in', true);
  end if;

  select coalesce((settings->>'exige_triagem')::boolean, true) into v_needs_triage
    from public.tenant_settings where tenant_id = p_tenant and group_key = 'filas';
  v_needs_triage := coalesce(v_needs_triage, true);

  insert into public.attendances
    (tenant_id, appointment_id, patient_id, company_id, order_id, priority, needs_triage,
     stage_code, origin, created_by)
  values
    (p_tenant, p_appointment, v_patient, v_company, v_app.order_id, p_priority, v_needs_triage,
     'aguardando_recepcao', 'totem', auth.uid())
  returning id into v_attendance;

  -- Prefixos configuraveis pelo tenant
  select coalesce(settings->'prefixos', '{}'::jsonb) into v_prefixes
    from public.tenant_settings where tenant_id = p_tenant and group_key = 'totem';

  v_prefix := coalesce(
    v_prefixes->>(p_priority::text),
    case p_priority when 'prioritario' then 'P' when 'encaixe' then 'E' else 'A' end);

  v_seq := public.next_ticket_sequence(p_tenant, (now() at time zone 'America/Sao_Paulo')::date, v_prefix);

  insert into public.queue_tickets
    (tenant_id, attendance_id, appointment_id, patient_id, totem_id, prefix, sequence,
     ticket_type, origin, device_info)
  values
    (p_tenant, v_attendance, p_appointment, v_patient, p_totem, v_prefix, v_seq,
     p_priority, 'totem', p_device)
  returning * into v_ticket;

  -- Cria a fila de exames a partir do agendamento
  if p_appointment is not null then
    insert into public.patient_exams
      (tenant_id, attendance_id, patient_id, appointment_id, exam_type_id, status, priority,
       room_id, sort_order)
    select p_tenant, v_attendance, v_patient, p_appointment, ae.exam_type_id, 'pendente', p_priority,
           et.default_room_id, et.sort_order
      from public.appointment_exams ae
      join public.exam_types et on et.id = ae.exam_type_id
     where ae.appointment_id = p_appointment
    on conflict (attendance_id, exam_type_id) do nothing;

    update public.appointments set status = 'checkin' where id = p_appointment;
  end if;

  insert into public.queue_events (tenant_id, ticket_id, attendance_id, event, destination)
  values (p_tenant, v_ticket.id, v_attendance, 'emitida', 'recepcao');

  return jsonb_build_object('attendance_id', v_attendance, 'ticket', to_jsonb(v_ticket), 'already_checked_in', false);
end$$;

-- ---------------------------------------------------------------------
-- RPC: chamar proximo da fila de uma sala (atendimento cruzado)
-- ---------------------------------------------------------------------
create or replace function public.call_next_for_room(p_tenant uuid, p_room uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_exam public.patient_exams%rowtype;
  v_ticket public.queue_tickets%rowtype;
  v_room public.rooms%rowtype;
  v_patient_name text;
begin
  if not public.can_access(p_tenant, 'filas.operar') then
    raise exception 'Sem permissao para operar filas' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room and tenant_id = p_tenant;
  if not found then raise exception 'Sala nao encontrada' using errcode = 'P0002'; end if;

  -- Seleciona o proximo exame elegivel:
  --  1) exames que a sala atende
  --  2) paciente nao pode estar em atendimento em outra sala
  --  3) ordem: prioridade -> tempo de espera
  select pe.* into v_exam
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
   where pe.tenant_id = p_tenant
     and pe.status in ('pendente','em_fila')
     and a.finished_at is null and a.cancelled_at is null
     and a.stage_code in ('aguardando_exames','em_exames')
     and a.in_service = false
     and (
       exists (select 1 from public.room_exam_types ret
                where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or exists (select 1 from public.exam_types et
                where et.id = pe.exam_type_id and et.default_room_id = p_room)
     )
     and not exists (
       select 1 from public.patient_exams x
        where x.attendance_id = pe.attendance_id and x.status in ('chamado','em_andamento'))
   order by
     case pe.priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end,
     coalesce(pe.queued_at, a.checkin_at) asc
   limit 1
   for update of pe skip locked;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  update public.patient_exams
     set status = 'chamado', called_at = now(), room_id = p_room, updated_by = auth.uid()
   where id = v_exam.id
  returning * into v_exam;

  update public.rooms
     set status = 'ocupada', current_attendance_id = v_exam.attendance_id
   where id = p_room;

  select qt.* into v_ticket
    from public.queue_tickets qt
   where qt.attendance_id = v_exam.attendance_id
   limit 1;

  select coalesce(p.social_name, p.full_name) into v_patient_name
    from public.patients p
   where p.id = v_exam.patient_id;

  insert into public.queue_events (tenant_id, ticket_id, attendance_id, room_id, exam_id, event, destination, called_by)
  values (p_tenant, v_ticket.id, v_exam.attendance_id, p_room, v_exam.id, 'chamada', 'sala', auth.uid());

  -- O destino separa as duas TVs: entrada (recepcao/triagem) e corredor.
  insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
  values (p_tenant, coalesce(v_ticket.code, '---'),
          split_part(coalesce(v_patient_name,''), ' ', 1),
          v_room.name,
          case
            when v_room.kind in ('recepcao', 'guiche') then 'recepcao'
            when v_room.kind = 'triagem'               then 'triagem'
            else 'sala'
          end,
          v_exam.priority);

  return jsonb_build_object('found', true, 'exam', to_jsonb(v_exam), 'ticket', to_jsonb(v_ticket));
end$$;

-- ---------------------------------------------------------------------
-- RPC: mover atendimento de estagio manualmente (CRM drag and drop)
-- ---------------------------------------------------------------------
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  perform set_config('app.manual_move', 'on', true);
  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now()) else finished_at end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now()) else cancelled_at end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now()) else absent_at end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);
end$$;

grant execute on function public.checkin_patient(uuid,uuid,uuid,priority_level,uuid,text) to authenticated;
grant execute on function public.call_next_for_room(uuid,uuid) to authenticated;
grant execute on function public.move_attendance_stage(uuid,text,text) to authenticated;
grant execute on function public.next_ticket_sequence(uuid,date,text) to authenticated;


-- ==========================================================
-- MIGRATIONS: 0014_storage_buckets.sql
-- ==========================================================

-- =====================================================================
-- 0014 - Buckets de storage e politicas de acesso por tenant
-- Convencao de caminho: <tenant_id>/<subpasta>/<arquivo>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('branding',           'branding',           true,  5242880,   array['image/png','image/jpeg','image/webp','image/svg+xml','image/x-icon']),
  ('ecommerce',          'ecommerce',          true,  10485760,  array['image/png','image/jpeg','image/webp','image/avif']),
  ('clinical-documents', 'clinical-documents', false, 26214400,  null),
  ('exam-results',       'exam-results',       false, 52428800,  null),
  ('signatures',         'signatures',         false, 2097152,   array['image/png','image/jpeg','image/webp']),
  ('imports',            'imports',            false, 52428800,  null),
  ('scraper-evidence',   'scraper-evidence',   false, 26214400,  array['image/png','image/jpeg','text/plain','application/json']),
  ('attachments',        'attachments',        false, 52428800,  null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Helper: primeiro segmento do caminho = tenant_id
create or replace function public.storage_tenant(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare v text;
begin
  v := split_part(object_name, '/', 1);
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end$$;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'wl_%' loop
    execute format('drop policy if exists %I on storage.objects;', r.policyname);
  end loop;
end$$;

-- Leitura publica dos buckets de marca e loja
create policy wl_public_read on storage.objects for select to public
  using (bucket_id in ('branding','ecommerce'));

-- Escrita nos buckets publicos exige permissao de configuracao/produtos
create policy wl_branding_write on storage.objects for all to authenticated
  using (bucket_id = 'branding' and public.can_access(public.storage_tenant(name), 'whitelabel.configurar'))
  with check (bucket_id = 'branding' and public.can_access(public.storage_tenant(name), 'whitelabel.configurar'));

create policy wl_ecommerce_write on storage.objects for all to authenticated
  using (bucket_id = 'ecommerce' and public.can_access(public.storage_tenant(name), 'produtos.administrar'))
  with check (bucket_id = 'ecommerce' and public.can_access(public.storage_tenant(name), 'produtos.administrar'));

-- Documentos clinicos: privados, somente com permissao clinica/documental
create policy wl_clinical_read on storage.objects for select to authenticated
  using (bucket_id in ('clinical-documents','exam-results','attachments')
         and (public.can_access(public.storage_tenant(name), 'clinico.ver')
              or public.can_access(public.storage_tenant(name), 'documentos.emitir')));

create policy wl_clinical_write on storage.objects for insert to authenticated
  with check (bucket_id in ('clinical-documents','exam-results','attachments')
              and (public.can_access(public.storage_tenant(name), 'exames.preencher')
                   or public.can_access(public.storage_tenant(name), 'documentos.emitir')));

create policy wl_clinical_update on storage.objects for update to authenticated
  using (bucket_id in ('clinical-documents','exam-results','attachments')
         and public.can_access(public.storage_tenant(name), 'documentos.emitir'));

create policy wl_clinical_delete on storage.objects for delete to authenticated
  using (bucket_id in ('clinical-documents','exam-results','attachments')
         and public.can_access(public.storage_tenant(name), 'documentos.emitir'));

-- Assinaturas: somente admin de usuarios e o proprio profissional
create policy wl_signatures on storage.objects for all to authenticated
  using (bucket_id = 'signatures' and public.can_access(public.storage_tenant(name), 'usuarios.administrar'))
  with check (bucket_id = 'signatures' and public.can_access(public.storage_tenant(name), 'usuarios.administrar'));

-- Importacoes e evidencias tecnicas
create policy wl_imports on storage.objects for all to authenticated
  using (bucket_id = 'imports' and public.can_access(public.storage_tenant(name), 'importacoes.executar'))
  with check (bucket_id = 'imports' and public.can_access(public.storage_tenant(name), 'importacoes.executar'));

create policy wl_scraper_evidence on storage.objects for all to authenticated
  using (bucket_id = 'scraper-evidence' and public.can_access(public.storage_tenant(name), 'scraper.administrar'))
  with check (bucket_id = 'scraper-evidence' and public.can_access(public.storage_tenant(name), 'scraper.administrar'));


-- ==========================================================
-- MIGRATIONS: 0015_private_secrets.sql
-- ==========================================================

-- =====================================================================
-- 0015 - Segredos em schema privado
--
-- Motivo: no PostgREST/Supabase o papel `authenticated` recebe GRANT de
-- SELECT no nivel da TABELA. Um `revoke select (coluna)` nao tem efeito
-- nesse cenario — a coluna continua legivel. A unica barreira confiavel e
-- manter o segredo fora do schema exposto pela API.
--
-- O schema `private` nao e exposto pelo PostgREST e nao recebe grants.
-- Somente a service role (backend) e funcoes SECURITY DEFINER acessam.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Credenciais dos conectores de importacao --------------------------------
create table if not exists private.connector_secrets (
  connector_id       uuid primary key references public.scraper_connectors(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  password_encrypted bytea,
  extra_secrets      jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

-- Credenciais dos provedores (e-mail, IA, pagamento) ----------------------
create table if not exists private.provider_secrets (
  provider_setting_id uuid primary key references public.provider_settings(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  secret_encrypted    bytea,
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);

alter table private.connector_secrets enable row level security;
alter table private.provider_secrets enable row level security;
-- Sem policies: nenhum usuario autenticado acessa. Somente service role.

-- Migra dados existentes e remove as colunas do schema publico ------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'scraper_connectors'
       and column_name = 'password_encrypted'
  ) then
    insert into private.connector_secrets (connector_id, tenant_id, password_encrypted)
    select id, tenant_id, password_encrypted
      from public.scraper_connectors
     where password_encrypted is not null
    on conflict (connector_id) do nothing;

    drop view if exists public.scraper_connectors_safe;
    alter table public.scraper_connectors drop column password_encrypted;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'provider_settings'
       and column_name = 'secret_encrypted'
  ) then
    insert into private.provider_secrets (provider_setting_id, tenant_id, secret_encrypted)
    select id, tenant_id, secret_encrypted
      from public.provider_settings
     where secret_encrypted is not null
    on conflict (provider_setting_id) do nothing;

    drop view if exists public.provider_settings_safe;
    alter table public.provider_settings drop column secret_encrypted;
  end if;
end$$;

-- Views seguras (agora indicam apenas se existe segredo) ------------------
create or replace view public.scraper_connectors_safe
with (security_invoker = true) as
select c.id, c.tenant_id, c.code, c.name, c.kind, c.base_url, c.agenda_url, c.auth_kind, c.username,
       exists (select 1 from private.connector_secrets s
                where s.connector_id = c.id and s.password_encrypted is not null) as has_password,
       c.extra_fields, c.navigation_rules, c.pagination_rules, c.date_filter_rules,
       c.timezone, c.schedule_cron, c.run_mode, c.auto_approve, c.authorization_confirmed,
       c.authorization_note, c.is_active, c.last_run_at, c.next_run_at,
       c.created_at, c.updated_at
from public.scraper_connectors c
where c.deleted_at is null;

create or replace view public.provider_settings_safe
with (security_invoker = true) as
select p.id, p.tenant_id, p.category, p.provider, p.is_active, p.is_default, p.public_config,
       exists (select 1 from private.provider_secrets s
                where s.provider_setting_id = p.id and s.secret_encrypted is not null) as has_secret,
       p.status, p.last_checked_at, p.created_at, p.updated_at
from public.provider_settings p;

grant select on public.scraper_connectors_safe to authenticated;
grant select on public.provider_settings_safe to authenticated;

-- Grava a senha do conector cifrada, sem nunca devolve-la -------------------
create or replace function public.set_connector_password(
  p_connector uuid, p_password text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.scraper_connectors where id = p_connector;
  if v_tenant is null then
    raise exception 'Conector nao encontrado' using errcode = 'P0002';
  end if;
  if not public.can_access(v_tenant, 'scraper.administrar') then
    raise exception 'Sem permissao para configurar conectores' using errcode = '42501';
  end if;

  insert into private.connector_secrets (connector_id, tenant_id, password_encrypted, updated_by)
  values (p_connector, v_tenant, pgp_sym_encrypt(p_password, p_key), auth.uid())
  on conflict (connector_id) do update
    set password_encrypted = excluded.password_encrypted,
        updated_at = now(),
        updated_by = excluded.updated_by;
end$$;

grant execute on function public.set_connector_password(uuid, text, text) to authenticated;

comment on schema private is
  'Schema nao exposto pela API. Guarda segredos que jamais podem chegar ao navegador.';


-- ==========================================================
-- MIGRATIONS: 0016_realtime_queue_panels.sql
-- ==========================================================

-- Habilita publicacao realtime das tabelas usadas pelo painel e fluxos de fila.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'tv_calls'
    ) then
      execute 'alter publication supabase_realtime add table public.tv_calls';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'attendances'
    ) then
      execute 'alter publication supabase_realtime add table public.attendances';
    end if;
  end if;
end $$;


-- ==========================================================
-- MIGRATIONS: 0017_origem_paciente_assinaturas_contratos.sql
-- ==========================================================

-- =====================================================================
-- 0017 - Origem do paciente (P/E/S/I), assinaturas de termos e
--        controle de contratos das empresas
--
-- Contexto: a clinica atende quatro procedencias distintas e cada uma
-- tem um caminho proprio dentro da casa. Ate aqui o sistema tratava
-- todo mundo como particular e a recepcao decidia no olho.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Procedencia do paciente
--   particular = P - empresa / particular
--   estado     = E - licenca ESISLA
--   sisper     = S - SISPER
--   ingresso   = I - ingresso ESISLA (escola)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_origin_kind') then
    create type patient_origin_kind as enum ('particular','estado','sisper','ingresso');
  end if;
end$$;

alter table public.attendances
  add column if not exists origin_kind patient_origin_kind not null default 'particular',
  add column if not exists origin_kind_set_at timestamptz,
  add column if not exists origin_kind_set_by uuid;

alter table public.appointments
  add column if not exists origin_kind patient_origin_kind not null default 'particular';

-- Procedencia habitual do paciente: pre-seleciona a opcao na recepcao e
-- permite que a importacao ja traga a origem certa.
alter table public.patients
  add column if not exists default_origin_kind patient_origin_kind;

create index if not exists idx_attendances_origin_kind
  on public.attendances (tenant_id, origin_kind, checkin_at desc) where deleted_at is null;
create index if not exists idx_appointments_origin_kind
  on public.appointments (tenant_id, origin_kind, scheduled_date) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Novos tipos de documento
-- Observacao: valores novos de enum nao podem ser usados na mesma
-- transacao que os cria. Aqui so declaramos; o uso e em tempo de execucao.
-- ---------------------------------------------------------------------
alter type document_kind add value if not exists 'autorizacao_envio_resultados';
alter type document_kind add value if not exists 'comprovante_agendamento';
alter type document_kind add value if not exists 'contrato_empresa';

-- ---------------------------------------------------------------------
-- Assinaturas de pacientes em termos e autorizacoes
--
-- Guarda a prova da coleta, nao so o PDF: quem assinou, com que
-- documento, por qual meio e de onde. E o que sustenta o termo caso
-- alguem questione a entrega do prontuario a empresa.
-- ---------------------------------------------------------------------
create table if not exists public.patient_signatures (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  patient_id     uuid not null references public.patients(id) on delete cascade,
  attendance_id  uuid references public.attendances(id) on delete set null,
  document_id    uuid references public.documents(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,
  purpose        text not null default 'autorizacao_envio_resultados',
  method         text not null default 'tela',        -- tela | papel
  status         text not null default 'assinado',    -- pendente | assinado | recusado
  signer_name    text not null,
  signer_rg      text,
  signer_cpf     text,
  signature_bucket text not null default 'clinical-documents',
  signature_path text,                                 -- PNG do traco, quando assinado na tela
  scan_path      text,                                 -- digitalizacao, quando assinado no papel
  signed_at      timestamptz,
  ip_address     inet,
  user_agent     text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  deleted_at     timestamptz,
  constraint patient_signatures_method_valid check (method in ('tela','papel')),
  constraint patient_signatures_status_valid check (status in ('pendente','assinado','recusado'))
);
create index if not exists idx_patient_signatures_attendance
  on public.patient_signatures (attendance_id) where deleted_at is null;
create index if not exists idx_patient_signatures_patient
  on public.patient_signatures (patient_id, signed_at desc) where deleted_at is null;

-- Um termo valido por atendimento e finalidade.
create unique index if not exists uq_patient_signatures_attendance_purpose
  on public.patient_signatures (attendance_id, purpose)
  where attendance_id is not null and deleted_at is null and status = 'assinado';

-- ---------------------------------------------------------------------
-- Contratos das empresas - campos de controle
--
-- A tabela ja existia com o essencial (vigencia, valor, creditos). O que
-- faltava era o que a clinica precisa acompanhar no dia a dia: quando
-- convocar, quando reajustar, quanto ja foi consumido da cota.
-- ---------------------------------------------------------------------
alter table public.company_contracts
  add column if not exists kind                text not null default 'pcmso',
  add column if not exists employees_count     int,
  add column if not exists monthly_amount      numeric(12,2),
  add column if not exists billing_day         int,
  add column if not exists readjustment_index  text default 'IGP-M',
  add column if not exists auto_renew          boolean not null default true,
  add column if not exists notice_days         int[] not null default array[60,30],
  add column if not exists signed_on           date,
  add column if not exists pcmso_valid_until   date,
  add column if not exists esocial_enabled     boolean not null default false,
  add column if not exists esocial_events      text[] not null default array[]::text[],
  add column if not exists coordinator_name    text,
  add column if not exists coordinator_crm     text,
  add column if not exists schedule_email      citext,
  add column if not exists billing_email       citext,
  add column if not exists late_fee_percent    numeric(5,2) default 2,
  add column if not exists late_interest_percent numeric(5,2) default 1,
  add column if not exists technical_hour_rate numeric(12,2),
  add column if not exists terms               jsonb not null default '{}'::jsonb,
  add column if not exists document_bucket     text default 'clinical-documents',
  add column if not exists document_path       text,
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancel_reason       text;

alter table public.company_contracts
  drop constraint if exists company_contracts_billing_day_valid;
alter table public.company_contracts
  add constraint company_contracts_billing_day_valid
  check (billing_day is null or billing_day between 1 and 28);

alter table public.company_contracts
  drop constraint if exists company_contracts_status_valid;
alter table public.company_contracts
  add constraint company_contracts_status_valid
  check (status in ('rascunho','ativo','suspenso','encerrado','cancelado'));

alter table public.company_contracts
  drop constraint if exists company_contracts_period_valid;
alter table public.company_contracts
  add constraint company_contracts_period_valid
  check (starts_on is null or ends_on is null or ends_on >= starts_on);

create index if not exists idx_company_contracts_vigencia
  on public.company_contracts (tenant_id, ends_on) where deleted_at is null and status = 'ativo';

-- Itens do contrato: exames e servicos com cota e preco de excedente ----
create table if not exists public.company_contract_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  contract_id    uuid not null references public.company_contracts(id) on delete cascade,
  exam_type_id   uuid references public.exam_types(id) on delete set null,
  kind           text not null default 'exame',   -- exame | servico
  name           text not null,
  quantity_included int not null default 0,        -- 0 = sem cota, cobrado por uso
  quantity_used  int not null default 0,
  unit_price     numeric(12,2),                    -- valor dentro da cota
  extra_price    numeric(12,2),                    -- valor do excedente
  notes          text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  deleted_at     timestamptz,
  constraint company_contract_items_kind_valid check (kind in ('exame','servico'))
);
create index if not exists idx_company_contract_items_contract
  on public.company_contract_items (contract_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Importacao de planilhas (SISPER / Estado / Ingresso)
-- A tabela file_imports ja existia sem uso. Ganha aqui as colunas que
-- faltavam para sustentar a tela de conferencia antes de gravar.
-- ---------------------------------------------------------------------
alter table public.file_imports
  add column if not exists origin_kind      patient_origin_kind,
  add column if not exists company_id       uuid references public.companies(id) on delete set null,
  add column if not exists default_date     date,
  add column if not exists preview          jsonb not null default '[]'::jsonb,
  add column if not exists errors           jsonb not null default '[]'::jsonb,
  add column if not exists applied_at       timestamptz,
  add column if not exists applied_by       uuid;

-- ---------------------------------------------------------------------
-- RLS das tabelas novas, no mesmo padrao do 0012
-- ---------------------------------------------------------------------
do $$
declare
  spec text[];
  tbl  text;
  rperm text;
  wperm text;
  specs text[][] := array[
    array['patient_signatures',      'documentos.emitir', 'documentos.emitir'],
    array['company_contract_items',  'empresas.ver',      'empresas.administrar']
  ];
begin
  foreach spec slice 1 in array specs loop
    tbl := spec[1]; rperm := spec[2]; wperm := spec[3];

    execute format('alter table public.%I enable row level security;', tbl);
    execute format('alter table public.%I force row level security;', tbl);

    execute format('drop policy if exists tenant_select on public.%I;', tbl);
    execute format('drop policy if exists tenant_insert on public.%I;', tbl);
    execute format('drop policy if exists tenant_update on public.%I;', tbl);
    execute format('drop policy if exists tenant_delete on public.%I;', tbl);

    execute format($f$
      create policy tenant_select on public.%1$I for select to authenticated
      using (public.can_access(tenant_id, %2$L));
    $f$, tbl, rperm);

    execute format($f$
      create policy tenant_insert on public.%1$I for insert to authenticated
      with check (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);

    execute format($f$
      create policy tenant_update on public.%1$I for update to authenticated
      using (public.can_access(tenant_id, %2$L))
      with check (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);

    execute format($f$
      create policy tenant_delete on public.%1$I for delete to authenticated
      using (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Triagem concluida: o destino agora depende da procedencia
--
-- Antes, todo mundo caia em 'aguardando_exames'. Isso prendia o paciente
-- do Estado, do SISPER e de ingresso numa fila de exames que nao existe
-- para eles — ficavam parados esperando uma chamada que nunca vinha.
-- ---------------------------------------------------------------------
create or replace function public.tg_triage_finished()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  att public.attendances%rowtype;
  pendentes int;
begin
  if new.finished_at is not null and old.finished_at is null then
    select * into att from public.attendances where id = new.attendance_id;
    if not found then return new; end if;

    select count(*) into pendentes
      from public.patient_exams
     where attendance_id = new.attendance_id
       and status in ('pendente','em_fila','chamado','em_andamento');

    update public.attendances
       set stage_code = case
             when att.origin_kind = 'particular' and pendentes > 0 then 'aguardando_exames'
             else 'aguardando_medico'
           end,
           triage_finished_at = new.finished_at,
           in_service = false
     where id = new.attendance_id;

  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;

-- ---------------------------------------------------------------------
-- Consumo da cota do contrato
--
-- Exame concluido de funcionario de empresa com contrato ativo desconta
-- da cota. Sem isso, saber quanto ainda cabe no contrato exigia contar a
-- mao no fim do mes — que e exatamente quando ninguem tem tempo.
-- ---------------------------------------------------------------------
create or replace function public.tg_consumo_cota_contrato()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  empresa uuid;
begin
  if new.status is not distinct from old.status or new.status <> 'concluido' then
    return new;
  end if;

  select company_id into empresa from public.patients where id = new.patient_id;
  if empresa is null then return new; end if;

  update public.company_contract_items i
     set quantity_used = i.quantity_used + 1,
         updated_at = now()
    from public.company_contracts c
   where i.contract_id = c.id
     and i.tenant_id = new.tenant_id
     and c.company_id = empresa
     and c.status = 'ativo'
     and c.deleted_at is null
     and i.deleted_at is null
     and i.exam_type_id = new.exam_type_id
     and (c.starts_on is null or c.starts_on <= current_date)
     and (c.ends_on is null or c.ends_on >= current_date);

  return new;
end$$;

drop trigger if exists consumo_cota_contrato on public.patient_exams;
create trigger consumo_cota_contrato after update on public.patient_exams
for each row execute function public.tg_consumo_cota_contrato();

do $$
declare t text;
begin
  foreach t in array array['patient_signatures','company_contract_items'] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0017_triagem_e_prioridade.sql
-- ==========================================================

-- =====================================================================
-- 0017 - Ajustes pedidos pela clinica
--
-- Triagem: sintomas, alertas e restricoes davam texto livre que ninguem
-- preenchia de forma consistente. Entram campos objetivos: acuidade visual
-- por olho e duas condicoes que mudam a conduta do exame ocupacional.
--
-- Prioridade: numa clinica ocupacional quase todo atendimento e de
-- trabalhador em horario marcado. Marcar todos como prioritarios esvaziou
-- a funcao. O campo continua no banco, sempre 'normal', para poder ser
-- religado sem refazer nada.
-- =====================================================================

alter table public.triages
  add column if not exists acuidade_od     text,
  add column if not exists acuidade_oe     text,
  add column if not exists diabetes        boolean,
  add column if not exists hipertenso      boolean;

comment on column public.triages.acuidade_od is 'Acuidade visual do olho direito, como anotada na triagem (ex.: 20/20).';
comment on column public.triages.acuidade_oe is 'Acuidade visual do olho esquerdo.';
comment on column public.triages.diabetes    is 'Marcado na triagem; entra na ficha clinica e no laudo.';
comment on column public.triages.hipertenso  is 'Marcado na triagem; entra na ficha clinica e no laudo.';

-- Os campos antigos continuam existindo para nao perder historico ja
-- registrado, mas saem das telas.
comment on column public.triages.symptoms     is 'Descontinuado em 0017. Mantido apenas para consulta do historico.';
comment on column public.triages.alerts       is 'Descontinuado em 0017. Substituido por diabetes/hipertenso.';
comment on column public.triages.restrictions is 'Descontinuado em 0017. Substituido por diabetes/hipertenso.';


-- ==========================================================
-- MIGRATIONS: 0018_ficha_aso_financeiro.sql
-- ==========================================================

-- =====================================================================
-- 0018 - Ficha clinica, A.S.O. e financeiro completo
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ficha clinica estruturada
--
-- A doutora pediu que a consulta seja preenchida por caixa de selecao, com
-- texto livre so na observacao. Cada bloco vira um jsonb com chaves fixas,
-- em vez de dezenas de colunas booleanas: o formulario muda sem migration.
-- ---------------------------------------------------------------------
alter table public.medical_consultations
  add column if not exists antecedentes_profissionais jsonb not null default '{}'::jsonb,
  add column if not exists antecedentes_pessoais      jsonb not null default '{}'::jsonb,
  add column if not exists estilo_vida                jsonb not null default '{}'::jsonb,
  add column if not exists exame_fisico               jsonb not null default '{}'::jsonb,
  add column if not exists alteracoes_exame_fisico    text;

comment on column public.medical_consultations.exame_fisico is
  'Sistemas avaliados: {"abdome":"normal|alterado", ...}. Chaves livres para o formulario evoluir.';

-- ---------------------------------------------------------------------
-- 2. Assinatura do paciente coletada na entrada
--
-- Vai anexada ao A.S.O. enviado a empresa. Guardamos o caminho no bucket
-- privado, nunca a imagem no banco.
-- ---------------------------------------------------------------------
alter table public.attendances
  add column if not exists patient_signature_path text,
  add column if not exists patient_signature_at   timestamptz,
  add column if not exists patient_photo_path     text;

comment on column public.attendances.patient_photo_path is
  'Foto do rosto na autorizacao de entrega de prontuario. Opcional, exige consentimento.';

-- ---------------------------------------------------------------------
-- 3. A.S.O. como tipo de documento
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'document_kind' and e.enumlabel = 'aso'
  ) then
    alter type document_kind add value 'aso';
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 4. Procedimentos que geram repasse ao medico
-- ---------------------------------------------------------------------
create table if not exists public.procedure_types (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  name        text not null,
  description text,
  default_fee numeric(12,2) not null default 0,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Valor por medico. Sem linha aqui, vale o default_fee do procedimento.
create table if not exists public.medical_fees (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  procedure_type_id uuid not null references public.procedure_types(id) on delete cascade,
  fee               numeric(12,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  unique (profile_id, procedure_type_id)
);

-- Recebivel gerado a cada atendimento concluido pelo medico.
create table if not exists public.fee_entries (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  attendance_id     uuid references public.attendances(id) on delete set null,
  patient_id        uuid references public.patients(id) on delete set null,
  company_id        uuid references public.companies(id) on delete set null,
  procedure_type_id uuid references public.procedure_types(id) on delete set null,
  procedure_code    text not null,
  procedure_name    text not null,
  fee               numeric(12,2) not null,
  competencia       date not null,
  status            text not null default 'a_pagar',   -- a_pagar | pago | cancelado
  paid_at           timestamptz,
  paid_by           uuid,
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid
);
create index if not exists idx_fee_entries_medico
  on public.fee_entries (tenant_id, profile_id, competencia);
-- Um atendimento gera um recebivel por procedimento, sem repetir.
create unique index if not exists uq_fee_entry_atendimento
  on public.fee_entries (attendance_id, procedure_code)
  where attendance_id is not null;

-- ---------------------------------------------------------------------
-- 5. Contas a pagar da clinica
-- ---------------------------------------------------------------------
create table if not exists public.payables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  description text not null,
  category    text not null default 'geral',
  supplier    text,
  amount      numeric(12,2) not null check (amount >= 0),
  due_date    date not null,
  status      text not null default 'aberta',   -- aberta | paga | cancelada
  paid_at     timestamptz,
  paid_by     uuid,
  is_recurring boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz
);
create index if not exists idx_payables_venc on public.payables (tenant_id, due_date, status);

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['procedure_types','medical_fees','fee_entries','payables'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
    execute format('drop policy if exists tenant_select on public.%I;', t);
    execute format('drop policy if exists tenant_write  on public.%I;', t);
  end loop;
end$$;

create policy tenant_select on public.procedure_types for select to authenticated
  using (public.can_access(tenant_id, 'financeiro.ver'));
create policy tenant_write on public.procedure_types for all to authenticated
  using (public.can_access(tenant_id, 'financeiro.registrar'))
  with check (public.can_access(tenant_id, 'financeiro.registrar'));

create policy tenant_select on public.medical_fees for select to authenticated
  using (public.can_access(tenant_id, 'financeiro.ver'));
create policy tenant_write on public.medical_fees for all to authenticated
  using (public.can_access(tenant_id, 'usuarios.administrar'))
  with check (public.can_access(tenant_id, 'usuarios.administrar'));

-- O medico enxerga o proprio recebivel; quem cuida do financeiro enxerga todos.
create policy tenant_select on public.fee_entries for select to authenticated
  using (
    public.belongs_to_tenant(tenant_id)
    and (profile_id = auth.uid() or public.has_permission('financeiro.ver'))
  );
create policy tenant_write on public.fee_entries for all to authenticated
  using (public.can_access(tenant_id, 'financeiro.registrar'))
  with check (public.can_access(tenant_id, 'financeiro.registrar'));

create policy tenant_select on public.payables for select to authenticated
  using (public.can_access(tenant_id, 'financeiro.ver'));
create policy tenant_write on public.payables for all to authenticated
  using (public.can_access(tenant_id, 'financeiro.registrar'))
  with check (public.can_access(tenant_id, 'financeiro.registrar'));

do $$
declare t text;
begin
  foreach t in array array['procedure_types','medical_fees','payables'] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;


-- ==========================================================
-- MIGRATIONS: 0018_guia_de_uso.sql
-- ==========================================================

-- =====================================================================
-- 0018 - Guia de uso: memoria do que cada pessoa ja viu
--
-- O guia roda sozinho na primeira vez que alguem abre cada tela. Guardar
-- isso no banco, e nao no navegador, faz a memoria seguir a pessoa entre
-- o computador da recepcao, o do consultorio e o de casa.
-- =====================================================================

create table if not exists public.user_guide_progress (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  guide_key    text not null,               -- recepcao | triagem | filas | medico | ...
  last_step    int  not null default 0,
  completed_at timestamptz,
  skipped_at   timestamptz,
  seen_count   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, guide_key)
);
create index if not exists idx_user_guide_progress_user
  on public.user_guide_progress (user_id);

-- ---------------------------------------------------------------------
-- RLS: cada pessoa enxerga e escreve apenas o proprio progresso.
--
-- Nao ha motivo para um usuario ver o que o colega ja aprendeu, e menos
-- ainda para poder reiniciar o guia dele.
-- ---------------------------------------------------------------------
alter table public.user_guide_progress enable row level security;
alter table public.user_guide_progress force row level security;

drop policy if exists guide_select_self on public.user_guide_progress;
create policy guide_select_self on public.user_guide_progress for select to authenticated
  using (user_id = auth.uid());

drop policy if exists guide_insert_self on public.user_guide_progress;
create policy guide_insert_self on public.user_guide_progress for insert to authenticated
  with check (user_id = auth.uid() and public.belongs_to_tenant(tenant_id));

drop policy if exists guide_update_self on public.user_guide_progress;
create policy guide_update_self on public.user_guide_progress for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists guide_delete_self on public.user_guide_progress;
create policy guide_delete_self on public.user_guide_progress for delete to authenticated
  using (user_id = auth.uid());

drop trigger if exists set_updated_at on public.user_guide_progress;
create trigger set_updated_at before update on public.user_guide_progress
for each row execute function public.tg_set_updated_at();


-- ==========================================================
-- MIGRATIONS: 0019_agendamento_publico.sql
-- ==========================================================

-- =====================================================================
-- 0019 - Agendamento pelo site, sem login
--
-- A pessoa escolhe dia e horario numa pagina publica e sai com um
-- comprovante em PDF. A reserva nasce como "a confirmar": a pagina e
-- aberta a qualquer um, e horario bloqueado por engano ou por trote
-- custa caro numa agenda de clinica.
-- =====================================================================

alter table public.appointments
  -- Codigo curto do comprovante. E a unica chave que a pessoa tem para
  -- baixar o PDF depois — nao ha login para identifica-la.
  add column if not exists public_code        text,
  add column if not exists requested_online   boolean not null default false,
  add column if not exists requester_name     text,
  add column if not exists requester_phone    text,
  add column if not exists requester_email    citext,
  add column if not exists requester_ip       inet,
  add column if not exists requested_at       timestamptz,
  add column if not exists confirmed_by       uuid,
  add column if not exists rejected_at        timestamptz,
  add column if not exists reject_reason      text;

create unique index if not exists uq_appointments_public_code
  on public.appointments (public_code) where public_code is not null;

-- Fila de pedidos esperando a recepcao decidir.
create index if not exists idx_appointments_a_confirmar
  on public.appointments (tenant_id, scheduled_date)
  where requested_online and confirmed_at is null and rejected_at is null and deleted_at is null;

-- ---------------------------------------------------------------------
-- Um pedido publico por horario
--
-- A checagem antes do insert nao basta: dois visitantes clicando ao mesmo
-- tempo passam pelos dois `select` e gravam os dois. So o indice unico
-- resolve — a segunda gravacao falha e a tela pede outro horario.
--
-- O indice cobre apenas o que veio do site. O balcao continua podendo
-- marcar varios funcionarios da mesma empresa no mesmo horario, que e
-- exatamente o que o agendamento avulso em lote faz.
-- ---------------------------------------------------------------------
create unique index if not exists uq_appointments_reserva_online
  on public.appointments (tenant_id, scheduled_at)
  where requested_online
    and deleted_at is null
    and rejected_at is null
    and status not in ('cancelado','remarcado','ausente');

-- ---------------------------------------------------------------------
-- Grade de atendimento aberta ao publico
--
-- Fica em tenant_settings para a clinica mudar sem depender de deploy:
-- feriado, mutirao e mudanca de expediente acontecem o tempo todo.
-- ---------------------------------------------------------------------
insert into public.tenant_settings (tenant_id, group_key, settings)
select t.id, 'agendamento_online', jsonb_build_object(
  'ativo', true,
  'grade', jsonb_build_array(
    '07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00',
    '13:30','14:00','14:30','15:00','15:30','16:00','16:30'
  ),
  'dias_uteis', jsonb_build_array(1,2,3,4,5),
  'dias_de_antecedencia', 1,
  'janela_de_dias', 45
)
from public.tenants t
on conflict (tenant_id, group_key) do nothing;


-- ==========================================================
-- MIGRATIONS: 0020_catalogo_procedimentos.sql
-- ==========================================================

-- ---------------------------------------------------------------------
-- Catalogo inicial de procedimentos que geram repasse ao medico.
--
-- Os valores vieram da tabela da clinica e ficam editaveis na tela.
-- A insercao percorre os tenants existentes: nada aqui e especifico de um
-- cliente, e um tenant novo comeca vazio ate clicar em "restaurar catalogo".
-- ---------------------------------------------------------------------

insert into public.procedure_types (tenant_id, code, name, default_fee, sort_order)
select t.id, c.code, c.name, c.fee, c.ordem
from public.tenants t
cross join (values
  ('cps',                    'C.P.S.',                      20.00,  10),
  ('seduc',                  'SEDUC',                       18.00,  20),
  ('ingresso',               'Ingresso',                    44.00,  30),
  ('pericia',                'Perícia',                     30.00,  40),
  ('pericia_domiciliar_50',  'Perícia domiciliar (50 km)',    0.00,  50),
  ('pericia_domiciliar_100', 'Perícia domiciliar (100 km)',   0.00,  60),
  ('junta_pericia',          'Junta Médica Perícia',        130.00,  70),
  ('junta_medica',           'Junta Médica',                 64.00,  80),
  ('junta_auxiliar',         'Junta Médica auxiliar',         0.00,  90),
  ('consulta_ocupacional',   'Consulta ocupacional',          0.00, 100)
) as c(code, name, fee, ordem)
on conflict (tenant_id, code) do nothing;

-- Procedimento padrao do atendimento clinico, usado quando a consulta e
-- finalizada sem procedimento escolhido na tela.
insert into public.tenant_settings (tenant_id, group_key, settings)
select t.id, 'repasse', jsonb_build_object('procedimento_padrao', 'consulta_ocupacional')
from public.tenants t
on conflict (tenant_id, group_key) do nothing;


-- ==========================================================
-- MIGRATIONS: 0021_tv_destino_por_painel.sql
-- ==========================================================

-- =====================================================================
-- Destino da chamada por tipo de sala
--
-- A clinica tem duas TVs em lugares diferentes. A da sala de espera so
-- deve mostrar quem foi chamado para a recepcao e para a triagem; a do
-- corredor interno mostra as salas de exame e os consultorios.
--
-- Ate aqui toda chamada era gravada como 'sala'. Agora o tipo da sala
-- decide o destino, e cada painel filtra o que e seu.
-- =====================================================================

create or replace function public.tv_destino_da_sala(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind in ('recepcao', 'guiche') then 'recepcao'
    when p_kind = 'triagem'               then 'triagem'
    else 'sala'
  end;
$$;

comment on function public.tv_destino_da_sala(text) is
  'Painel de TV em que a chamada da sala aparece: recepcao | triagem | sala.';

-- Chamadas ja gravadas ganham o destino certo, olhando o nome da sala.
update public.tv_calls t
   set destination = public.tv_destino_da_sala(r.kind)
  from public.rooms r
 where r.tenant_id = t.tenant_id
   and r.name = t.room_name
   and coalesce(t.destination, 'sala') = 'sala'
   and public.tv_destino_da_sala(r.kind) <> 'sala';

create index if not exists idx_tv_calls_destino
  on public.tv_calls (tenant_id, destination, called_at desc);


-- ==========================================================
-- MIGRATIONS: 0022_assinatura_dos_medicos.sql
-- ==========================================================

-- =====================================================================
-- Assinatura manuscrita de cada medico
--
-- Os documentos de saida (A.S.O., resultado de exame, atestado) saem com
-- a assinatura do medico responsavel. A imagem fica no bucket privado
-- 'signatures'; aqui guardamos so o caminho.
--
-- A captura e sempre feita pelo proprio medico, e a data do consentimento
-- registra quando ele autorizou o uso da assinatura nos documentos.
-- =====================================================================

alter table public.profiles
  add column if not exists signature_path       text,
  add column if not exists signature_updated_at timestamptz,
  add column if not exists signature_consent_at timestamptz,
  add column if not exists rqe                  text;

comment on column public.profiles.signature_path is
  'Caminho da assinatura no bucket signatures. A imagem nunca fica no banco.';
comment on column public.profiles.signature_consent_at is
  'Quando o profissional autorizou o uso da assinatura nos documentos emitidos.';
comment on column public.profiles.rqe is
  'Registro de Qualificacao de Especialista, quando houver.';

-- Quem assinou cada documento emitido.
alter table public.documents
  add column if not exists signed_by         uuid references public.profiles(id) on delete set null,
  add column if not exists signer_name       text,
  add column if not exists signer_council    text;

comment on column public.documents.signer_name is
  'Nome e registro gravados no momento da emissao: o documento nao muda se o cadastro mudar depois.';

create index if not exists idx_documents_signer
  on public.documents (tenant_id, signed_by) where deleted_at is null;


-- ==========================================================
-- MIGRATIONS: 0023_exames_psicossocial_e_mesclagem.sql
-- ==========================================================

-- =====================================================================
-- 0023 - Ajustes pedidos pela clinica entre 20/08 e 27/08
--
-- Cobre o que ainda faltava da lista da recepcao:
--   * bloco psicossocial na ficha clinica;
--   * fichas de exame preenchidas na sala (Romberg, fadiga, dinamometria,
--     Ishihara, acuidade);
--   * laudos que chegam dias depois, anexados ao cadastro do paciente;
--   * unificacao de cadastros duplicados do mesmo paciente.
--
-- Nada aqui e especifico de um cliente: os exames entram por seed e as
-- perguntas ficam no codigo, como os demais blocos da ficha.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AVALIACAO PSICOSSOCIAL
-- "incluir perguntas de exame psicossocial, caso essa opcao tenha sido
--  flegada na aba recepcao"
--
-- Segue o mesmo formato dos outros blocos da ficha: um jsonb por bloco.
-- ---------------------------------------------------------------------
alter table public.medical_consultations
  add column if not exists psicossocial jsonb not null default '{}'::jsonb;

comment on column public.medical_consultations.psicossocial is
  'Respostas do questionario de fatores de risco psicossocial. So e '
  'preenchido quando a recepcao marca o exame para o paciente.';

-- ---------------------------------------------------------------------
-- 2. EXAMES EXECUTADOS FORA DA CLINICA E COM DESCRICAO LIVRE
-- "Raio x nao tera sala, devera ser emitido uma guia no final do
--  atendimento encaminhando para exame"
-- "exames laboratoriais deve ter uma aba para descrever qual analise
--  deve ser feita"
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists is_external          boolean not null default false,
  add column if not exists requires_description boolean not null default false;

comment on column public.exam_types.is_external is
  'Exame feito fora da clinica: nao entra em fila de sala e sai como guia.';
comment on column public.exam_types.requires_description is
  'A recepcao precisa descrever o que foi solicitado (analises, incidencias).';

-- ---------------------------------------------------------------------
-- 3. LAUDOS QUE CHEGAM DEPOIS
-- "alguns exames sao laudados depois de alguns dias, ter a opcao de
--  anexar exames no cadastro do paciente"
--
-- A tabela patient_attachments ja existia sem uso; ganha aqui o vinculo
-- com o tipo de exame para o laudo aparecer junto do exame certo.
-- ---------------------------------------------------------------------
alter table public.patient_attachments
  add column if not exists exam_type_id    uuid references public.exam_types(id) on delete set null,
  add column if not exists patient_exam_id uuid references public.patient_exams(id) on delete set null,
  add column if not exists kind            text not null default 'exame';

create index if not exists idx_patient_attachments_paciente
  on public.patient_attachments (tenant_id, patient_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- 4. UNIFICAR CADASTROS DO MESMO PACIENTE
-- "criar opc de mesclar clientes" / "Unificar cadastros de pacientes"
--
-- Move todo o historico para o cadastro de destino e arquiva o de origem.
-- Nada e apagado: o cadastro antigo continua consultavel na auditoria.
-- ---------------------------------------------------------------------
create or replace function public.merge_patients(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_source_name text;
  v_target_name text;
begin
  if p_source = p_target then
    raise exception 'Origem e destino nao podem ser o mesmo cadastro'
      using errcode = '22023';
  end if;

  select tenant_id, full_name into v_tenant, v_source_name
    from public.patients where id = p_source and deleted_at is null;
  if v_tenant is null then
    raise exception 'Cadastro de origem nao encontrado' using errcode = 'P0002';
  end if;

  select full_name into v_target_name
    from public.patients
   where id = p_target and tenant_id = v_tenant and deleted_at is null;
  if v_target_name is null then
    raise exception 'Cadastro de destino nao encontrado' using errcode = 'P0002';
  end if;

  if not public.can_access(v_tenant, 'pacientes.editar') then
    raise exception 'Sem permissao para unificar cadastros' using errcode = '42501';
  end if;

  update public.appointments          set patient_id = p_target where patient_id = p_source;
  update public.attendances           set patient_id = p_target where patient_id = p_source;
  update public.patient_exams         set patient_id = p_target where patient_id = p_source;
  update public.exam_results          set patient_id = p_target where patient_id = p_source;
  update public.triages               set patient_id = p_target where patient_id = p_source;
  update public.medical_consultations set patient_id = p_target where patient_id = p_source;
  update public.medical_notes         set patient_id = p_target where patient_id = p_source;
  update public.patient_attachments   set patient_id = p_target where patient_id = p_source;
  update public.patient_employments   set patient_id = p_target where patient_id = p_source;
  update public.patient_consents      set patient_id = p_target where patient_id = p_source;
  update public.documents             set patient_id = p_target where patient_id = p_source;
  update public.payments              set patient_id = p_target where patient_id = p_source;
  update public.queue_tickets         set patient_id = p_target where patient_id = p_source;
  update public.order_items           set patient_id = p_target where patient_id = p_source;

  -- Completa no destino apenas os campos que estiverem vazios: o cadastro
  -- escolhido pela recepcao continua sendo a versao boa.
  update public.patients t set
    cpf                 = coalesce(t.cpf, s.cpf),
    rg                  = coalesce(t.rg, s.rg),
    birth_date          = coalesce(t.birth_date, s.birth_date),
    phone               = coalesce(t.phone, s.phone),
    whatsapp            = coalesce(t.whatsapp, s.whatsapp),
    email               = coalesce(t.email, s.email),
    zip_code            = coalesce(t.zip_code, s.zip_code),
    street              = coalesce(t.street, s.street),
    number              = coalesce(t.number, s.number),
    district            = coalesce(t.district, s.district),
    city                = coalesce(t.city, s.city),
    state               = coalesce(t.state, s.state),
    company_id          = coalesce(t.company_id, s.company_id),
    job_title           = coalesce(t.job_title, s.job_title),
    department          = coalesce(t.department, s.department),
    registration_number = coalesce(t.registration_number, s.registration_number),
    needs_review        = false,
    updated_at          = now()
    from public.patients s
   where t.id = p_target and s.id = p_source;

  update public.patients
     set deleted_at = now(),
         needs_review = false,
         notes = concat_ws(chr(10), notes,
                 format('Cadastro unificado em %s no paciente %s.', now()::date, v_target_name))
   where id = p_source;

  insert into public.audit_logs
    (tenant_id, user_id, action, entity, entity_id, patient_id, description, origin, is_automatic)
  values
    (v_tenant, auth.uid(), 'update', 'patients', p_target, p_target,
     format('Cadastro de %s unificado em %s', v_source_name, v_target_name), 'sistema', false);

  return jsonb_build_object(
    'source', p_source, 'source_name', v_source_name,
    'target', p_target, 'target_name', v_target_name);
end$$;

comment on function public.merge_patients is
  'Unifica dois cadastros do mesmo paciente, movendo todo o historico para o destino.';

grant execute on function public.merge_patients(uuid, uuid) to authenticated;


-- ==========================================================
-- MIGRATIONS: 0024_empresa_sem_ficha_clinica.sql
-- ==========================================================

-- =====================================================================
-- 0024 - Empresa dispensada da ficha clinica
--
-- "Documentos: emitir ficha clinica exceto para pericia, acl, sisper e
--  empresa agape"
--
-- Pericia, ACL e SISPER sao caracteristicas do atendimento e ja sao
-- resolvidas por procedencia e procedimento. A Agape e o unico caso ligado
-- ao contrato da empresa, e por isso vira uma marca no cadastro dela — e
-- nao um nome escrito no codigo. Amanha entra outra empresa na mesma
-- regra sem precisar de deploy.
-- =====================================================================

alter table public.companies
  add column if not exists emite_ficha_clinica boolean not null default true;

comment on column public.companies.emite_ficha_clinica is
  'Quando falso, o atendimento do colaborador nao oferece ficha clinica: '
  'sai apenas o A.S.O. e os laudos dos exames.';


-- ==========================================================
-- MIGRATIONS: 0025_procedimento_na_recepcao.sql
-- ==========================================================

-- =====================================================================
-- 0025 - Procedimento definido na recepcao
--
-- "ao inves de ter que selecionar na ficha clinica na area do medico o que
--  e (Pericia, junta medica, entre outros), colocar essa opc na area da
--  recepcao qnd for direcionar para quais exames"
--
-- Alem de tirar a escolha das costas do medico, isso e o que torna
-- possivel a outra regra que a clinica pediu: so da para nao emitir ficha
-- clinica numa pericia se o sistema souber que aquilo e uma pericia antes
-- de chegar no medico.
-- =====================================================================

alter table public.attendances
  add column if not exists procedure_code text;

comment on column public.attendances.procedure_code is
  'Procedimento escolhido pela recepcao ao liberar o paciente. Alimenta o '
  'repasse ao medico e decide se o atendimento emite ficha clinica.';

create index if not exists idx_attendances_procedimento
  on public.attendances (tenant_id, procedure_code) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Quais procedimentos dispensam a ficha clinica
--
-- "emitir ficha clinica exceto para pericia, acl, sisper e empresa agape"
--
-- Vira uma marca no catalogo, e nao uma lista de codigos escrita no
-- codigo da aplicacao: a clinica citou ACL, que ainda nao existe no
-- cadastro, e outros vao aparecer. Quem cadastrar o procedimento decide.
-- ---------------------------------------------------------------------
alter table public.procedure_types
  add column if not exists emite_ficha_clinica boolean not null default true;

comment on column public.procedure_types.emite_ficha_clinica is
  'Quando falso, o atendimento com este procedimento nao oferece ficha '
  'clinica: sai apenas o A.S.O., o laudo dos exames e o comprovante.';

-- Pericia e junta medica sao avaliacoes, nao consulta ocupacional: nao ha
-- ficha clinica a emitir. Roda em todos os tenants que ja tenham o
-- catalogo, sem tocar em procedimento que a clinica tenha criado depois.
update public.procedure_types
   set emite_ficha_clinica = false
 where code in ('pericia', 'pericia_domiciliar_50', 'pericia_domiciliar_100',
                'junta_pericia', 'junta_medica', 'junta_auxiliar');


-- ==========================================================
-- MIGRATIONS: 0026_consulta_nao_apaga_a_sala.sql
-- ==========================================================

-- =====================================================================
-- 0026 - Salvar a consulta nao pode esvaziar a sala
--
-- Encontrado ao rodar o percurso completo de um paciente de teste.
--
-- `tg_consultation_progress` copiava `medical_consultations.room_id` para
-- `attendances.current_room_id` a cada gravacao. A tela do medico nunca
-- preencheu esse campo, entao a primeira vez que o medico salvava a
-- consulta o vinculo com o consultorio virava nulo.
--
-- O efeito aparecia depois: ao finalizar, o codigo que libera a sala nao
-- sabia mais de qual sala se tratava. A sala seguia "ocupada" pelo paciente
-- que ja tinha ido embora e o botao "chamar proximo" nunca voltava naquele
-- consultorio — com tres salas, a fila do medico travava inteira depois de
-- tres atendimentos.
--
-- A aplicacao passou a gravar o room_id na consulta. Este gatilho fica
-- defensivo: sem sala informada, mantem a que ja estava.
-- =====================================================================

create or replace function public.tg_consultation_progress()
returns trigger language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           -- coalesce: consulta sem sala informada nao desfaz a chamada que
           -- levou o paciente ate o consultorio.
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;
  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;
  end if;
  return new;
end$$;


-- ==========================================================
-- MIGRATIONS: 0026_riscos_ocupacionais.sql
-- ==========================================================

-- =====================================================================
-- Perigos e fatores de risco no A.S.O.
--
-- O modelo de A.S.O. da clinica tem um bloco obrigatorio com cinco
-- categorias de risco (fisico, quimico, biologico, ergonomico e acidente).
-- Sem ele o documento nao cumpre a NR-7.
--
-- O risco nao e do paciente: e do cargo dentro da empresa. Dois motoristas
-- da mesma transportadora tem o mesmo risco; o mesmo motorista em outra
-- empresa pode ter outro. Por isso a chave e empresa + cargo, com um perfil
-- geral da empresa quando o cargo nao estiver cadastrado.
-- =====================================================================

create table if not exists public.company_risk_profiles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete cascade,
  -- Nulo = perfil geral da empresa, usado quando o cargo nao tem o seu.
  cargo        text,
  fisicos      text,
  quimicos     text,
  biologicos   text,
  ergonomicos  text,
  acidentes    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  deleted_at   timestamptz
);

comment on table public.company_risk_profiles is
  'Perigos e fatores de risco por empresa e cargo, impressos no A.S.O.';
comment on column public.company_risk_profiles.cargo is
  'Nulo significa perfil geral da empresa: vale para todo cargo sem perfil proprio.';

-- Um perfil por empresa+cargo. `coalesce` porque nulo nao repete em unique.
create unique index if not exists uq_risk_profile_empresa_cargo
  on public.company_risk_profiles (tenant_id, company_id, coalesce(lower(cargo), ''))
  where deleted_at is null;

create index if not exists idx_risk_profile_empresa
  on public.company_risk_profiles (tenant_id, company_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Dados que o A.S.O. da clinica imprime e ainda nao tinham lugar
-- ---------------------------------------------------------------------
alter table public.attendances
  add column if not exists riscos jsonb;

comment on column public.attendances.riscos is
  'Copia dos riscos no momento da emissao. O A.S.O. ja impresso nao muda se o perfil da empresa mudar depois.';

alter table public.patients
  add column if not exists admission_date date;

comment on column public.patients.admission_date is
  'Data de admissao na empresa, impressa no cabecalho dos documentos.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.company_risk_profiles enable row level security;
alter table public.company_risk_profiles force row level security;

drop policy if exists tenant_select on public.company_risk_profiles;
drop policy if exists tenant_write  on public.company_risk_profiles;

create policy tenant_select on public.company_risk_profiles for select to authenticated
  using (public.can_access(tenant_id, 'empresas.ver'));

create policy tenant_write on public.company_risk_profiles for all to authenticated
  using (public.can_access(tenant_id, 'empresas.administrar'))
  with check (public.can_access(tenant_id, 'empresas.administrar'));

drop trigger if exists set_updated_at on public.company_risk_profiles;
create trigger set_updated_at before update on public.company_risk_profiles
  for each row execute function public.tg_set_updated_at();


-- ==========================================================
-- MIGRATIONS: 0027_valores_por_empresa.sql
-- ==========================================================

-- =====================================================================
-- Valor de cada exame negociado com a empresa
--
-- "cada empresa tem um valor para exame, entao vincular o valor ao
-- contrato da empresa" — o preco do mesmo exame muda de contrato para
-- contrato, e hoje a recepcao cobra de cabeca.
--
-- O valor fica na empresa, nao no contrato: o contrato vence e e renovado,
-- e o preco negociado sobrevive a renovacao. Quando um contrato precisar de
-- preco proprio, basta apontar contract_id.
-- =====================================================================

create table if not exists public.company_exam_prices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  exam_type_id  uuid not null references public.exam_types(id) on delete cascade,
  -- Opcional: preco especifico de um contrato, quando houver mais de um.
  contract_id   uuid references public.company_contracts(id) on delete set null,
  price         numeric(12,2) not null check (price >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

comment on table public.company_exam_prices is
  'Preco de cada exame negociado com a empresa. Sem linha aqui, vale o preco de tabela do exame.';

create unique index if not exists uq_exam_price_empresa
  on public.company_exam_prices (company_id, exam_type_id, coalesce(contract_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

create index if not exists idx_exam_price_empresa
  on public.company_exam_prices (tenant_id, company_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Preco de tabela do exame, usado quando a empresa nao negociou o seu
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists default_price numeric(12,2) not null default 0;

comment on column public.exam_types.default_price is
  'Preco padrao do exame, usado para particular e para empresa sem valor negociado.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.company_exam_prices enable row level security;
alter table public.company_exam_prices force row level security;

drop policy if exists tenant_select on public.company_exam_prices;
drop policy if exists tenant_write  on public.company_exam_prices;

-- Quem atende precisa ver o preco para cobrar na recepcao.
create policy tenant_select on public.company_exam_prices for select to authenticated
  using (public.belongs_to_tenant(tenant_id));

create policy tenant_write on public.company_exam_prices for all to authenticated
  using (public.can_access(tenant_id, 'empresas.administrar'))
  with check (public.can_access(tenant_id, 'empresas.administrar'));

drop trigger if exists set_updated_at on public.company_exam_prices;
create trigger set_updated_at before update on public.company_exam_prices
  for each row execute function public.tg_set_updated_at();


-- ==========================================================
-- MIGRATIONS: 0028_risco_do_empregado.sql
-- ==========================================================

-- =====================================================================
-- Risco ocupacional anotado no cadastro do empregado
--
-- "Na parte de cadastro do paciente deve existir um campo onde podemos
--  colocar o risco ocupacional do empregado da empresa. Esse risco
--  ocupacional deve aparecer no documento A.S.O." -- Isabella, 15/09.
--
-- Ate aqui o risco vinha so do perfil da empresa por cargo. Serve para a
-- maioria, mas nao para o empregado que faz algo diferente do resto do
-- cargo dele. Quando este campo esta preenchido, ele vence o perfil.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.patients
  add column if not exists occupational_risks text;

comment on column public.patients.occupational_risks is
  'Perigos e fatores de risco deste empregado, quando diferem do perfil do cargo. Sai impresso no A.S.O.';


-- ==========================================================
-- MIGRATIONS: 0029_consulta_decide_se_vai_ao_medico.sql
-- ==========================================================

-- =====================================================================
-- So vai ao medico quem tem consulta marcada
--
-- "a consulta clinica ocupacional e a propria avaliacao com o medico.
--  entao o paciente so deve passar pelo medico se o icone 'consulta
--  clinica ocupacional' estiver ticado. se nao, ele finaliza os exames e
--  pode ir embora (acontece casos do paciente ir la apenas para fazer
--  eletroencefalo por exemplo e nao precisar ir pro medico)"
--                                              -- Isabella, 17/09/2026
--
-- Ate aqui o gatilho mandava TODO mundo para 'aguardando_medico' quando
-- os exames acabavam. Quem foi so fazer um eletroencefalograma caia na
-- fila do consultorio e ficava la, esperando uma consulta que ninguem
-- pediu, ate alguem notar e tirar na mao.
--
-- De quebra, isto resolve um travamento: a propria consulta e um item de
-- `patient_exams`, entao ela contava como exame pendente e segurava a
-- transicao. O paciente com consulta marcada so saia de 'aguardando_exames'
-- se alguem concluisse a consulta antes de ela acontecer.
--
-- Agora a consulta e contada a parte: ela decide o destino, nao atrasa a
-- saida das filas.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- A consulta clinica (CLINICO) fica fora das contagens de fila: ela nao
  -- e feita numa sala de exame, e por isso nao pode segurar a etapa.
  select
    count(*) filter (
      where et.code is distinct from 'CLINICO'
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where et.code is distinct from 'CLINICO'
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      et.code = 'CLINICO'
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             -- Consulta marcada: segue para o consultorio.
             when tem_consulta then 'aguardando_medico'
             -- Sem consulta: acabaram os exames, o paciente pode ir embora.
             -- Vai para o pagamento, que e o passo seguinte da esteira.
             else 'aguardando_pagamento'
           end,
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');

  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();

comment on function public.tg_patient_exam_progress() is
  'Move o atendimento conforme os exames andam. So vai ao medico quem tem a consulta clinica marcada.';


-- ==========================================================
-- MIGRATIONS: 0030_exame_que_nao_ocupa_sala.sql
-- ==========================================================

-- =====================================================================
-- Exame que nao ocupa sala da clinica
--
-- A clinica relatou tres sintomas em 18/09 que sao o mesmo problema:
--   "consulta clinica ocupacional nao esta direcionando para modulo
--    medico, fica sem sala"
--   "raio x tambem esta ficando preso sem sala perdido no processo"
--   "sem pacientes na fila e mesmo assim mostrando paciente ali"
--
-- Nem todo item da lista de exames acontece numa sala daqui:
--   - Consulta clinica: e a avaliacao com o medico, atendida pela fila
--     do modulo medico, que e uma so para os consultorios.
--   - Raio X: nao e feito na clinica. O paciente leva a guia ao
--     laboratorio e o resultado volta depois.
--
-- Os dois entravam na fila de salas com sala nula e ficavam presos:
-- nenhum cartao os mostrava e nenhum botao os alcancava.
--
-- A correcao anterior barrava a criacao na recepcao, mas o check-in pelo
-- totem cria os exames direto do agendamento e passava por fora. Em vez
-- de remendar cada caminho de criacao, a regra passa a valer na hora de
-- USAR a fila -- que e por onde todos passam.
--
-- As linhas continuam sendo criadas de proposito: e assim que o sistema
-- sabe que aquele paciente pediu raio X, e e o CLINICO que decide se ele
-- vai ao consultorio no fim dos exames.
--
-- ATENCAO: a coleta laboratorial NAO entra aqui. Ela e feita na Sala 5
-- da clinica; o que ela nao tem e ficha de preenchimento na sala.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.exam_types
  add column if not exists ocupa_sala boolean not null default true;

comment on column public.exam_types.ocupa_sala is
  'Falso quando o exame nao e realizado numa sala da clinica: fica fora da fila de salas.';

update public.exam_types
   set ocupa_sala = (code not in ('RAIOX', 'CLINICO'));

-- ---------------------------------------------------------------------
-- Libera a sala que ficou presa por um exame que nunca seria chamado
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
 where r.current_attendance_id is not null
   and not exists (
     select 1
       from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = r.current_attendance_id
        and pe.status in ('chamado', 'em_andamento')
        and et.ocupa_sala
   );

-- ---------------------------------------------------------------------
-- O paciente pode ter varios exames chamados -- na MESMA sala
--
-- A trava antiga era `unique (attendance_id) where status in
-- ('chamado','em_andamento')`: no maximo um exame em atendimento por
-- paciente. Ela existe por um bom motivo -- ninguem pode ser chamado em
-- duas salas ao mesmo tempo -- mas tambem impedia chamar dois exames da
-- mesma sala de uma vez, que e o que a clinica pediu.
--
-- A regra certa nao e "um exame", e "uma sala". Um indice unico nao
-- consegue dizer isso, entao vira gatilho.
-- ---------------------------------------------------------------------
drop index if exists public.uq_patient_exam_in_service;

create or replace function public.tg_exame_em_uma_sala_so()
returns trigger
language plpgsql
as $$
declare
  v_outra uuid;
begin
  if new.status not in ('chamado','em_andamento') then
    return new;
  end if;

  select pe.room_id into v_outra
    from public.patient_exams pe
   where pe.attendance_id = new.attendance_id
     and pe.id <> new.id
     and pe.status in ('chamado','em_andamento')
     and pe.room_id is distinct from new.room_id
   limit 1;

  if found then
    raise exception
      'Paciente ja esta em atendimento em outra sala'
      using errcode = '23505';
  end if;

  return new;
end$$;

comment on function public.tg_exame_em_uma_sala_so() is
  'Impede o mesmo paciente de estar em atendimento em duas salas ao mesmo tempo. Varios exames na mesma sala sao permitidos.';

drop trigger if exists exame_em_uma_sala_so on public.patient_exams;
create trigger exame_em_uma_sala_so
before insert or update of status, room_id on public.patient_exams
for each row execute function public.tg_exame_em_uma_sala_so();

-- ---------------------------------------------------------------------
-- Chamar o proximo: so exame de sala, e TODOS os daquele paciente
--
-- "se o paciente tem varios exames para fazer em uma sala, ao chamar ele
--  na primeira vez ja aparecer todas as fichas e nao precisar chamar a
--  senha varias vezes"
--
-- Antes a chamada pegava um exame so. O paciente entrava, fazia um,
-- saia, e era chamado de novo pela mesma sala -- com a senha tocando na
-- TV a cada vez.
-- ---------------------------------------------------------------------
create or replace function public.call_next_for_room(p_tenant uuid, p_room uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_exam public.patient_exams%rowtype;
  v_ticket public.queue_tickets%rowtype;
  v_room public.rooms%rowtype;
  v_patient_name text;
  v_quantos int;
begin
  if not public.can_access(p_tenant, 'filas.operar') then
    raise exception 'Sem permissao para operar filas' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room and tenant_id = p_tenant;
  if not found then raise exception 'Sala nao encontrada' using errcode = 'P0002'; end if;

  select pe.* into v_exam
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
    join public.exam_types et on et.id = pe.exam_type_id
   where pe.tenant_id = p_tenant
     and pe.status in ('pendente','em_fila')
     and et.ocupa_sala
     and a.finished_at is null and a.cancelled_at is null
     and a.stage_code in ('aguardando_exames','em_exames')
     and a.in_service = false
     and (
       exists (select 1 from public.room_exam_types ret
                where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or et.default_room_id = p_room
     )
     and not exists (
       select 1 from public.patient_exams x
         join public.exam_types xt on xt.id = x.exam_type_id
        where x.attendance_id = pe.attendance_id
          and x.status in ('chamado','em_andamento')
          and xt.ocupa_sala)
   order by
     case pe.priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end,
     coalesce(pe.queued_at, a.checkin_at) asc
   limit 1
   for update of pe skip locked;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Chama TODOS os exames deste paciente que esta sala atende, de uma vez.
  update public.patient_exams pe
     set status = 'chamado', called_at = now(), room_id = p_room, updated_by = auth.uid()
    from public.exam_types et
   where et.id = pe.exam_type_id
     and pe.attendance_id = v_exam.attendance_id
     and pe.status in ('pendente','em_fila')
     and et.ocupa_sala
     and (
       exists (select 1 from public.room_exam_types ret
                where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or et.default_room_id = p_room
     );

  get diagnostics v_quantos = row_count;

  select * into v_exam from public.patient_exams where id = v_exam.id;

  update public.rooms
     set status = 'ocupada', current_attendance_id = v_exam.attendance_id
   where id = p_room;

  select qt.* into v_ticket
    from public.queue_tickets qt
   where qt.attendance_id = v_exam.attendance_id
   limit 1;

  select coalesce(p.social_name, p.full_name) into v_patient_name
    from public.patients p
   where p.id = v_exam.patient_id;

  insert into public.queue_events (tenant_id, ticket_id, attendance_id, room_id, exam_id, event, destination, called_by)
  values (p_tenant, v_ticket.id, v_exam.attendance_id, p_room, v_exam.id, 'chamada', 'sala', auth.uid());

  -- Uma chamada de TV por paciente, nao uma por exame.
  insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
  values (p_tenant, coalesce(v_ticket.code, '---'),
          split_part(coalesce(v_patient_name,''), ' ', 1),
          v_room.name,
          case
            when v_room.kind in ('recepcao', 'guiche') then 'recepcao'
            when v_room.kind = 'triagem'               then 'triagem'
            else 'sala'
          end,
          v_exam.priority);

  return jsonb_build_object(
    'found', true,
    'exam', to_jsonb(v_exam),
    'ticket', to_jsonb(v_ticket),
    'exames_chamados', v_quantos);
end$$;

-- ---------------------------------------------------------------------
-- O gatilho de progresso passa a usar a coluna, nao o codigo fixo
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- So conta como fila o que ocupa sala. A consulta clinica decide o
  -- destino mas nao segura a saida das filas: ela acontece depois.
  select
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      et.code = 'CLINICO'
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             when tem_consulta then 'aguardando_medico'
             else 'aguardando_pagamento'
           end,
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');

  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();

-- ---------------------------------------------------------------------
-- Destrava quem ja estava preso
--
-- Quem terminou os exames de sala antes desta correcao continua parado em
-- 'aguardando_exames', porque o que sobrou na fila era consulta ou raio X
-- -- que nunca seriam chamados. Empurra cada um para onde deveria estar.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = case
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id and et.code = 'CLINICO'
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_medico'
         else 'aguardando_pagamento'
       end,
       exams_finished_at = coalesce(a.exams_finished_at, now()),
       in_service = false,
       current_room_id = null
 where a.stage_code in ('aguardando_exames', 'em_exames')
   and a.finished_at is null
   and a.cancelled_at is null
   and a.deleted_at is null
   and not exists (
     select 1
       from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and et.ocupa_sala
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
   );


-- ==========================================================
-- MIGRATIONS: 0031_tipo_guia_de_exame.sql
-- ==========================================================

-- =====================================================================
-- Tipo de documento: guia de exame
--
-- "Aba recepcao esta dando erro ao imprimir a guia" -- Isabella, 18/09.
--
-- `documents.kind` e um enum do Postgres. A guia foi construida em 17/09
-- com o tipo 'guia_exame', que existia no TypeScript mas nunca foi
-- adicionado ao enum. Toda emissao falhava na gravacao, depois do PDF ja
-- montado -- a recepcao via "erro" sem nenhuma pista do motivo.
--
-- Mesmo erro de classe da permissao inventada de 13/09: passa no
-- compilador, passa nos testes, e quebra na frente de quem usa. O
-- `check:build` passou a conferir isso tambem.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter type document_kind add value if not exists 'guia_exame';


-- ==========================================================
-- MIGRATIONS: 0032_sala_do_exame_segue_a_sala_padrao.sql
-- ==========================================================

-- =====================================================================
-- A sala em que o exame e chamado segue a sala padrao dele
--
-- "os exames de dinamometria (palmar, escapular e lombar) estao sendo
--  chamados na sala 5, eles devem ser chamados na sala 7"
--                                              -- Isabella, 21/09
--
-- Existem dois lugares que dizem em que sala um exame acontece:
--
--   exam_types.default_room_id  -- a sala do exame
--   room_exam_types             -- quais exames cada sala atende
--
-- A chamada do proximo paciente aceita os DOIS. Quando o script de
-- precos e salas moveu as dinamometrias para a Sala 7, ele mexeu so no
-- primeiro. O vinculo antigo com a Sala 5 -- criado pelo seed, porque a
-- dinamometria generica era feita la -- continuou valendo, e a Sala 5
-- seguiu chamando.
--
-- Duas verdades sobre a mesma coisa sempre divergem. Aqui os vinculos
-- passam a seguir a sala padrao, e um gatilho mantem isso de pe quando
-- alguem trocar a sala de um exame pela tela de Configuracoes.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tira o vinculo que contradiz a sala padrao
--
-- So mexe em exame que TEM sala padrao definida. Exame sem sala padrao
-- pode ser atendido por varias salas de proposito, e isso continua valendo.
-- ---------------------------------------------------------------------
delete from public.room_exam_types ret
 using public.exam_types et
 where et.id = ret.exam_type_id
   and et.default_room_id is not null
   and ret.room_id <> et.default_room_id;

-- ---------------------------------------------------------------------
-- 2. Garante o vinculo com a sala certa
-- ---------------------------------------------------------------------
insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
select et.tenant_id, et.default_room_id, et.id
  from public.exam_types et
 where et.default_room_id is not null
   and et.is_active
   and et.deleted_at is null
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Trocar a sala de um exame passa a arrastar o vinculo junto
--
-- Sem isto, a proxima vez que alguem remanejar um exame pela tela cria
-- exatamente o mesmo problema -- e ninguem vai lembrar de mexer nas duas
-- tabelas.
-- ---------------------------------------------------------------------
create or replace function public.tg_sincronizar_sala_do_exame()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_room_id is not distinct from old.default_room_id then
    return new;
  end if;

  delete from public.room_exam_types
   where exam_type_id = new.id
     and (new.default_room_id is null or room_id <> new.default_room_id);

  if new.default_room_id is not null then
    insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
    values (new.tenant_id, new.default_room_id, new.id)
    on conflict do nothing;
  end if;

  return new;
end$$;

comment on function public.tg_sincronizar_sala_do_exame() is
  'Mantem room_exam_types alinhado com exam_types.default_room_id: duas verdades sobre a mesma sala sempre divergem.';

drop trigger if exists sincronizar_sala_do_exame on public.exam_types;
create trigger sincronizar_sala_do_exame
after update of default_room_id on public.exam_types
for each row execute function public.tg_sincronizar_sala_do_exame();


-- ==========================================================
-- MIGRATIONS: 0033_ninguem_fica_preso_nem_preso_a_sala.sql
-- ==========================================================

-- =====================================================================
-- 0033 - Tres buracos encontrados no pente fino de 21/09
--
-- Nenhum dos tres tem reclamacao da clinica ainda. Sairam de um teste que
-- passou dez pacientes pelo sistema inteiro e conferiu o dia peca por peca:
-- sao contradicoes entre partes que, sozinhas, passam.
--
--   1. Quem passa pela triagem e nao tem exame de sala fica preso.
--   2. Cancelar ou marcar ausente nao solta o paciente nem a sala.
--   3. A consulta clinica nunca e concluida.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Uma sala presa a um atendimento que acabou
--
-- Tres lugares diferentes precisam soltar sala: o fim da triagem, a etapa
-- terminal e o encerramento. Escrever a mesma coisa tres vezes e garantir
-- que uma delas fique para tras na proxima alteracao.
-- ---------------------------------------------------------------------
create or replace function public.liberar_salas_do_atendimento(p_attendance uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.rooms
     set status = 'disponivel', current_attendance_id = null
   where current_attendance_id = p_attendance;
end$$;

comment on function public.liberar_salas_do_atendimento(uuid) is
  'Solta qualquer sala que ainda aponte para o atendimento. Usada ao encerrar, cancelar e ao fim da triagem.';


-- ---------------------------------------------------------------------
-- 1. Fim da triagem: o destino depende do que o paciente tem para fazer
--
-- O gatilho mandava TODO mundo para 'aguardando_exames' ao fim da triagem.
-- Quem sai da triagem sem nenhum exame de sala -- o caso de quem veio so
-- para a consulta ocupacional -- caia numa fila em que nao havia nada para
-- concluir. E a fila de exames que dispara a etapa seguinte; sem exame,
-- nada dispara.
--
-- O paciente ficava invisivel: nao aparecia em sala nenhuma, nao aparecia
-- na fila do medico (que so enxerga 'aguardando_medico') e nem no aviso de
-- exame pendente (que ignora justamente 'aguardando_exames'). So apareceria
-- se alguem o procurasse pelo nome.
--
-- O destino agora e o mesmo que o gatilho dos exames ja usava: fila se ha
-- exame de sala, medico se ha consulta marcada, pagamento se nao ha nem um
-- nem outro.
-- ---------------------------------------------------------------------
create or replace function public.tg_triage_finished()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_na_fila int;
  v_tem_consulta boolean;
begin
  if new.finished_at is not null and old.finished_at is null then
    select
      count(*) filter (
        where coalesce(et.ocupa_sala, true)
          and pe.status in ('pendente','em_fila','chamado','em_andamento')),
      coalesce(bool_or(
        et.code = 'CLINICO'
          and pe.status in ('pendente','em_fila','chamado','em_andamento')), false)
      into v_na_fila, v_tem_consulta
      from public.patient_exams pe
      left join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = new.attendance_id;

    update public.attendances
       set stage_code = case
             when v_na_fila > 0   then 'aguardando_exames'
             when v_tem_consulta  then 'aguardando_medico'
             else                      'aguardando_pagamento'
           end,
           triage_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;

comment on function public.tg_triage_finished() is
  'Ao fim da triagem, manda o paciente para a fila, para o medico ou para o pagamento, conforme o que ele tem a fazer.';


-- ---------------------------------------------------------------------
-- 2. Etapa terminal solta o paciente e a sala
--
-- `move_attendance_stage` trocava o codigo da etapa e mais nada. Cancelar
-- um paciente que ja tinha sido chamado para uma sala deixava:
--
--   - `attendances.in_service = true`, ou seja, contado como em atendimento
--     no painel, para sempre;
--   - `attendances.current_room_id` apontando para a sala;
--   - `rooms.current_attendance_id` apontando para ele, com a sala marcada
--     como ocupada -- e o botao de chamar o proximo nao voltava ali.
--
-- Na tela existe codigo que solta a sala depois de cancelar. Mas a funcao e
-- chamavel por outros caminhos, e a garantia tem de estar onde a etapa muda.
-- ---------------------------------------------------------------------
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_terminal boolean;
begin
  select tenant_id into v_tenant from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  v_terminal := p_stage in ('finalizado','cancelado','ausente');

  perform set_config('app.manual_move', 'on', true);
  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now()) else finished_at end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now()) else cancelled_at end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now()) else absent_at end,
         in_service = case when v_terminal then false else in_service end,
         current_room_id = case when v_terminal then null else current_room_id end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);

  if v_terminal then
    perform public.liberar_salas_do_atendimento(p_attendance);

    -- Exame de quem foi embora nao e exame pendente. Sem isto ele fica na
    -- contagem de pendencias da clinica para sempre.
    if p_stage in ('cancelado','ausente') then
      update public.patient_exams
         set status = 'cancelado', updated_by = auth.uid()
       where attendance_id = p_attendance
         and status in ('pendente','em_fila','chamado','em_andamento');
    end if;
  end if;
end$$;

grant execute on function public.move_attendance_stage(uuid,text,text) to authenticated;
grant execute on function public.liberar_salas_do_atendimento(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Assinar a consulta conclui a consulta clinica
--
-- 'Consulta clinica ocupacional' e um tipo de exame como os outros: a
-- recepcao marca, ela entra em `patient_exams` e e ela que decide se o
-- paciente vai ao medico. Mas nenhuma tela a concluia.
--
-- O atendimento terminava, o paciente ia embora, e a consulta ficava
-- 'pendente' no prontuario dele para sempre -- aparecendo como exame nao
-- realizado na relacao de exames e no historico do paciente.
--
-- Quem conclui e quem faz: assinar a consulta conclui o item.
-- ---------------------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           -- coalesce: consulta sem sala informada nao desfaz a chamada que
           -- levou o paciente ate o consultorio.
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;

  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

    update public.patient_exams pe
       set status = 'concluido',
           started_at = coalesce(pe.started_at, new.started_at),
           finished_at = coalesce(pe.finished_at, new.finished_at),
           professional_id = coalesce(pe.professional_id, new.doctor_id),
           updated_by = auth.uid()
      from public.exam_types et
     where et.id = pe.exam_type_id
       and et.code = 'CLINICO'
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;
  return new;
end$$;

comment on function public.tg_consultation_progress() is
  'Abre e fecha a consulta: muda a etapa, solta a sala e conclui o item Consulta clinica ocupacional.';


-- ---------------------------------------------------------------------
-- 4. Conserta o que ja esta gravado
-- ---------------------------------------------------------------------

-- Sala apontando para atendimento que ja acabou.
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null
        or a.stage_code in ('finalizado','cancelado','ausente'));

-- Paciente contado como em atendimento depois de ter ido embora.
update public.attendances
   set in_service = false, current_room_id = null
 where stage_code in ('finalizado','cancelado','ausente')
   and (in_service or current_room_id is not null);

-- Exame ativo de quem foi embora.
update public.patient_exams pe
   set status = 'cancelado'
  from public.attendances a
 where a.id = pe.attendance_id
   and a.stage_code in ('cancelado','ausente')
   and pe.status in ('pendente','em_fila','chamado','em_andamento');

-- Consulta clinica que ficou pendente numa consulta ja assinada.
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and et.code = 'CLINICO'
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');

-- Paciente parado em 'aguardando_exames' sem nenhum exame de sala para fazer.
update public.attendances a
   set stage_code = case
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id and et.code = 'CLINICO'
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_medico'
         else 'aguardando_pagamento'
       end
 where a.stage_code = 'aguardando_exames'
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));


-- ==========================================================
-- MIGRATIONS: 0034_a_triagem_nao_e_interrompida_pela_bancada.sql
-- ==========================================================

-- =====================================================================
-- 0034 - Preencher a bancada nao pode interromper a triagem
--
-- Encontrado logo depois da 0033, no mesmo pente fino.
--
-- Acuidade, visao de cores, Romberg e fadiga sao feitos na mesa da
-- triagem, com a ficha de triagem aberta. Sao exames como os outros, e o
-- gatilho que reage ao ciclo de vida dos exames nao sabia disso:
--
--   - ao marcar o primeiro como "em andamento", ele jogava o atendimento
--     em 'em_exames' -- e o paciente sumia da lista da tela de Triagem,
--     com a ficha ainda aberta na frente de quem estava preenchendo;
--
--   - ao concluir o ultimo, ele mandava o paciente direto para
--     'aguardando_pagamento'. A triagem ficava pela metade, sem finalizar,
--     e o paciente era mandado ao caixa com a ficha em branco.
--
-- Enquanto a triagem esta acontecendo, quem decide o destino e o fim da
-- triagem -- nao a bancada. O gatilho dos exames passa a nao mexer em
-- quem esta em triagem.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- Paciente em triagem nao e movido pela bancada. `tg_triage_finished`
  -- decide para onde ele vai quando a ficha for finalizada, e ja olha os
  -- exames que sobraram para escolher entre fila, medico e pagamento.
  if att.stage_code in ('aguardando_triagem', 'em_triagem') then
    return new;
  end if;

  -- So conta como fila o que ocupa sala. A consulta clinica decide o
  -- destino mas nao segura a saida das filas: ela acontece depois.
  select
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      et.code = 'CLINICO'
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             when tem_consulta then 'aguardando_medico'
             else 'aguardando_pagamento'
           end,
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');

  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

comment on function public.tg_patient_exam_progress() is
  'Move o atendimento conforme os exames de sala. Nao mexe em quem esta em triagem: ali quem decide o destino e o fim da ficha.';

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();

-- ---------------------------------------------------------------------
-- Conserta o que ja esta gravado: triagem aberta com o paciente empurrado
-- para outra etapa pela bancada.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = 'em_triagem'
  from public.triages t
 where t.attendance_id = a.id
   and t.finished_at is null
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and a.stage_code in ('em_exames','aguardando_exames','aguardando_pagamento');


-- ==========================================================
-- MIGRATIONS: 0035_destrava_quem_ficou_preso_na_bancada.sql
-- ==========================================================

-- =====================================================================
-- 0035 - Destrava quem ficou preso na bancada da triagem
--
-- "todos os pacientes tao ficando presos na triagem mesmo depois de
--  clicar em concluir triagem"
-- "finalizei todos os exames salvei as fichas e o paciente nao foi pro
--  modulo medico e sumiu do fluxo"
--                                              -- Isabella, 21/09
--
-- A causa: salvar a ficha de um exame nunca mudava o status do exame.
-- Nas salas do quadro de Filas isso nao aparecia, porque la existe um
-- botao de concluir. Na bancada da triagem — acuidade, visao de cores,
-- Romberg, fadiga — nao existe botao nenhum: preencher a ficha E fazer o
-- exame. O exame ficava 'pendente' para sempre.
--
-- E desde 15/09, quando as salas de triagem sairam do quadro de Filas, nao
-- havia mais nenhuma sala que pudesse chamar esses exames. O paciente
-- ficava parado com "exames 0/15", sem sala que o chamasse e sem etapa que
-- avancasse. Dois pacientes estavam assim ha 67 horas.
--
-- A aplicacao foi corrigida. Este script conserta quem ja esta preso.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Exame de bancada que tem ficha preenchida esta feito
--
-- So mexe em exame que TEM resultado gravado. Exame sem ficha continua
-- pendente: quem faz e o examinador, nao este script.
-- ---------------------------------------------------------------------
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, er.created_at),
       finished_at = coalesce(pe.finished_at, er.updated_at, er.created_at),
       professional_id = coalesce(pe.professional_id, er.professional_id),
       room_id = coalesce(pe.room_id, et.default_room_id)
  from public.exam_results er,
       public.exam_types et,
       public.rooms r
 where er.patient_exam_id = pe.id
   and et.id = pe.exam_type_id
   and r.id = et.default_room_id
   and r.kind = 'triagem'
   and pe.status in ('pendente','em_fila','chamado','em_andamento');


-- ---------------------------------------------------------------------
-- 2. Triagem concluida que nao levou o paciente a lugar nenhum
--
-- Mesma regra do gatilho: fila se ha exame de sala por fazer, medico se ha
-- consulta marcada, pagamento se nao ha nem um nem outro.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = case
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id
              and coalesce(et.ocupa_sala, true)
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_exames'
         when exists (
           select 1 from public.patient_exams pe
             join public.exam_types et on et.id = pe.exam_type_id
            where pe.attendance_id = a.id and et.code = 'CLINICO'
              and pe.status in ('pendente','em_fila','chamado','em_andamento')
         ) then 'aguardando_medico'
         else 'aguardando_pagamento'
       end,
       triage_finished_at = coalesce(a.triage_finished_at, t.finished_at),
       in_service = false,
       current_room_id = null
  from public.triages t
 where t.attendance_id = a.id
   and t.finished_at is not null
   and a.stage_code in ('aguardando_triagem','em_triagem')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null;


-- ---------------------------------------------------------------------
-- 3. Sala de triagem presa a quem ja saiu
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and a.stage_code not in ('em_triagem','em_exames','em_consulta');


-- ---------------------------------------------------------------------
-- 4. Quem esta parado numa fila que nao tem como chama-lo
--
-- Sobra o caso de quem ficou em 'aguardando_exames' so com exame de
-- bancada por fazer, sem ficha preenchida. Esse tem de voltar para a
-- triagem: e la que o exame e feito, e e la que a tela o mostra.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = 'aguardando_triagem'
 where a.stage_code = 'aguardando_exames'
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
       join public.rooms r on r.id = et.default_room_id
      where pe.attendance_id = a.id and r.kind = 'triagem'
        and pe.status in ('pendente','em_fila','chamado','em_andamento'))
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
       left join public.rooms r on r.id = et.default_room_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and coalesce(r.kind, '') <> 'triagem'
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));


-- ---------------------------------------------------------------------
-- 5. Aviso: o que ainda precisa de alguem
-- ---------------------------------------------------------------------
do $$
declare
  v_presos int;
  v_bancada int;
begin
  select count(*) into v_presos
    from public.attendances
   where finished_at is null and cancelled_at is null and absent_at is null
     and checkin_at < now() - interval '12 hours';

  select count(*) into v_bancada
    from public.patient_exams pe
    join public.exam_types et on et.id = pe.exam_type_id
    join public.rooms r on r.id = et.default_room_id
   where r.kind = 'triagem'
     and pe.status in ('pendente','em_fila','chamado','em_andamento');

  raise notice 'Atendimentos abertos ha mais de 12 horas: %', v_presos;
  raise notice 'Exames de bancada ainda por preencher: %', v_bancada;
end$$;


-- ==========================================================
-- MIGRATIONS: 0036_psicossocial_e_do_medico.sql
-- ==========================================================

-- =====================================================================
-- 0036 - A avaliacao psicossocial e do medico
--
-- "a avaliacao psicossocial esta se repetindo, aparece tanto na triagem
--  quanto no modulo medico, pode deixar somente no modulo medico"
--                                              -- Isabella, 21/09
--
-- O questionario psicossocial estava em dois lugares: como exame de
-- bancada na triagem e como bloco da consulta. O paciente respondia duas
-- vezes as mesmas perguntas -- inclusive as de ideacao suicida, que nao e
-- coisa para se perguntar duas vezes na mesma manha.
--
-- Ele continua sendo um item que a recepcao marca e que a clinica cobra.
-- O que muda e quem pergunta: o medico, na consulta.
--
-- Consequencia: como a consulta clinica, o psicossocial deixa de ocupar
-- sala e passa a ser um dos itens que levam o paciente ao medico. Sem essa
-- segunda parte, quem marcasse so o psicossocial ficaria numa fila sem
-- ninguem para chama-lo -- o mesmo buraco de 15/09.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Psicossocial sai das salas
-- ---------------------------------------------------------------------
update public.exam_types
   set ocupa_sala = false
 where code = 'PSICO';

delete from public.room_exam_types ret
 using public.exam_types et
 where et.id = ret.exam_type_id and et.code = 'PSICO';

update public.exam_types
   set default_room_id = null
 where code = 'PSICO';


-- ---------------------------------------------------------------------
-- 2. Quem decide que o paciente vai ao medico
--
-- Era so a consulta clinica. Agora e ela ou o psicossocial: os dois sao
-- perguntados pelo medico.
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- Paciente em triagem nao e movido pela bancada. `tg_triage_finished`
  -- decide para onde ele vai quando a ficha for finalizada.
  if att.stage_code in ('aguardando_triagem', 'em_triagem') then
    return new;
  end if;

  select
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      et.code in ('CLINICO','PSICO')
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             when tem_consulta then 'aguardando_medico'
             else 'aguardando_pagamento'
           end,
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');

  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();


-- ---------------------------------------------------------------------
-- 3. O fim da triagem segue a mesma regra
-- ---------------------------------------------------------------------
create or replace function public.tg_triage_finished()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_na_fila int;
  v_tem_consulta boolean;
begin
  if new.finished_at is not null and old.finished_at is null then
    select
      count(*) filter (
        where coalesce(et.ocupa_sala, true)
          and pe.status in ('pendente','em_fila','chamado','em_andamento')),
      coalesce(bool_or(
        et.code in ('CLINICO','PSICO')
          and pe.status in ('pendente','em_fila','chamado','em_andamento')), false)
      into v_na_fila, v_tem_consulta
      from public.patient_exams pe
      left join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = new.attendance_id;

    update public.attendances
       set stage_code = case
             when v_na_fila > 0   then 'aguardando_exames'
             when v_tem_consulta  then 'aguardando_medico'
             else                      'aguardando_pagamento'
           end,
           triage_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;


-- ---------------------------------------------------------------------
-- 4. Assinar a consulta fecha tambem o psicossocial
--
-- Quem responde e o medico, na mesma consulta. Deixar o item pendente
-- depois da consulta assinada seria repetir o defeito de 21/09.
-- ---------------------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;

  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

    update public.patient_exams pe
       set status = 'concluido',
           started_at = coalesce(pe.started_at, new.started_at),
           finished_at = coalesce(pe.finished_at, new.finished_at),
           professional_id = coalesce(pe.professional_id, new.doctor_id),
           updated_by = auth.uid()
      from public.exam_types et
     where et.id = pe.exam_type_id
       and et.code in ('CLINICO','PSICO')
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;
  return new;
end$$;


-- ---------------------------------------------------------------------
-- 5. Conserta o que ja esta gravado
-- ---------------------------------------------------------------------

-- Psicossocial pendente em consulta ja assinada.
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and et.code = 'PSICO'
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');

-- Quem estava numa fila so por causa do psicossocial vai ao medico.
update public.attendances a
   set stage_code = 'aguardando_medico'
 where a.stage_code in ('aguardando_exames','em_exames')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'))
   and exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and et.code in ('CLINICO','PSICO')
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));


-- ==========================================================
-- MIGRATIONS: 0037_medico_do_pcmso_na_empresa.sql
-- ==========================================================

-- =====================================================================
-- 0037 - Medico responsavel pelo PCMSO fica na empresa
--
-- "aba empresa precisa ter um campo para incluir o medico do PCMSO, nome
--  e crm" / "assim no aso vai sair o nome do responsavel do PCMSO"
--                                              -- Isabella, 21/09
--
-- O A.S.O. traz o medico responsavel pelo PCMSO da EMPRESA do trabalhador,
-- nao o da clinica. Cada empresa contrata o seu, e o mesmo colaborador
-- pode aparecer em duas empresas com responsaveis diferentes.
--
-- Ate aqui esse nome saia de uma configuracao unica do sistema, o que
-- estava certo enquanto a clinica atendia uma empresa so.
--
-- A configuracao continua valendo como padrao: empresa sem responsavel
-- cadastrado cai nela, como antes.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.companies
  add column if not exists pcmso_doctor_name    text,
  add column if not exists pcmso_doctor_council text,
  add column if not exists pcmso_doctor_number  text,
  add column if not exists pcmso_doctor_state   char(2);

comment on column public.companies.pcmso_doctor_name is
  'Medico responsavel pelo PCMSO desta empresa; sai impresso no A.S.O.';
comment on column public.companies.pcmso_doctor_council is
  'Conselho do responsavel pelo PCMSO (CRM, CRO...). Vazio vale CRM.';

-- Sigla de conselho e UF em caixa alta, como saem no papel.
alter table public.companies
  drop constraint if exists companies_pcmso_state_valid;
alter table public.companies
  add constraint companies_pcmso_state_valid
  check (pcmso_doctor_state is null or pcmso_doctor_state ~ '^[A-Z]{2}$');


-- ==========================================================
-- MIGRATIONS: 0038_ficha_do_psicossocial_separada.sql
-- ==========================================================

-- =====================================================================
-- 0038 - A avaliacao psicossocial ganha ficha propria
--
-- "a avaliacao psicossocial que saiu nela, nao deve estar junto, precisa
--  sair em uma ficha separada"
--                                              -- Isabella, 23/09
--
-- Ela saia dentro da ficha clinica. Sao dois papeis com destinos
-- diferentes: a ficha clinica vai para a empresa contratante, e o
-- questionario psicossocial traz pergunta sobre ideacao suicida, sono e
-- humor. Misturar os dois manda ao RH da empresa uma informacao que nao e
-- dele.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter type document_kind add value if not exists 'avaliacao_psicossocial';


-- ==========================================================
-- MIGRATIONS: 0039_pericia_e_sisper_vao_ao_medico.sql
-- ==========================================================

-- =====================================================================
-- 0039 - Pericia, SISPER e ingresso vao ao medico, sempre
--
-- "os pacientes que eu categorizo como sisper ao clicar em encaminhar
--  para o medico vao direto para a aba pagamentos sem passar pela chamada
--  do medico"
--                                              -- Isabella, 24/09
--
-- A regra "so vai ao medico quem tem Consulta clinica ocupacional marcada"
-- foi criada em 17/09 e esta certa -- para o PARTICULAR. Quem vem so fazer
-- um eletroencefalograma nao deve cair numa fila de consulta que ninguem
-- pediu.
--
-- Para pericia, SISPER e ingresso ela nao se aplica: a avaliacao medica e
-- o proprio motivo da visita, e como nao e cobrada como exame nao existe
-- "Consulta clinica ocupacional" para a recepcao marcar. Na tela o botao
-- ja dizia "Liberar para o medico"; era o destino que discordava do
-- rotulo.
--
-- Os dois gatilhos que decidem o destino passam a considerar tambem a
-- procedencia. Nada muda para o particular.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quando os exames acabam
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- Paciente em triagem nao e movido pela bancada. `tg_triage_finished`
  -- decide para onde ele vai quando a ficha for finalizada.
  if att.stage_code in ('aguardando_triagem', 'em_triagem') then
    return new;
  end if;

  select
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      et.code in ('CLINICO','PSICO')
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  -- Pericia, SISPER e ingresso vao ao medico com ou sem item marcado.
  if coalesce(att.origin_kind::text, 'particular') in ('estado','sisper','ingresso') then
    tem_consulta := true;
  end if;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             when tem_consulta then 'aguardando_medico'
             else 'aguardando_pagamento'
           end,
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');

  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();


-- ---------------------------------------------------------------------
-- 2. Quando a triagem termina
-- ---------------------------------------------------------------------
create or replace function public.tg_triage_finished()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_na_fila int;
  v_tem_consulta boolean;
  v_origem text;
begin
  if new.finished_at is not null and old.finished_at is null then
    select
      count(*) filter (
        where coalesce(et.ocupa_sala, true)
          and pe.status in ('pendente','em_fila','chamado','em_andamento')),
      coalesce(bool_or(
        et.code in ('CLINICO','PSICO')
          and pe.status in ('pendente','em_fila','chamado','em_andamento')), false)
      into v_na_fila, v_tem_consulta
      from public.patient_exams pe
      left join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = new.attendance_id;

    select coalesce(origin_kind::text, 'particular') into v_origem
      from public.attendances where id = new.attendance_id;

    if v_origem in ('estado','sisper','ingresso') then
      v_tem_consulta := true;
    end if;

    update public.attendances
       set stage_code = case
             when v_na_fila > 0   then 'aguardando_exames'
             when v_tem_consulta  then 'aguardando_medico'
             else                      'aguardando_pagamento'
           end,
           triage_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;


-- ---------------------------------------------------------------------
-- 3. Conserta quem ja foi parar no caixa sem ver o medico
--
-- So quem ainda nao pagou e nao foi encerrado: atendimento fechado e
-- historico, e reabrir o passado confunde mais do que conserta.
-- ---------------------------------------------------------------------
update public.attendances a
   set stage_code = 'aguardando_medico'
 where a.stage_code = 'aguardando_pagamento'
   and coalesce(a.origin_kind::text, 'particular') in ('estado','sisper','ingresso')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and a.payment_status <> 'pago'
   and not exists (
     select 1 from public.medical_consultations mc
      where mc.attendance_id = a.id and mc.finished_at is not null);


-- ==========================================================
-- MIGRATIONS: 0040_apto_para_altura_e_eletricidade.sql
-- ==========================================================

-- =====================================================================
-- 0040 - Aptidao para trabalho em altura e com eletricidade
--
-- "no parecer do aso precisa incluir as opcs 'Apto para trabalho em
--  altura', 'Apto para trabalho com Eletricidade', entao precisa incluir
--  essas opcoes na caixa que o medico seleciona o parecer no modulo
--  medico"
--                                              -- Isabella, 23/09
--
-- Sao campos SEPARADOS da conclusao de aptidao, e nao mais duas opcoes da
-- mesma lista. O motivo e clinico: NR-35 (altura) e NR-10 (eletricidade)
-- sao aptidoes ADICIONAIS. Um trabalhador e apto para a funcao E, alem
-- disso, liberado para altura. Se virassem alternativas na mesma caixa, o
-- A.S.O. de quem trabalha em altura deixaria de dizer se a pessoa esta
-- apta para o proprio cargo -- que e a razao de o documento existir.
--
-- Nao marcado nao imprime nada, como hoje.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.medical_consultations
  add column if not exists apto_altura boolean not null default false,
  add column if not exists apto_eletricidade boolean not null default false;

comment on column public.medical_consultations.apto_altura is
  'Liberado para trabalho em altura (NR-35). Sai como linha marcada no parecer do A.S.O.';
comment on column public.medical_consultations.apto_eletricidade is
  'Liberado para trabalho com eletricidade (NR-10). Sai como linha marcada no parecer do A.S.O.';


-- ==========================================================
-- MIGRATIONS: 0041_medico_consegue_chamar_paciente.sql
-- ==========================================================

-- =====================================================================
-- 0041 - Cada papel consegue fazer o trabalho dele
--
-- "login do dr antonio nao esta chamando pacientes no modulo medico" /
-- "todos os logins de outros medicos aparece isso quando tenta chamar"
--                                              -- Isabella, 28/09
--
-- A tela dizia "Outro consultorio chamou este paciente agora" com ZERO
-- pacientes em consulta. Nao havia outro consultorio. A gravacao era
-- barrada pelo RLS, afetava zero linhas, e o codigo interpretava zero
-- linhas como "alguem chegou primeiro".
--
-- Esse e o jeito mais traicoeiro de uma permissao faltar: UPDATE barrado
-- por RLS nao levanta erro, so nao encontra a linha. Nao aparece em log
-- nem em teste que roda como administrador -- e os testes rodavam como
-- administrador.
--
-- A politica de escrita de `attendances` exigia `recepcao.operar`, que o
-- papel de medico nao tem. O mesmo vale para `rooms`, que exigia
-- `salas.administrar`, e para `fee_entries`, que exigia
-- `financeiro.registrar` -- ou seja, o medico tambem nunca conseguiu
-- gravar o proprio repasse ao finalizar uma consulta.
--
-- Por que so apareceu agora: ate a 0039, quase todo paciente chegava ao
-- consultorio pela funcao `call_next_for_room`, que roda com privilegio
-- proprio e passa por cima do RLS. A 0039 fez pericia, SISPER e ingresso
-- caírem direto em `aguardando_medico`, e esse caminho usa a gravacao
-- direta. A permissao ja faltava; a 0039 tornou o caminho o principal.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Uma permissao entre varias
--
-- Uma tabela operacional e escrita por mais de um papel: o atendimento
-- move o paciente na recepcao, a triagem move na triagem, o medico move
-- no consultorio. Uma permissao unica por tabela nao descreve isso.
-- ---------------------------------------------------------------------
create or replace function public.can_access_any(p_tenant uuid, p_perms text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from unnest(p_perms) as perm
     where public.can_access(p_tenant, perm)
  );
$$;

comment on function public.can_access_any(uuid, text[]) is
  'Verdadeiro quando o usuario tem QUALQUER uma das permissoes no tenant. Tabela operacional costuma ser escrita por mais de um papel.';

grant execute on function public.can_access_any(uuid, text[]) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Atendimento: quem opera o fluxo pode mover o paciente
--
-- Mover o paciente de etapa E a operacao. A recepcao libera para a fila,
-- a triagem encaminha, o medico chama e finaliza, o totem faz o
-- check-in. Todos escrevem nesta tabela.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.attendances;
create policy tenant_write on public.attendances for all to authenticated
  using (
    public.can_access_any(tenant_id, array[
      'recepcao.operar','totem.operar','filas.operar','triagem.preencher','medico.atender'
    ])
  )
  with check (
    public.can_access_any(tenant_id, array[
      'recepcao.operar','totem.operar','filas.operar','triagem.preencher','medico.atender'
    ])
  );


-- ---------------------------------------------------------------------
-- 3. Salas: ocupar e liberar e operacao, nao administracao
--
-- A tabela `rooms` guarda duas coisas diferentes: o CADASTRO da sala
-- (nome, tipo, ordem) e o ESTADO dela (ocupada, por quem). O estado muda
-- a cada chamada de paciente, o dia inteiro, por quem opera as filas.
--
-- O cadastro continua protegido onde as demais regras finas moram: a tela
-- de Salas e exames exige `salas.administrar` antes de gravar. O RLS aqui
-- garante o isolamento entre clinicas e a capacidade geral; nao e ele que
-- separa renomear de ocupar.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.rooms;
create policy tenant_write on public.rooms for all to authenticated
  using (
    public.can_access_any(tenant_id, array[
      'salas.administrar','filas.operar','triagem.preencher','medico.atender'
    ])
  )
  with check (
    public.can_access_any(tenant_id, array[
      'salas.administrar','filas.operar','triagem.preencher','medico.atender'
    ])
  );


-- ---------------------------------------------------------------------
-- 4. Repasse: o medico lanca o proprio, e so o proprio
--
-- Ao finalizar a consulta o sistema lanca o recebivel do medico. Isso
-- roda com o login dele, e a politica exigia `financeiro.registrar`:
-- nenhuma consulta finalizada por medico de verdade gerou lancamento.
--
-- A permissao nova nao abre o financeiro da clinica: ela deixa o medico
-- lancar uma linha cujo `profile_id` e ele mesmo. Quem cuida do
-- financeiro continua podendo tudo.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.fee_entries;
create policy tenant_write on public.fee_entries for all to authenticated
  using (
    public.can_access(tenant_id, 'financeiro.registrar')
    or (public.can_access(tenant_id, 'medico.atender') and profile_id = auth.uid())
  )
  with check (
    public.can_access(tenant_id, 'financeiro.registrar')
    or (public.can_access(tenant_id, 'medico.atender') and profile_id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 5. Tabela de procedimentos: o medico precisa ler para lancar
--
-- O valor do repasse sai daqui. Sem leitura, o lancamento falhava antes
-- mesmo de tentar gravar, com "Procedimento de repasse nao cadastrado" --
-- uma mensagem que nao chegava a lugar nenhum.
--
-- Continua sendo leitura: mexer na tabela de precos segue com o
-- financeiro.
-- ---------------------------------------------------------------------
drop policy if exists tenant_select on public.procedure_types;
create policy tenant_select on public.procedure_types for select to authenticated
  using (public.can_access_any(tenant_id, array['financeiro.ver','medico.atender']));

drop policy if exists tenant_select on public.medical_fees;
create policy tenant_select on public.medical_fees for select to authenticated
  using (
    public.can_access(tenant_id, 'financeiro.ver')
    or (public.can_access(tenant_id, 'medico.atender') and profile_id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 6. Lancamentos que se perderam
--
-- Consulta finalizada por medico de verdade nao gerou repasse. Recriar
-- esses lancamentos e conta a pagar: cada consulta assinada, com o valor
-- do medico ou o padrao do procedimento.
--
-- So consultas assinadas, so sem lancamento previo, e so quando ha
-- procedimento cadastrado. O indice unico da tabela impede duplicata se
-- este script rodar de novo.
-- ---------------------------------------------------------------------
insert into public.fee_entries
  (tenant_id, profile_id, attendance_id, patient_id, company_id, procedure_type_id,
   procedure_code, procedure_name, fee, competencia, status, notes)
select mc.tenant_id,
       mc.doctor_id,
       mc.attendance_id,
       mc.patient_id,
       a.company_id,
       pt.id,
       pt.code,
       pt.name,
       coalesce(mf.fee, pt.default_fee),
       date_trunc('month', mc.finished_at)::date,
       'a_pagar',
       'Lancamento recuperado: a consulta foi finalizada antes da correcao de permissao de 29/09.'
  from public.medical_consultations mc
  join public.attendances a on a.id = mc.attendance_id
  join public.procedure_types pt
    on pt.tenant_id = mc.tenant_id
   and pt.code = coalesce(a.procedure_code, 'consulta_ocupacional')
  left join public.medical_fees mf
    on mf.procedure_type_id = pt.id and mf.profile_id = mc.doctor_id
 where mc.finished_at is not null
   and mc.doctor_id is not null
   and coalesce(mf.fee, pt.default_fee) > 0
   and not exists (
     select 1 from public.fee_entries fe
      where fe.attendance_id = mc.attendance_id and fe.profile_id = mc.doctor_id);


do $$
declare v_recuperados int;
begin
  select count(*) into v_recuperados from public.fee_entries
   where notes like 'Lancamento recuperado%';
  raise notice 'Repasses recuperados: %', v_recuperados;
end$$;


-- ==========================================================
-- MIGRATIONS: 0042_romberg_e_do_medico.sql
-- ==========================================================

-- =====================================================================
-- 0042 - O teste de Romberg passa a ser feito na consulta
--
-- "o teste de romberg tem que mudar para ser realizado na aba medica"
--                                              -- Isabella, 28/09
--
-- O Romberg era preenchido na bancada da triagem. Vai para o medico, como
-- ja acontece com a consulta clinica e com o psicossocial.
--
-- ---------------------------------------------------------------------
-- Por que isto NAO e so trocar uma lista
-- ---------------------------------------------------------------------
-- Quais exames sao respondidos pelo medico estava escrito como
-- `et.code in ('CLINICO','PSICO')`, repetido em quatro funcoes. Essa lista
-- ja mudou duas vezes em uma semana: ganhou PSICO em 22/09 e ganharia
-- ROMBERG agora. Cada mudanca exige achar as quatro copias e acertar todas
-- -- e errar uma delas nao da erro, so deixa o paciente numa fila onde
-- ninguem vai chama-lo. Foi assim em 15/09.
--
-- Entao a lista vira uma coluna: `exam_types.respondido_pelo_medico`. As
-- funcoes passam a perguntar ao cadastro, e mudar quem responde o que deixa
-- de ser assunto de migracao.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A coluna, com o que a lista dizia
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists respondido_pelo_medico boolean not null default false;

comment on column public.exam_types.respondido_pelo_medico is
  'O medico responde este item na propria consulta. Nao ocupa sala, nao entra em fila, e marca-lo faz o paciente passar pelo consultorio.';

-- O estado de hoje, para nada mudar de comportamento nesta linha.
update public.exam_types
   set respondido_pelo_medico = true
 where code in ('CLINICO','PSICO')
   and respondido_pelo_medico is distinct from true;


-- ---------------------------------------------------------------------
-- 2. O Romberg entra
--
-- Sai das salas pelo mesmo caminho do psicossocial em 0036: sem sala
-- padrao e sem vinculo, senao a sala de triagem continuaria oferecendo
-- chamar um exame que o medico ja respondeu.
-- ---------------------------------------------------------------------
update public.exam_types
   set respondido_pelo_medico = true,
       ocupa_sala = false
 where code = 'ROMBERG';

delete from public.room_exam_types ret
 using public.exam_types et
 where et.id = ret.exam_type_id and et.code = 'ROMBERG';

update public.exam_types
   set default_room_id = null
 where code = 'ROMBERG';


-- ---------------------------------------------------------------------
-- 3. As quatro funcoes passam a ler a coluna
-- ---------------------------------------------------------------------
create or replace function public.tg_patient_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count int;
  running_count int;
  tem_consulta boolean;
  att public.attendances%rowtype;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select * into att from public.attendances where id = new.attendance_id;
  if not found then return new; end if;

  -- Paciente em triagem nao e movido pela bancada. `tg_triage_finished`
  -- decide para onde ele vai quando a ficha for finalizada.
  if att.stage_code in ('aguardando_triagem', 'em_triagem') then
    return new;
  end if;

  select
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ),
    count(*) filter (
      where coalesce(et.ocupa_sala, true)
        and pe.status in ('chamado','em_andamento')
    ),
    coalesce(bool_or(
      coalesce(et.respondido_pelo_medico, false)
        and pe.status in ('pendente','em_fila','chamado','em_andamento')
    ), false)
    into pending_count, running_count, tem_consulta
  from public.patient_exams pe
  left join public.exam_types et on et.id = pe.exam_type_id
  where pe.attendance_id = new.attendance_id;

  -- Pericia, SISPER e ingresso vao ao medico com ou sem item marcado.
  if coalesce(att.origin_kind::text, 'particular') in ('estado','sisper','ingresso') then
    tem_consulta := true;
  end if;

  if running_count > 0 then
    update public.attendances
       set stage_code = 'em_exames',
           exams_started_at = coalesce(exams_started_at, now()),
           in_service = true,
           current_room_id = new.room_id
     where id = att.id and stage_code <> 'em_exames';

  elsif pending_count = 0 then
    update public.attendances
       set stage_code = case
             when tem_consulta then 'aguardando_medico'
             else 'aguardando_pagamento'
           end,
           exams_finished_at = coalesce(exams_finished_at, now()),
           in_service = false,
           current_room_id = null
     where id = att.id and stage_code in ('em_exames','aguardando_exames');

  else
    update public.attendances
       set stage_code = case when stage_code = 'em_exames' then 'aguardando_exames' else stage_code end,
           in_service = false,
           current_room_id = null
     where id = att.id;
  end if;

  return new;
end$$;

drop trigger if exists patient_exam_progress on public.patient_exams;
create trigger patient_exam_progress after update on public.patient_exams
for each row execute function public.tg_patient_exam_progress();


create or replace function public.tg_triage_finished()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_na_fila int;
  v_tem_consulta boolean;
  v_origem text;
begin
  if new.finished_at is not null and old.finished_at is null then
    select
      count(*) filter (
        where coalesce(et.ocupa_sala, true)
          and pe.status in ('pendente','em_fila','chamado','em_andamento')),
      coalesce(bool_or(
        coalesce(et.respondido_pelo_medico, false)
          and pe.status in ('pendente','em_fila','chamado','em_andamento')), false)
      into v_na_fila, v_tem_consulta
      from public.patient_exams pe
      left join public.exam_types et on et.id = pe.exam_type_id
     where pe.attendance_id = new.attendance_id;

    select coalesce(origin_kind::text, 'particular') into v_origem
      from public.attendances where id = new.attendance_id;

    if v_origem in ('estado','sisper','ingresso') then
      v_tem_consulta := true;
    end if;

    update public.attendances
       set stage_code = case
             when v_na_fila > 0   then 'aguardando_exames'
             when v_tem_consulta  then 'aguardando_medico'
             else                      'aguardando_pagamento'
           end,
           triage_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

  elsif tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_triagem',
           triage_started_at = coalesce(triage_started_at, now()),
           in_service = true
     where id = new.attendance_id;
  end if;
  return new;
end$$;


-- Assinar a consulta fecha o que o medico respondia nela.
--
-- Vale tambem para o Romberg, e de proposito. Se o medico preencheu a
-- ficha, o exame ja esta concluido e esta linha nao faz nada. Se ele nao
-- preencheu, o item nao pode ficar pendente para sempre em um atendimento
-- ja assinado -- seria o mesmo buraco de 21/09, com o paciente marcado
-- "exames 3/4" e nenhuma sala capaz de chama-lo.
create or replace function public.tg_consultation_progress()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;

  elsif new.finished_at is not null and old.finished_at is null then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

    update public.patient_exams pe
       set status = 'concluido',
           started_at = coalesce(pe.started_at, new.started_at),
           finished_at = coalesce(pe.finished_at, new.finished_at),
           professional_id = coalesce(pe.professional_id, new.doctor_id),
           updated_by = auth.uid()
      from public.exam_types et
     where et.id = pe.exam_type_id
       and coalesce(et.respondido_pelo_medico, false)
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;
  return new;
end$$;


-- ---------------------------------------------------------------------
-- 4. Quem ja esta no meio do caminho
-- ---------------------------------------------------------------------

-- Romberg pendente em consulta ja assinada: o medico nao tinha onde
-- responder ate agora.
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and et.code = 'ROMBERG'
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');

-- Quem estava numa fila so por causa do Romberg vai ao medico. Sem isto,
-- o exame deixou de ocupar sala e o paciente ficaria esperando uma chamada
-- que nao viria de lugar nenhum.
update public.attendances a
   set stage_code = 'aguardando_medico'
 where a.stage_code in ('aguardando_exames','em_exames')
   and a.finished_at is null and a.cancelled_at is null and a.absent_at is null
   and not exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and coalesce(et.ocupa_sala, true)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'))
   and exists (
     select 1 from public.patient_exams pe
       join public.exam_types et on et.id = pe.exam_type_id
      where pe.attendance_id = a.id
        and coalesce(et.respondido_pelo_medico, false)
        and pe.status in ('pendente','em_fila','chamado','em_andamento'));

-- Quem esta esperando triagem AGORA nao e mexido aqui, de proposito.
--
-- A recepcao grava um unico `needs_triage`, sem dizer se ele veio de ela ter
-- pedido a triagem ou de um exame de bancada ter exigido. Quem esta em
-- 'aguardando_triagem' pode estar la para aferir pressao. Move-lo para o
-- medico faria o paciente pular os sinais vitais -- consertar o Romberg
-- estragando a triagem.
--
-- E nao e preciso: esse paciente passa pela triagem normalmente, o
-- `tg_triage_finished` acima ja le a coluna nova, ve o Romberg pendente e o
-- manda ao consultorio. So a bancada e que deixa de oferecer o exame.


do $$
declare v_romberg int;
begin
  select count(*) into v_romberg from public.exam_types
   where code = 'ROMBERG' and respondido_pelo_medico;
  raise notice 'Romberg respondido pelo medico: %', v_romberg;
end$$;


-- ==========================================================
-- MIGRATIONS: 0043_consulta_assinada_de_uma_vez.sql
-- ==========================================================

-- =====================================================================
-- 0043 - Assinar a consulta de uma vez so fecha tudo
--
-- Encontrado pelo simulador da clinica, no primeiro paciente que ele
-- passou pelo sistema inteiro -- e no caminho mais comum que existe.
--
-- ---------------------------------------------------------------------
-- 1. O exame de consulta ficava pendente para sempre
-- ---------------------------------------------------------------------
-- Ha dois gatilhos sobre `medical_consultations`, os dois chamando a mesma
-- funcao: um AFTER INSERT e um AFTER UPDATE. A funcao decidia assim:
--
--     if tg_op = 'INSERT' then   -> marca "em consulta"
--     elsif finished_at mudou    -> encerra, conclui os itens do medico
--
-- Quando o medico abre a consulta, preenche e clica em finalizar SEM ter
-- salvo um rascunho antes, a linha nasce JA com `finished_at`. Cai no
-- primeiro ramo, que so marca "em consulta" -- e o segundo nunca roda.
--
-- Efeito: o item "Consulta clinica ocupacional" ficava `pendente` para
-- sempre num atendimento ja encerrado. O paciente aparecia com "exames
-- 1/2" depois de ter ido embora, e nenhuma sala podia chama-lo, porque
-- esse item nao ocupa sala.
--
-- A acao da tela ja compensava metade disso: ela grava a etapa
-- 'aguardando_pagamento' por conta propria, com um comentario explicando
-- que "o gatilho do banco so avanca a etapa no UPDATE". Compensou a etapa
-- e nao os exames -- e foi por isso que o defeito seguiu invisivel.
--
-- ---------------------------------------------------------------------
-- 2. Saber se ha parecer sem poder ler a consulta
-- ---------------------------------------------------------------------
-- O kit de saida pergunta se a consulta tem parecer de aptidao antes de
-- emitir o A.S.O. Quem encerra o atendimento costuma ser a recepcao, e a
-- recepcao NAO enxerga `medical_consultations` -- a leitura exige
-- `clinico.ver`, que o papel de atendimento nao tem, e com razao.
--
-- O embed voltava vazio, o sistema concluia "nao ha parecer" e o kit
-- avisava "a consulta ainda nao tem o parecer de aptidao preenchido" --
-- culpando o medico por uma consulta que ele tinha assinado.
--
-- A resposta nao pode ser dar prontuario para a recepcao. E uma funcao que
-- responde SIM ou NAO sem devolver nada do conteudo clinico.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O gatilho passa a tratar "nasceu assinada"
-- ---------------------------------------------------------------------
create or replace function public.tg_consultation_progress()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_encerrou boolean;
begin
  -- Encerrar e: nascer ja assinada, ou passar de nao-assinada para
  -- assinada. Os dois casos precisam fechar as mesmas coisas.
  v_encerrou := (tg_op = 'INSERT' and new.finished_at is not null)
             or (tg_op = 'UPDATE' and new.finished_at is not null and old.finished_at is null);

  if tg_op = 'INSERT' and not v_encerrou then
    update public.attendances
       set stage_code = 'em_consulta',
           consultation_started_at = coalesce(consultation_started_at, now()),
           in_service = true,
           current_room_id = coalesce(new.room_id, current_room_id)
     where id = new.attendance_id;

  elsif v_encerrou then
    update public.attendances
       set stage_code = 'aguardando_documentos',
           consultation_finished_at = new.finished_at,
           in_service = false,
           current_room_id = null
     where id = new.attendance_id;

    perform public.liberar_salas_do_atendimento(new.attendance_id);

    -- Os itens que o proprio medico responde na consulta.
    update public.patient_exams pe
       set status = 'concluido',
           started_at = coalesce(pe.started_at, new.started_at, new.finished_at),
           finished_at = coalesce(pe.finished_at, new.finished_at),
           professional_id = coalesce(pe.professional_id, new.doctor_id),
           updated_by = auth.uid()
      from public.exam_types et
     where et.id = pe.exam_type_id
       and coalesce(et.respondido_pelo_medico, false)
       and pe.attendance_id = new.attendance_id
       and pe.status not in ('concluido','cancelado','nao_realizado');
  end if;

  return new;
end$$;

comment on function public.tg_consultation_progress() is
  'Move o atendimento e fecha os itens respondidos pelo medico. Trata tambem a consulta que nasce ja assinada, que e o caminho de quem preenche e finaliza sem salvar rascunho.';


-- ---------------------------------------------------------------------
-- 2. Ha parecer? Sim ou nao, sem devolver prontuario
-- ---------------------------------------------------------------------
create or replace function public.atendimento_tem_parecer(p_attendance uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.medical_consultations mc
      join public.attendances a on a.id = mc.attendance_id
     where mc.attendance_id = p_attendance
       and mc.verdict is not null
       and public.belongs_to_tenant(a.tenant_id)
  );
$$;

comment on function public.atendimento_tem_parecer(uuid) is
  'Verdadeiro quando a consulta daquele atendimento ja tem parecer de aptidao. Responde sim ou nao sem expor conteudo clinico, para que quem encerra o atendimento possa saber se o A.S.O. pode sair.';

grant execute on function public.atendimento_tem_parecer(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Conserta o que ja esta gravado
--
-- Consulta assinada com o item do medico ainda pendente: e o defeito 1
-- acima, em todo atendimento que passou por aqui desde que existe.
-- ---------------------------------------------------------------------
update public.patient_exams pe
   set status = 'concluido',
       started_at = coalesce(pe.started_at, mc.started_at, mc.finished_at),
       finished_at = coalesce(pe.finished_at, mc.finished_at),
       professional_id = coalesce(pe.professional_id, mc.doctor_id)
  from public.exam_types et, public.medical_consultations mc
 where et.id = pe.exam_type_id
   and coalesce(et.respondido_pelo_medico, false)
   and mc.attendance_id = pe.attendance_id
   and mc.finished_at is not null
   and pe.status not in ('concluido','cancelado','nao_realizado');


do $$
declare v_pendentes int;
begin
  select count(*) into v_pendentes
    from public.patient_exams pe
    join public.exam_types et on et.id = pe.exam_type_id
    join public.medical_consultations mc on mc.attendance_id = pe.attendance_id
   where coalesce(et.respondido_pelo_medico, false)
     and mc.finished_at is not null
     and pe.status not in ('concluido','cancelado','nao_realizado');
  raise notice 'Itens do medico ainda pendentes apos o conserto: %', v_pendentes;
end$$;


-- ==========================================================
-- MIGRATIONS: 0044_quem_chama_consegue_liberar.sql
-- ==========================================================

-- =====================================================================
-- 0044 - Quem pode chamar precisa poder liberar
--
-- Encontrado pela matriz de papeis do simulador, rodando cada tela com o
-- papel de quem a usa de verdade.
--
-- ---------------------------------------------------------------------
-- O que estava acontecendo
-- ---------------------------------------------------------------------
-- O papel `atendimento` tem `filas.operar`: ele opera o quadro de Filas e
-- salas, e o botao "Chamar proximo" funciona. Mas NAO tem
-- `exames.concluir` -- entao o botao de concluir o exame e recusado.
--
-- O resultado e uma armadilha: o paciente entra na sala, a sala fica
-- marcada como ocupada, e quem o chamou nao consegue solta-lo. A sala
-- segue "ocupada" com alguem que ja saiu, e o proximo paciente da fila
-- nunca e chamado.
--
-- "nao esta chamando paciente" + "Erro inesperado. Tente novamente."
--                                          -- Isabella, 29/09 11:50,
-- com um paciente esperando ha 28 horas no quadro.
--
-- Um papel que pode prender e nao pode soltar nao e uma restricao de
-- seguranca: e um jeito de perder o dia. Mover a fila e operacao, e quem
-- opera a fila precisa das duas metades.
--
-- ---------------------------------------------------------------------
-- O que NAO muda
-- ---------------------------------------------------------------------
-- `exames.preencher` continua fora: preencher a ficha do exame e ato
-- clinico, e o resultado vai para o prontuario e para o laudo. A recepcao
-- passa a poder encerrar um exame e devolver a sala; quem registra o que
-- foi medido continua sendo quem faz o exame.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

insert into public.role_permissions (role_id, permission_code)
select r.id, 'exames.concluir'
  from public.roles r
 where r.code = 'atendimento'
   and exists (select 1 from public.role_permissions rp
                where rp.role_id = r.id and rp.permission_code = 'filas.operar')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Salas presas a quem ja foi embora
--
-- Enquanto a permissao faltava, cada exame chamado e nao concluido deixou
-- a sala ocupada. Soltar so as que apontam para atendimento encerrado,
-- cancelado ou ausente: sala com paciente de verdade dentro nao se mexe.
-- ---------------------------------------------------------------------
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
  from public.attendances a
 where a.id = r.current_attendance_id
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null
        or a.stage_code in ('finalizado','cancelado','ausente'));

-- Sala apontando para um atendimento que nao existe mais.
update public.rooms r
   set status = 'disponivel', current_attendance_id = null
 where r.current_attendance_id is not null
   and not exists (select 1 from public.attendances a where a.id = r.current_attendance_id);


do $$
declare v_presas int;
begin
  select count(*) into v_presas from public.rooms where current_attendance_id is not null;
  raise notice 'Salas ainda ocupadas (com paciente de verdade dentro): %', v_presas;
end$$;


-- ==========================================================
-- MIGRATIONS: 0045_registros_que_nunca_eram_gravados.sql
-- ==========================================================

-- =====================================================================
-- 0045 - Registros que nunca chegavam a ser gravados
--
-- Encontrados por uma auditoria independente das politicas de RLS cruzadas
-- com os papeis do seed. Os tres achados tem a mesma forma: a acao exige
-- uma permissao, passa, e depois grava numa tabela que exige OUTRA -- e o
-- resultado da gravacao nunca e conferido.
--
-- INSERT barrado pelo RLS levanta erro. Mas quando o erro nao e lido, ele
-- some dentro de um `catch` que so escreve no console do servidor. Para
-- quem usa o sistema, a acao deu certo.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A trilha de acesso a prontuario (LGPD) estava vazia desde sempre
--
-- `clinical_access_logs` exige `logs.ver` para LER e para ESCREVER. Ler e
-- certo: essa trilha e material de auditoria. Escrever, nao -- quem escreve
-- e justamente quem abriu o prontuario, e nenhum papel clinico tem
-- `logs.ver`. Entao toda gravacao era barrada.
--
-- O efeito e o pior possivel para o que a tabela existe: ela nao registrou
-- nenhum acesso, e e ela que responde "quem abriu o prontuario deste
-- paciente" quando o titular pergunta.
--
-- A resposta nao e dar `logs.ver` a todo mundo -- isso deixaria qualquer um
-- LER a trilha. E uma funcao que so sabe ESCREVER, e que grava sempre em
-- nome de quem esta logado.
-- ---------------------------------------------------------------------
create or replace function public.registrar_acesso_clinico(
  p_tenant uuid,
  p_patient uuid,
  p_context text,
  p_reference uuid default null,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem sessao nao ha acesso a registrar.
  if auth.uid() is null then return; end if;

  -- So registra acesso dentro da propria clinica: a funcao passa por cima
  -- do RLS, entao a checagem de tenant precisa estar escrita aqui.
  if not public.belongs_to_tenant(p_tenant) then return; end if;

  -- `ip_address` e do tipo `inet`, e o endereco chega como texto vindo do
  -- cabecalho `x-forwarded-for`. O cast e explicito porque o Postgres nao
  -- converte texto para inet sozinho neste contexto -- e um endereco mal
  -- formado nao pode derrubar o registro do acesso, que e o que importa
  -- aqui: por isso a conversao acontece dentro de um bloco que, falhando,
  -- grava o acesso sem o IP.
  begin
    insert into public.clinical_access_logs
      (tenant_id, user_id, patient_id, context, reference_id, ip_address, user_agent)
    values (p_tenant, auth.uid(), p_patient, p_context, p_reference,
            nullif(trim(coalesce(p_ip, '')), '')::inet, p_user_agent);
  exception when others then
    insert into public.clinical_access_logs
      (tenant_id, user_id, patient_id, context, reference_id, ip_address, user_agent)
    values (p_tenant, auth.uid(), p_patient, p_context, p_reference, null, p_user_agent);
  end;
end$$;

comment on function public.registrar_acesso_clinico(uuid, uuid, text, uuid, text, text) is
  'Grava um acesso a dado clinico em nome de quem esta logado. Escreve sem poder ler: a trilha continua visivel so para quem tem logs.ver.';

grant execute on function public.registrar_acesso_clinico(uuid, uuid, text, uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. O consentimento LGPD se perdia quando quem emitia o termo era o medico
--
-- `patient_consents` exige `pacientes.editar` para gravar. Quem emite o
-- termo de autorizacao tem `documentos.emitir` -- o medico tem uma e nao a
-- outra. Pela recepcao funcionava, o que escondia o defeito: o termo saia,
-- a assinatura era gravada, e o registro de consentimento -- o que se
-- procura quando o titular pergunta o que autorizou -- nao existia.
--
-- Emitir o termo E o ato que cria o consentimento. Quem pode emitir precisa
-- poder registrar.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.patient_consents;
create policy tenant_write on public.patient_consents for all to authenticated
  using (
    public.can_access_any(tenant_id, array['pacientes.editar','documentos.emitir'])
  )
  with check (
    public.can_access_any(tenant_id, array['pacientes.editar','documentos.emitir'])
  );


-- ---------------------------------------------------------------------
-- 3. Anexos de exame: nenhum papel conseguia anexar E ver
--
-- `patient_attachments` exige `clinico.ver` para ler e `exames.preencher`
-- para gravar. A acao exigia `pacientes.editar`, que e de outro eixo:
--
--   - `atendimento` tem `pacientes.editar`, passa na acao, e entao NAO
--     consegue gravar nem enxergar o que anexou. O upload subia para o
--     balde e o registro nao entrava: arquivo orfao;
--   - `medico_examinador` tem `clinico.ver` e `exames.preencher`, ou seja,
--     tudo que o RLS pede -- e era barrado na porta, pela acao.
--
-- Anexar resultado de exame e ato clinico. A acao passa a exigir
-- `exames.preencher`, que e o que o RLS ja exigia, e os dois lados voltam a
-- falar a mesma lingua. Nada muda aqui no banco; o conserto e na aplicacao,
-- e esta anotado para quem for ler esta migration procurando o par.
-- ---------------------------------------------------------------------


do $$
declare v_logs int;
begin
  select count(*) into v_logs from public.clinical_access_logs;
  raise notice 'Acessos clinicos registrados ate agora: % (esperado zero antes desta correcao)', v_logs;
end$$;


-- ==========================================================
-- MIGRATIONS: 0046_sala_do_exame_e_etapa_do_caixa.sql
-- ==========================================================

-- =====================================================================
-- 0046 - A sala atribuida a mao, a etapa do caixa e quem sai do terminal
--
-- Tres achados da varredura de 52 rotas e da auditoria da maquina de
-- estados. Os tres sao alcancaveis pela tela, hoje.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. "Enviar exame para a sala X" gravava e nao fazia nada
--
-- `atribuirSalaAoExame` escreve `patient_exams.room_id`. E
-- `call_next_for_room` NUNCA leu essa coluna: ela decide quem pode ser
-- chamado por `room_exam_types` ou por `exam_types.default_room_id`, e so.
--
-- Ou seja: o botao existia para resgatar um exame que ficou sem sala --
-- diz isso no proprio comentario dele -- e a sala escolhida continuava sem
-- conseguir chamar o paciente. O exame seguia pendente para sempre.
--
-- Por que nao basta aceitar `pe.room_id = p_room`:
--
--   Os exames nascem com `room_id` copiado da sala padrao do tipo. Se a
--   clinica trocar a sala padrao depois -- que e o que a tela de Salas e
--   exames faz --, os exames ja pedidos continuam carregando a sala
--   ANTIGA. Aceitar `pe.room_id` sem distinguir faria a sala antiga voltar
--   a chamar, que foi exatamente o defeito da dinamometria em 21/09.
--
-- Entao a atribuicao manual passa a ser explicita: uma coluna que diz
-- "alguem escolheu esta sala para ESTE exame". Copia de padrao nao marca.
-- ---------------------------------------------------------------------
alter table public.patient_exams
  add column if not exists sala_escolhida_a_mao boolean not null default false;

comment on column public.patient_exams.sala_escolhida_a_mao is
  'Verdadeiro quando alguem enviou este exame para uma sala especifica pela tela de Filas. Distingue a escolha manual da copia da sala padrao, que fica desatualizada quando a clinica remaneja o equipamento.';


create or replace function public.call_next_for_room(p_tenant uuid, p_room uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_exam public.patient_exams%rowtype;
  v_ticket public.queue_tickets%rowtype;
  v_room public.rooms%rowtype;
  v_patient_name text;
  v_quantos int;
begin
  if not public.can_access(p_tenant, 'filas.operar') then
    raise exception 'Sem permissao para operar filas' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room and tenant_id = p_tenant;
  if not found then raise exception 'Sala nao encontrada' using errcode = 'P0002'; end if;

  select pe.* into v_exam
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
    join public.exam_types et on et.id = pe.exam_type_id
   where pe.tenant_id = p_tenant
     and pe.status in ('pendente','em_fila')
     and et.ocupa_sala
     and a.finished_at is null and a.cancelled_at is null
     and a.stage_code in ('aguardando_exames','em_exames')
     and a.in_service = false
     and (
       -- Escolha manual para ESTE exame ganha de tudo.
       (pe.sala_escolhida_a_mao and pe.room_id = p_room)
       or exists (select 1 from public.room_exam_types ret
                   where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or et.default_room_id = p_room
     )
     and not exists (
       select 1 from public.patient_exams x
         join public.exam_types xt on xt.id = x.exam_type_id
        where x.attendance_id = pe.attendance_id
          and x.status in ('chamado','em_andamento')
          and xt.ocupa_sala)
   order by
     case pe.priority when 'prioritario' then 0 when 'encaixe' then 1 else 2 end,
     coalesce(pe.queued_at, a.checkin_at) asc
   limit 1
   for update of pe skip locked;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Chama TODOS os exames deste paciente que esta sala atende, de uma vez.
  update public.patient_exams pe
     set status = 'chamado', called_at = now(), room_id = p_room, updated_by = auth.uid()
    from public.exam_types et
   where et.id = pe.exam_type_id
     and pe.attendance_id = v_exam.attendance_id
     and pe.status in ('pendente','em_fila')
     and et.ocupa_sala
     and (
       (pe.sala_escolhida_a_mao and pe.room_id = p_room)
       or exists (select 1 from public.room_exam_types ret
                   where ret.room_id = p_room and ret.exam_type_id = pe.exam_type_id)
       or et.default_room_id = p_room
     );

  get diagnostics v_quantos = row_count;

  select * into v_exam from public.patient_exams where id = v_exam.id;

  update public.rooms
     set status = 'ocupada', current_attendance_id = v_exam.attendance_id
   where id = p_room;

  select qt.* into v_ticket
    from public.queue_tickets qt
   where qt.attendance_id = v_exam.attendance_id
   limit 1;

  select coalesce(p.social_name, p.full_name) into v_patient_name
    from public.patients p
   where p.id = v_exam.patient_id;

  insert into public.queue_events (tenant_id, ticket_id, attendance_id, room_id, exam_id, event, destination, called_by)
  values (p_tenant, v_ticket.id, v_exam.attendance_id, p_room, v_exam.id, 'chamada', 'sala', auth.uid());

  insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
  values (p_tenant, coalesce(v_ticket.code, '---'),
          split_part(coalesce(v_patient_name,''), ' ', 1),
          v_room.name,
          case
            when v_room.kind in ('recepcao', 'guiche') then 'recepcao'
            when v_room.kind = 'triagem'               then 'triagem'
            else 'sala'
          end,
          v_exam.priority);

  return jsonb_build_object(
    'found', true,
    'exam', to_jsonb(v_exam),
    'ticket', to_jsonb(v_ticket),
    'exames_chamados', v_quantos);
end$$;


-- ---------------------------------------------------------------------
-- 2. O caixa nao existia no catalogo de etapas
--
-- `aguardando_pagamento` e gravada por sete pontos do sistema e NAO estava
-- entre as etapas cadastradas. Consequencias, todas reais:
--
--   - `move_attendance_stage` recusa a etapa com "Estagio invalido":
--     ninguem consegue devolver um paciente ao caixa pelo CRM;
--   - o CRM monta as colunas a partir do catalogo, entao quem esta no
--     caixa NAO TEM COLUNA e nao pode ser arrastado de la;
--   - o grafico "por etapa" do painel monta as fatias do catalogo: quem
--     esta no caixa sumia do grafico, e as fatias nao somavam o total.
-- ---------------------------------------------------------------------
insert into public.crm_stages (tenant_id, code, name, color, sort_order, is_terminal)
select t.id, 'aguardando_pagamento', 'Aguardando pagamento', '#F59E0B', 105, false
  from public.tenants t
 where not exists (
   select 1 from public.crm_stages s
    where s.tenant_id = t.id and s.code = 'aguardando_pagamento')
on conflict (tenant_id, code) do nothing;

-- A ordem: entre "aguardando documentos" (11) e "finalizado" (12). Como os
-- numeros ja estao ocupados, o caixa entra depois dos exames e antes dos
-- documentos, que e a ordem da esteira.
update public.crm_stages
   set sort_order = 105
 where code = 'aguardando_pagamento' and sort_order is distinct from 105;


-- ---------------------------------------------------------------------
-- 3. Sair de uma etapa terminal deixava a data de encerramento para tras
--
-- `move_attendance_stage` limpa `in_service` e `current_room_id` ao ENTRAR
-- numa etapa terminal, e nunca limpava `finished_at`, `cancelled_at` ou
-- `absent_at` ao SAIR dela.
--
-- Trazer um cartao de Finalizado de volta ao fluxo deixava `finished_at`
-- preenchido -- e recepcao, triagem, modulo medico e pagamentos TODOS
-- filtram por `finished_at is null`. O paciente voltava para uma etapa
-- ativa e ficava invisivel nas quatro telas.
--
-- Havia compensacao na aplicacao (`limparEstadoTerminal`), mas a RPC pode
-- ser chamada direto, e a garantia precisa estar onde a etapa muda.
-- ---------------------------------------------------------------------
-- Mesma assinatura e mesmo retorno da versao de 0033, de proposito: a
-- unica mudanca e limpar as datas de encerramento ao SAIR de uma etapa
-- terminal. Reescrever o resto perderia o `app.manual_move`, o registro do
-- motivo em `notes` e a checagem de etapa ativa.
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_terminal boolean;
begin
  select tenant_id into v_tenant from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  v_terminal := p_stage in ('finalizado','cancelado','ausente');

  perform set_config('app.manual_move', 'on', true);
  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         -- Entrando numa etapa terminal, marca a data. SAINDO de uma,
         -- limpa as tres -- e esta e a linha nova.
         --
         -- Trazer um cartao de Finalizado de volta ao fluxo deixava
         -- `finished_at` preenchido, e recepcao, triagem, modulo medico e
         -- pagamentos TODOS filtram por `finished_at is null`: o paciente
         -- voltava para uma etapa ativa e ficava invisivel nas quatro.
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now())
                            when v_terminal then finished_at else null end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now())
                             when v_terminal then cancelled_at else null end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now())
                          when v_terminal then absent_at else null end,
         exit_at = case when p_stage = 'finalizado' then coalesce(exit_at, now())
                        when v_terminal then exit_at else null end,
         in_service = case when v_terminal then false else in_service end,
         current_room_id = case when v_terminal then null else current_room_id end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);

  if v_terminal then
    perform public.liberar_salas_do_atendimento(p_attendance);

    -- Exame de quem foi embora nao e exame pendente. Sem isto ele fica na
    -- contagem de pendencias da clinica para sempre.
    if p_stage in ('cancelado','ausente') then
      update public.patient_exams
         set status = 'cancelado', updated_by = auth.uid()
       where attendance_id = p_attendance
         and status in ('pendente','em_fila','chamado','em_andamento');
    end if;
  end if;
end$$;

comment on function public.move_attendance_stage(uuid, text, text) is
  'Move o atendimento de etapa. Ao ENTRAR numa etapa terminal solta paciente, sala e exames; ao SAIR de uma, limpa as datas de encerramento -- senao o paciente volta ao fluxo invisivel para as telas, que filtram por atendimento em aberto.';

grant execute on function public.move_attendance_stage(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Conserta o que ja esta gravado
-- ---------------------------------------------------------------------

-- Atendimento em etapa ativa com data de encerramento pendurada.
update public.attendances a
   set finished_at = null, cancelled_at = null, absent_at = null, exit_at = null
  from public.crm_stages s
 where s.tenant_id = a.tenant_id and s.code = a.stage_code
   and not coalesce(s.is_terminal, false)
   and a.stage_code <> 'aguardando_pagamento'
   and (a.finished_at is not null or a.cancelled_at is not null or a.absent_at is not null);


do $$
declare v_caixa int; v_soltos int;
begin
  select count(*) into v_caixa from public.crm_stages where code = 'aguardando_pagamento';
  select count(*) into v_soltos from public.patient_exams where sala_escolhida_a_mao;
  raise notice 'Etapa do caixa cadastrada em % clinica(s); exames com sala escolhida a mao: %', v_caixa, v_soltos;
end$$;


-- ==========================================================
-- MIGRATIONS: 0047_valor_da_consulta_e_repasses_perdidos.sql
-- ==========================================================

-- =====================================================================
-- 0047 - A consulta ocupacional ganha valor, e os repasses perdidos voltam
--
-- ---------------------------------------------------------------------
-- O contexto
-- ---------------------------------------------------------------------
-- A "Consulta ocupacional" estava com R$ 0,00 no catalogo de procedimentos
-- -- "os itens em zero aguardam o valor que ainda nao foi informado", diz o
-- proprio catalogo. Como ela e o procedimento de quase TODO atendimento, o
-- repasse de todos os medicos saia zerado.
--
-- Pior: o zero tambem impedia o conserto. A recuperacao de lancamentos da
-- 0041 so recria o que tem valor maior que zero, entao ela passou por cima
-- de todas as consultas ocupacionais ja assinadas.
--
-- E havia um segundo motivo, corrigido no codigo junto com esta migration:
-- `lancarRepasse` pedia `attendances.doctor_id`, coluna que so existe em
-- `medical_consultations`. O banco recusava a consulta inteira, o erro nao
-- era lido, e NENHUM repasse foi lancado desde que o sistema existe.
--
-- ---------------------------------------------------------------------
-- R$ 100,00 e um valor de PARTIDA
-- ---------------------------------------------------------------------
-- Nao e a tabela da clinica: e um numero para o sistema parar de contar
-- zero enquanto a clinica define o dela. Ajustavel em Financeiro >
-- Repasse, e o valor por medico (Usuarios > Repasse) continua ganhando
-- deste.
--
-- Por isso o update abaixo so toca em quem esta em ZERO: se alguem ja
-- informou um valor, ele fica.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

update public.procedure_types
   set default_fee = 100
 where code = 'consulta_ocupacional'
   and coalesce(default_fee, 0) = 0;


-- ---------------------------------------------------------------------
-- Os lancamentos que nunca nasceram
--
-- Toda consulta assinada por um medico, sem lancamento de repasse. Agora
-- com valor, a recuperacao da 0041 finalmente alcanca as consultas
-- ocupacionais.
--
-- Sao contas a pagar de verdade: o medico atendeu e o sistema nao
-- registrou. Ficam marcadas na observacao, para a clinica saber de onde
-- vieram ao conferir o mes.
-- ---------------------------------------------------------------------
insert into public.fee_entries
  (tenant_id, profile_id, attendance_id, patient_id, company_id, procedure_type_id,
   procedure_code, procedure_name, fee, competencia, status, notes)
select mc.tenant_id,
       mc.doctor_id,
       mc.attendance_id,
       mc.patient_id,
       a.company_id,
       pt.id,
       pt.code,
       pt.name,
       coalesce(mf.fee, pt.default_fee),
       -- Mesma competencia que a aplicacao usa: o mes de ABERTURA do
       -- atendimento, em Sao Paulo. Usar outra regra aqui faria os
       -- lancamentos recuperados cairem em meses diferentes dos novos.
       date_trunc(
         'month',
         (a.checkin_at at time zone 'America/Sao_Paulo')
       )::date,
       'a_pagar',
       'Lancamento recuperado: a consulta foi assinada antes da correcao de 30/09.'
  from public.medical_consultations mc
  join public.attendances a on a.id = mc.attendance_id
  join public.procedure_types pt
    on pt.tenant_id = mc.tenant_id
   and pt.code = coalesce(a.procedure_code, 'consulta_ocupacional')
  left join public.medical_fees mf
    on mf.procedure_type_id = pt.id and mf.profile_id = mc.doctor_id
 where mc.finished_at is not null
   and mc.doctor_id is not null
   and coalesce(mf.fee, pt.default_fee) > 0
   -- O indice unico da tabela e por (atendimento, procedimento); a
   -- checagem segue o mesmo par, senao o insert aborta em vez de pular.
   and not exists (
     select 1 from public.fee_entries fe
      where fe.attendance_id = mc.attendance_id
        and fe.procedure_code = pt.code);


do $$
declare v_valor numeric; v_recuperados int; v_total int;
begin
  select default_fee into v_valor from public.procedure_types
   where code = 'consulta_ocupacional' limit 1;
  select count(*) into v_recuperados from public.fee_entries
   where notes like 'Lancamento recuperado%';
  select count(*) into v_total from public.fee_entries;
  raise notice 'Consulta ocupacional: R$ %; repasses recuperados: %; total de lancamentos: %',
    v_valor, v_recuperados, v_total;
end$$;


-- ==========================================================
-- MIGRATIONS: 0048_portal_do_paciente_sem_forca_bruta.sql
-- ==========================================================

-- =====================================================================
-- 0048 - O portal do paciente para de entregar o prontuario
--
-- ---------------------------------------------------------------------
-- O que a auditoria encontrou
-- ---------------------------------------------------------------------
-- O portal (`/meu`) autentica com CPF + data de nascimento. Sem senha,
-- sem token, sem limite de tentativas.
--
-- No Brasil o CPF nao e segredo. Sobra adivinhar a data de nascimento:
-- uma janela de trinta anos sao ~11 mil tentativas, e nada no sistema
-- contava tentativa nenhuma.
--
-- E o que se alcancava depois de entrar era tudo: todo gerador de
-- documento gravava `is_patient_visible = true` fixo, entao a ficha
-- clinica (pressao, IMC, glicemia, antecedentes, estilo de vida) e a
-- avaliacao psicossocial vinham em PDF junto com o recibo.
--
-- Pior detalhe: CPF e data de nascimento sao os dois campos impressos no
-- A.S.O. que a clinica entrega ao RH da empresa. Quem recebia aquele
-- papel tinha, em maos, a credencial do portal.
--
-- Esta migration faz as duas metades do banco. A outra metade esta no
-- codigo: cada gerador passou a decidir a visibilidade por tipo de
-- documento (`src/modules/documents/visivel-ao-paciente.ts`).
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Documento clinico sai do portal — inclusive o que ja foi emitido
--
-- Retroativo de proposito: o estrago nao esta nos documentos de amanha,
-- esta nos que ja estao gravados com `true`.
--
-- A lista de tipos que FICAM e a mesma do codigo. Todos sao papel de
-- balcao: comprovam presenca, pagamento, agendamento, ou devolvem ao
-- paciente algo que ele proprio assinou.
-- ---------------------------------------------------------------------
update public.documents
   set is_patient_visible = false
 where is_patient_visible = true
   and kind::text not in (
     'recibo',
     'comprovante_comparecimento',
     'atestado_comparecimento',
     'comprovante_agendamento',
     'comprovante_compra',
     'resumo_pedido',
     'guia_exame',
     'autorizacao_envio_resultados'
   );


-- ---------------------------------------------------------------------
-- 2. Trava de tentativas
--
-- Guarda a tentativa, nao a credencial: o CPF entra como digest SHA-256,
-- que serve para contar tentativas do mesmo CPF e nao serve para montar
-- lista de CPF nenhum. A data de nascimento nao e guardada.
--
-- A contagem e por CPF porque e assim que o ataque acontece: mesmo CPF,
-- muitas datas.
-- ---------------------------------------------------------------------
create table if not exists public.portal_login_attempts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  cpf_digest  text not null,
  succeeded   boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists portal_login_attempts_janela
  on public.portal_login_attempts (tenant_id, cpf_digest, attempted_at desc);

alter table public.portal_login_attempts enable row level security;
alter table public.portal_login_attempts force row level security;

-- Ninguem le esta tabela pela API: ela existe para a funcao abaixo, que e
-- SECURITY DEFINER. Sem policy de select, `anon` e `authenticated` nao
-- alcancam o historico de tentativas.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'portal_login_attempts'
       and policyname = 'portal_attempts_admin_read'
  ) then
    create policy portal_attempts_admin_read
      on public.portal_login_attempts
      for select
      using (public.can_access(tenant_id, 'usuarios.administrar'));
  end if;
end$$;


-- ---------------------------------------------------------------------
-- Conta a tentativa e diz se ainda pode tentar.
--
-- Cinco falhas em quinze minutos fecham a porta para aquele CPF. Acerto
-- limpa o historico — quem entrou nao esta atacando ninguem.
--
-- Registra ANTES de responder, para que a propria chamada bloqueada
-- conte: senao bastaria insistir para nunca passar do quinto.
-- ---------------------------------------------------------------------
create or replace function public.portal_registrar_tentativa(
  p_tenant uuid,
  p_cpf    text,
  p_ok     boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digest text;
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  v_digest := encode(digest(p_cpf, 'sha256'), 'hex');

  if p_ok then
    -- Entrou: o contador dele zera.
    delete from public.portal_login_attempts
     where tenant_id = p_tenant and cpf_digest = v_digest;
    insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
    values (p_tenant, v_digest, true);
    return true;
  end if;

  insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
  values (p_tenant, v_digest, false);

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = v_digest
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_registrar_tentativa(uuid, text, boolean) is
  'Conta tentativa de acesso ao portal do paciente e devolve false quando o CPF passou de cinco falhas em quinze minutos.';


-- ---------------------------------------------------------------------
-- Diz se aquele CPF esta cumprindo trava, sem contar tentativa nova.
--
-- Chamada ANTES de conferir CPF e nascimento: bloqueado nao chega ao
-- banco de pacientes.
-- ---------------------------------------------------------------------
create or replace function public.portal_pode_tentar(
  p_tenant uuid,
  p_cpf    text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = encode(digest(p_cpf, 'sha256'), 'hex')
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_pode_tentar(uuid, text) is
  'Consulta a trava do portal do paciente sem registrar tentativa.';


-- ---------------------------------------------------------------------
-- 3. /verificar passa a olhar a clinica
--
-- A pagina publica de verificacao consultava `documents` so pelo codigo,
-- com a chave de servico e sem filtro de tenant: o codigo de OUTRA
-- clinica era apresentado como documento autentico sob o nome desta. A
-- correcao esta no codigo (`src/app/verificar/page.tsx`); o indice abaixo
-- so faz a consulta com os dois campos ficar barata.
-- ---------------------------------------------------------------------
create index if not exists documents_verificacao_por_clinica
  on public.documents (tenant_id, verification_code)
  where verification_code is not null;


do $$
declare v_fechados int; v_abertos int;
begin
  select count(*) into v_fechados from public.documents where is_patient_visible = false;
  select count(*) into v_abertos  from public.documents where is_patient_visible = true;
  raise notice 'Portal do paciente: % documentos fora do portal, % mantidos (administrativos).',
    v_fechados, v_abertos;
end$$;


-- ==========================================================
-- MIGRATIONS: 0049_senha_do_dia_sem_colisao.sql
-- ==========================================================

-- =====================================================================
-- 0049 - Dois totens ao mesmo tempo param de perder o check-in
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- `next_ticket_sequence` fazia:
--
--     select coalesce(max(sequence), 0) + 1 from queue_tickets where ...
--
-- Sem lock. Dois check-ins no mesmo instante — dois totens, ou totem e
-- recepcao juntos — leem o mesmo `max` e devolvem a MESMA senha. A tabela
-- tem `unique (tenant_id, service_date, prefix, sequence)`, entao o
-- segundo insert viola a unica DENTRO de `checkin_patient`.
--
-- E como a excecao nao era tratada, a transacao inteira voltava atras: o
-- atendimento que acabara de ser criado desaparecia junto com a senha. O
-- paciente ve "erro" no totem e volta para a fila do balcao. Nas manhas de
-- movimento, que e quando dois totens sao usados ao mesmo tempo, e
-- exatamente quando falha.
--
-- ---------------------------------------------------------------------
-- A correcao: lock consultivo por fila do dia
-- ---------------------------------------------------------------------
-- `pg_advisory_xact_lock` serializa apenas quem esta tirando senha da
-- MESMA fila do MESMO dia da MESMA clinica. Quem tira senha de outra fila
-- nao espera nada, e o lock cai sozinho no fim da transacao — nao ha o que
-- vazar se algo falhar no meio.
--
-- Nao virou `sequence` do Postgres porque a numeracao reinicia todo dia e
-- e por prefixo: seriam N sequences por dia, criadas em tempo de execucao.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

create or replace function public.next_ticket_sequence(p_tenant uuid, p_date date, p_prefix text)
returns int
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare nxt int;
begin
  -- Uma chave por (clinica, dia, prefixo). `hashtextextended` devolve
  -- bigint, que e o que a versao de um argumento do lock aceita.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|' || p_date::text || '|' || coalesce(p_prefix, ''), 0)
  );

  select coalesce(max(sequence), 0) + 1 into nxt
  from public.queue_tickets
  where tenant_id = p_tenant and service_date = p_date and prefix = p_prefix;

  return nxt;
end$$;

comment on function public.next_ticket_sequence(uuid, date, text) is
  'Proxima senha do dia para a fila. Serializa por (clinica, dia, prefixo) com lock consultivo: dois totens simultaneos nao tiram a mesma senha.';


-- ---------------------------------------------------------------------
-- Por que o lock basta, e nao ha retry
-- ---------------------------------------------------------------------
-- `checkin_patient` e a UNICA coisa em todo o sistema que insere senha
-- (verificado: um `insert into queue_tickets` no repo, na 0013). Ela roda
-- como uma chamada, logo uma transacao.
--
-- Com o lock tomado dentro de `next_ticket_sequence` e mantido ate o fim
-- da transacao, o segundo check-in espera o primeiro COMMITAR antes de
-- calcular o `max` — e ai ja ve a senha do primeiro. A colisao nao
-- acontece, entao nao ha o que repetir.
--
-- Escrever um retry aqui seria codigo que nunca executa. Se algum dia
-- outro caminho passar a inserir senha, ele tem de chamar esta funcao.
-- ---------------------------------------------------------------------


-- ==========================================================
-- MIGRATIONS: 0050_uma_cobranca_por_atendimento_na_recepcao.sql
-- ==========================================================

-- =====================================================================
-- 0050 - Duas recepcionistas param de cobrar o mesmo atendimento duas vezes
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- `gerarCobrancaRecepcao` evita cobranca dupla LENDO antes de escrever:
-- procura uma cobranca pendente do atendimento e reaproveita. Leitura
-- seguida de escrita, sem trava nenhuma.
--
-- Duas recepcionistas na mesma ficha — ou dois cliques rapidos no mesmo
-- botao — leem "nao existe" ao mesmo tempo e as duas inserem. O atendimento
-- fica com dois Pix abertos, e a receita aparece DOBRADA no fluxo de caixa,
-- no relatorio do contador e no painel.
--
-- `payments` nao tinha nenhum indice unico. O de-dupe existia so em codigo,
-- e codigo nao resolve corrida.
--
-- ---------------------------------------------------------------------
-- Por que o indice e parcial, e nao em (tenant_id, attendance_id)
-- ---------------------------------------------------------------------
-- Uma cobranca unica por atendimento seria errado: a tela de Financeiro
-- deixa a clinica lancar uma cobranca a mais no mesmo atendimento de
-- proposito (exame incluido depois, acerto de diferenca), e um indice
-- amplo passaria a recusar isso com erro de banco.
--
-- Entao o indice cobre exatamente o que a corrida produz: a cobranca que a
-- RECEPCAO gera (`provider = 'pix_manual'`), enquanto esta em aberto. Duas
-- dessas ao mesmo tempo nunca sao intencionais — o proprio codigo cancela
-- a anterior quando o valor muda. Cobranca paga, cancelada ou estornada sai
-- do indice, e a recepcao pode gerar a proxima.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Antes do indice, limpar o que a corrida ja deixou: cobrancas abertas
-- repetidas do mesmo atendimento. Fica a mais antiga (e a que tem o Pix
-- que o paciente pode ter recebido); as outras sao canceladas.
--
-- Sem esta limpeza a criacao do indice falharia em qualquer banco que ja
-- tenha sofrido o defeito.
--
-- `payment_transactions` NAO recebe linha aqui, e e de proposito: estas
-- cobrancas nunca existiram como cobranca de verdade — sao o mesmo valor
-- lancado duas vezes pela corrida entre duas telas. Registrar um
-- "cancelamento" de cada uma no livro sugeriria movimento que nao houve. A
-- procedencia delas esta neste arquivo, e a `raise notice` do fim diz
-- quantas foram.
-- ---------------------------------------------------------------------
with repetidas as (
  select id,
         row_number() over (
           partition by tenant_id, attendance_id
           order by created_at
         ) as ordem
    from public.payments
   where attendance_id is not null
     and provider = 'pix_manual'
     and status in ('pendente', 'em_analise')
     and deleted_at is null
)
update public.payments p
   set status = 'cancelado',
       cancelled_at = now()
  from repetidas r
 where p.id = r.id
   and r.ordem > 1;

create unique index if not exists uq_cobranca_aberta_da_recepcao
  on public.payments (tenant_id, attendance_id)
  where attendance_id is not null
    and provider = 'pix_manual'
    and status in ('pendente', 'em_analise')
    and deleted_at is null;

comment on index public.uq_cobranca_aberta_da_recepcao is
  'Uma cobranca da recepcao em aberto por atendimento. Impede a cobranca dupla quando duas telas geram ao mesmo tempo.';


do $$
declare v_canceladas int;
begin
  select count(*) into v_canceladas
    from public.payments
   where cancelled_at is not null and provider = 'pix_manual';
  raise notice 'Cobrancas da recepcao canceladas (inclui as duplicadas recolhidas agora): %', v_canceladas;
end$$;


-- ==========================================================
-- MIGRATIONS: 0051_reabrir_atendimento_devolve_os_exames.sql
-- ==========================================================

-- =====================================================================
-- 0051 - Reabrir um atendimento cancelado devolve os exames dele
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- A 0046 fez as duas metades do terminal quase inteiras:
--
--   ENTRANDO em cancelado/ausente -> cancela os `patient_exams` abertos
--                                    (certo: exame de quem foi embora nao
--                                    e pendencia da clinica)
--   SAINDO de uma etapa terminal  -> limpa `finished_at`, `cancelled_at`,
--                                    `absent_at`, `exit_at`, solta sala e
--                                    `in_service`
--
-- Faltou justamente o par do cancelamento dos exames. Cancelar um paciente
-- por engano e arrasta-lo de volta para "aguardando exames" no CRM devolvia
-- um atendimento com ZERO exames: o cartao mostra 0/0, ele nao aparece em
-- sala nenhuma, e a lista do que ele veio fazer foi perdida.
--
-- E nada mais o move: o unico gatilho que avanca de `aguardando_exames`
-- reage a mudanca de status de `patient_exams`, e nao ha exame nenhum para
-- mudar de status. O paciente fica parado ali, invisivel em filas, triagem,
-- medico e pagamentos — visivel so no CRM, e so hoje.
--
-- ---------------------------------------------------------------------
-- Por que da para reverter com seguranca
-- ---------------------------------------------------------------------
-- O cancelamento em massa da 0046 e cirurgico: marca `cancelado` apenas nos
-- exames que estavam abertos (`pendente`, `em_fila`, `chamado`,
-- `em_andamento`). Exame ja concluido, ja recusado ou cancelado a mao antes
-- disso nao e tocado.
--
-- Mas ao reabrir nao se sabe quais dos cancelados foram cancelados pelo
-- terminal e quais foram cancelados a mao pela clinica. Por isso a 0046
-- passa a MARCAR: grava em `notes` de quem ela cancelou. Os exames voltam
-- como `pendente`, que e onde o `checkin_patient` os coloca — a fila os
-- reparte de novo pela sala de sempre.
--
-- Cancelamento a mao, sem a marca, continua cancelado. E o que a clinica
-- decidiu, e reabrir o atendimento nao desfaz decisao de ninguem.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A marca. Coluna propria em vez de texto dentro de `notes`: `notes` e
-- campo que a clinica le e escreve, e condicionar comportamento a uma
-- frase dentro dele quebraria no dia em que alguem apagasse a frase.
-- ---------------------------------------------------------------------
alter table public.patient_exams
  add column if not exists cancelado_pelo_encerramento boolean not null default false;

comment on column public.patient_exams.cancelado_pelo_encerramento is
  'Verdadeiro quando o exame foi cancelado porque o ATENDIMENTO foi cancelado ou o paciente faltou -- nao por decisao sobre o exame. Reabrir o atendimento devolve so estes a fila.';


-- Mesma assinatura, mesmos errcodes e mesma regra de terminal da 0046, de
-- proposito: a aplicacao trata P0002, 42501 e 22023 pelo codigo, e
-- `v_terminal` e a lista fixa das tres etapas — nao a coluna `is_terminal`,
-- que a clinica pode marcar em outra etapa. A unica mudanca e o `elsif` no
-- fim, que devolve os exames na reabertura.
create or replace function public.move_attendance_stage(
  p_attendance uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_terminal boolean;
  v_etapa_atual text;
  v_era_terminal boolean;
begin
  select tenant_id, stage_code into v_tenant, v_etapa_atual
    from public.attendances where id = p_attendance;
  if v_tenant is null then raise exception 'Atendimento nao encontrado' using errcode='P0002'; end if;
  if not public.can_access(v_tenant, 'crm.mover_manual') then
    raise exception 'Sem permissao para mover manualmente' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_stages where tenant_id = v_tenant and code = p_stage and is_active) then
    raise exception 'Estagio invalido' using errcode = '22023';
  end if;

  v_terminal := p_stage in ('finalizado','cancelado','ausente');
  -- De onde ele esta saindo: mesma lista, para saber se e REABERTURA.
  v_era_terminal := v_etapa_atual in ('finalizado','cancelado','ausente');

  perform set_config('app.manual_move', 'on', true);

  update public.attendances
     set stage_code = p_stage,
         updated_by = auth.uid(),
         -- Entrando numa etapa terminal, marca a data. SAINDO de uma,
         -- limpa as tres.
         --
         -- Trazer um cartao de Finalizado de volta ao fluxo deixava
         -- `finished_at` preenchido, e recepcao, triagem, modulo medico e
         -- pagamentos TODOS filtram por `finished_at is null`: o paciente
         -- voltava para uma etapa ativa e ficava invisivel nas quatro.
         finished_at = case when p_stage = 'finalizado' then coalesce(finished_at, now())
                            when v_terminal then finished_at else null end,
         cancelled_at = case when p_stage = 'cancelado' then coalesce(cancelled_at, now())
                             when v_terminal then cancelled_at else null end,
         absent_at = case when p_stage = 'ausente' then coalesce(absent_at, now())
                          when v_terminal then absent_at else null end,
         exit_at = case when p_stage = 'finalizado' then coalesce(exit_at, now())
                        when v_terminal then exit_at else null end,
         in_service = case when v_terminal then false else in_service end,
         current_room_id = case when v_terminal then null else current_room_id end,
         notes = coalesce(notes, '') || case when p_reason is null then '' else E'\n[CRM] ' || p_reason end
   where id = p_attendance;
  perform set_config('app.manual_move', 'off', true);

  if v_terminal then
    perform public.liberar_salas_do_atendimento(p_attendance);

    -- Exame de quem foi embora nao e exame pendente. Sem isto ele fica na
    -- contagem de pendencias da clinica para sempre.
    --
    -- A marca `cancelado_pelo_encerramento` e o que permite desfazer isto
    -- na reabertura sem tocar em exame que a clinica cancelou a mao.
    if p_stage in ('cancelado','ausente') then
      update public.patient_exams
         set status = 'cancelado',
             cancelado_pelo_encerramento = true,
             updated_by = auth.uid()
       where attendance_id = p_attendance
         and status in ('pendente','em_fila','chamado','em_andamento');
    end if;

  elsif v_era_terminal then
    -- REABERTURA. Os exames que cairam junto com o atendimento voltam a
    -- fila; a marca sai, porque a partir de agora eles sao exames normais.
    --
    -- Voltam como `pendente` (nao `em_fila`): e onde o check-in os coloca, e
    -- e o estado que a reparticao de salas espera. `queued_at` e limpo para
    -- a espera nao contar o tempo em que o atendimento estava cancelado.
    update public.patient_exams
       set status = 'pendente',
           cancelado_pelo_encerramento = false,
           queued_at = null,
           called_at = null,
           started_at = null,
           room_id = case when sala_escolhida_a_mao then room_id else null end,
           updated_by = auth.uid()
     where attendance_id = p_attendance
       and status = 'cancelado'
       and cancelado_pelo_encerramento;
  end if;
end$$;

comment on function public.move_attendance_stage(uuid, text, text) is
  'Move o atendimento de etapa. Ao ENTRAR numa etapa terminal solta paciente, sala e exames; ao SAIR de uma, limpa as datas de encerramento e DEVOLVE a fila os exames que cairam com o atendimento -- senao o paciente volta ao fluxo invisivel, sem exame e sem nada que o mova.';

grant execute on function public.move_attendance_stage(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Conserta o que ja esta gravado: atendimento em etapa ATIVA cujos exames
-- estao todos cancelados e que, por isso, esta parado em lugar nenhum.
--
-- Estes sao exatamente os reabertos antes desta migration. Nao ha marca
-- para consultar neles, entao o criterio e o estado: atendimento aberto,
-- em etapa de exame, sem um unico exame ativo.
-- ---------------------------------------------------------------------
update public.patient_exams pe
   set status = 'pendente',
       queued_at = null,
       called_at = null,
       started_at = null,
       -- Mesma regra do `elsif` da funcao: sala escolhida a mao fica; sala
       -- herdada da chamada anterior sai, para a fila repartir de novo.
       room_id = case when pe.sala_escolhida_a_mao then pe.room_id else null end
  from public.attendances a
 where pe.attendance_id = a.id
   and a.stage_code in ('aguardando_exames','em_exames')
   and a.finished_at is null
   and a.cancelled_at is null
   and a.absent_at is null
   and a.deleted_at is null
   and pe.status = 'cancelado'
   -- `nao_realizado` entra na lista.
   --
   -- E o status de "o paciente nao fez": recusou, foi embora, foi tirado da
   -- fila. Sem ele aqui, um atendimento com UM exame nao realizado e os
   -- outros cancelados a mao satisfazia o `not exists`, e todos os
   -- cancelados voltavam para a fila — exames que a clinica decidiu nao
   -- fazer reaparecendo nas salas.
   --
   -- Qualquer sinal de que alguem mexeu nos exames deste atendimento manda
   -- deixar como esta. Os sete valores do enum sao: pendente, em_fila,
   -- chamado, em_andamento, concluido, nao_realizado, cancelado — e so o
   -- ultimo fica de fora desta lista, que e justamente o que se conserta.
   and not exists (
     select 1 from public.patient_exams outro
      where outro.attendance_id = a.id
        and outro.status in (
          'pendente','em_fila','chamado','em_andamento','concluido',
          'nao_realizado'));


do $$
declare v_devolvidos int;
begin
  select count(*) into v_devolvidos
    from public.patient_exams pe
    join public.attendances a on a.id = pe.attendance_id
   where a.stage_code in ('aguardando_exames','em_exames')
     and pe.status = 'pendente';
  raise notice 'Exames em fila apos a devolucao: %', v_devolvidos;
end$$;


-- ==========================================================
-- MIGRATIONS: 0052_assinatura_do_medico_volta_a_funcionar.sql
-- ==========================================================

-- =====================================================================
-- 0052 - O medico volta a conseguir guardar e usar a propria assinatura
--
-- ---------------------------------------------------------------------
-- O defeito
-- ---------------------------------------------------------------------
-- A politica do bucket `signatures` da 0014 tem o comentario:
--
--     "Assinaturas: somente admin de usuarios e o proprio profissional"
--
-- ...e implementa so a primeira metade. A condicao e
-- `can_access(..., 'usuarios.administrar')` nas duas direcoes, e o papel
-- `medico_examinador` NAO tem essa permissao — ela e de administracao de
-- usuarios, e o medico nao administra usuario nenhum.
--
-- Resultado em cadeia:
--
--   1. GRAVAR: o medico abre o perfil, desenha a assinatura, salva. O
--      upload e recusado pela RLS e ele ve um erro de storage sem
--      explicacao.
--
--   2. LER: pior, porque e silencioso. `carregarSignatario` chama
--      `createSignedUrl` com o cliente do USUARIO. A RLS recusa, a
--      chamada devolve `{ data: null, error }` sem lancar excecao, e o
--      codigo so testa `if (data?.signedUrl)`. O A.S.O. sai com "Assinado
--      eletronicamente" e uma linha em branco.
--
-- Ou seja: a captura da assinatura de cada medico, que a clinica pediu e
-- que existe implementada na tela, nunca funcionou em producao — e o
-- documento saia sem assinatura sem avisar ninguem.
--
-- ---------------------------------------------------------------------
-- A politica nova, nas tres frentes
-- ---------------------------------------------------------------------
-- O caminho do arquivo e `<tenant>/profissionais/<user_id>.png`
-- (`medicos-actions.ts`), entao da para reconhecer o dono pelo nome.
--
--   ESCREVER e APAGAR -> o proprio dono, ou quem administra usuarios
--                        (para o caso do medico que nao usa o sistema e
--                        entrega a assinatura digitalizada no balcao).
--
--   LER -> os dois acima, mais quem emite documento.
--
-- A leitura e mais larga de proposito: quem emite o A.S.O. pela aba
-- Documentos e muitas vezes a recepcao, e sem poder ler a imagem ela
-- emitiria o documento do medico sem a assinatura dele. Vale registrar o
-- que isso significa: quem emite documento consegue baixar a imagem da
-- assinatura dos profissionais da propria clinica. E a mesma confianca
-- que a clinica ja deposita em quem imprime e entrega o A.S.O. assinado —
-- e, por isso mesmo, a imagem nao substitui assinatura digital ICP-Brasil
-- para fins do CFM 2.299/2021.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dono do arquivo de assinatura.
--
-- `storage.foldername(name)` devolve as pastas; o arquivo e
-- `<tenant>/profissionais/<uuid>.png`, entao o dono esta no nome do
-- arquivo, nao na pasta. Funcao propria para a politica ficar legivel e
-- para o formato do caminho viver em UM lugar.
-- ---------------------------------------------------------------------
create or replace function public.assinatura_e_minha(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and p_name = public.current_tenant_id()::text
              || '/profissionais/'
              || auth.uid()::text
              || '.png';
$$;

comment on function public.assinatura_e_minha(text) is
  'Verdadeiro quando o caminho no bucket signatures e o arquivo de assinatura do proprio usuario logado.';


drop policy if exists wl_signatures on storage.objects;
drop policy if exists wl_signatures_ler on storage.objects;
drop policy if exists wl_signatures_gravar on storage.objects;
drop policy if exists wl_signatures_trocar on storage.objects;
drop policy if exists wl_signatures_apagar on storage.objects;

-- Ler: o dono, quem administra usuarios, ou quem emite documento.
create policy wl_signatures_ler on storage.objects for select to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
      or public.can_access(public.storage_tenant(name), 'documentos.emitir')
    )
  );

-- Gravar: so o dono ou quem administra usuarios.
create policy wl_signatures_gravar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );

-- Trocar (o upsert da tela de perfil passa por aqui).
create policy wl_signatures_trocar on storage.objects for update to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  )
  with check (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );

-- Apagar.
create policy wl_signatures_apagar on storage.objects for delete to authenticated
  using (
    bucket_id = 'signatures'
    and (
      public.assinatura_e_minha(name)
      or public.can_access(public.storage_tenant(name), 'usuarios.administrar')
    )
  );


do $$
declare v_politicas int;
begin
  select count(*) into v_politicas from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'wl_signatures%';
  raise notice 'Politicas do bucket de assinaturas: % (esperado 4)', v_politicas;
end$$;


-- ==========================================================
-- MIGRATIONS: 0053_trava_do_portal_funciona_em_producao.sql
-- ==========================================================

-- =====================================================================
-- 0053 - A trava do portal do paciente funciona onde importa
--
-- ---------------------------------------------------------------------
-- O defeito, que era meu e desta noite
-- ---------------------------------------------------------------------
-- As duas funcoes da 0048 chamam `digest(p_cpf, 'sha256')`, que vem do
-- pgcrypto, com `set search_path = public, pg_temp`.
--
-- No banco de teste isso funciona: a 0001 roda `create extension pgcrypto`
-- e a extensao cai em `public`. No Supabase hospedado o pgcrypto JA VEM
-- instalado, no schema `extensions` — logo o `create extension if not
-- exists` da 0001 e no-op e `digest` NAO esta em `public`.
--
-- Com o `search_path` sem `extensions`, as duas funcoes levantavam
-- "function digest(text, unknown) does not exist". E o codigo falha ABERTO:
-- `.rpc()` devolve `{ data: null, error }` sem lancar, o erro e descartado,
-- `null` nao e `false`, e a trava simplesmente nao contava nada.
--
-- Ou seja: a protecao contra forca bruta existia no teste e nao existia na
-- clinica, sem uma linha de log dizendo isso. O pior tipo de defeito.
--
-- ---------------------------------------------------------------------
-- A correcao: `sha256`, que e do proprio Postgres
-- ---------------------------------------------------------------------
-- `sha256(bytea)` e funcao NUCLEO do Postgres desde a versao 14 — nao
-- depende de extensao nenhuma, nao depende de qual schema alguem escolheu,
-- e da o mesmo resultado nos dois ambientes. Trocar por ela tira a
-- dependencia inteira em vez de remendar o `search_path`.
--
-- O digest muda de valor (mesma funcao, chamada diferente), entao as
-- tentativas ja registradas deixam de casar. Sao tentativas de login das
-- ultimas horas: a tabela e limpa junto, e ninguem fica preso por causa da
-- troca.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- Contador zerado: os digests antigos nao casam mais com os novos, e
-- manter linhas que nunca serao consultadas so confunde quem for auditar.
delete from public.portal_login_attempts;


create or replace function public.portal_registrar_tentativa(
  p_tenant uuid,
  p_cpf    text,
  p_ok     boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digest text;
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  -- `sha256` e do nucleo do Postgres: nao depende de pgcrypto nem de em
  -- qual schema ele foi instalado.
  v_digest := encode(sha256(convert_to(p_cpf, 'UTF8')), 'hex');

  if p_ok then
    -- Entrou: o contador dele zera.
    delete from public.portal_login_attempts
     where tenant_id = p_tenant and cpf_digest = v_digest;
    insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
    values (p_tenant, v_digest, true);
    return true;
  end if;

  insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
  values (p_tenant, v_digest, false);

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = v_digest
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_registrar_tentativa(uuid, text, boolean) is
  'Conta tentativa de acesso ao portal do paciente e devolve false quando o CPF passou de cinco falhas em quinze minutos. Usa sha256 do nucleo do Postgres, nao pgcrypto.';


create or replace function public.portal_pode_tentar(
  p_tenant uuid,
  p_cpf    text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = encode(sha256(convert_to(p_cpf, 'UTF8')), 'hex')
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_pode_tentar(uuid, text) is
  'Consulta a trava do portal do paciente sem registrar tentativa.';


-- ---------------------------------------------------------------------
-- Prova que a funcao responde de verdade neste banco.
--
-- A 0048 nao tinha esta checagem, e foi por isso que o defeito passou: a
-- funcao existia, era chamavel, e falhava so na hora de executar. Aqui ela
-- e EXECUTADA na migration — se `sha256` nao existir neste Postgres, a
-- migration para com erro em vez de deixar a clinica sem trava.
-- ---------------------------------------------------------------------
do $$
declare
  v_tenant uuid;
  v_resposta boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  if v_tenant is null then
    raise notice 'Sem clinica cadastrada: trava do portal nao pode ser exercitada agora.';
    return;
  end if;

  -- CPF que nao existe em cadastro nenhum, so para exercitar a funcao.
  v_resposta := public.portal_pode_tentar(v_tenant, '00000000000');
  if v_resposta is null then
    raise exception 'portal_pode_tentar devolveu nulo: a trava do portal nao esta funcionando';
  end if;

  raise notice 'Trava do portal do paciente respondendo (pode tentar: %).', v_resposta;
end$$;


-- ==========================================================
-- MIGRATIONS: 0054_indice_da_recepcao_nao_barra_o_financeiro.sql
-- ==========================================================

-- =====================================================================
-- 0054 - O indice da recepcao para de barrar a cobranca do Financeiro
--
-- ---------------------------------------------------------------------
-- O defeito, que era meu e desta noite
-- ---------------------------------------------------------------------
-- A 0050 criou um indice unico para impedir a cobranca dupla que duas
-- recepcionistas produziam. Ela escolheu `provider = 'pix_manual'` como
-- marca da cobranca da recepcao, e escreveu, no proprio comentario, que o
-- indice tinha de ser parcial para NAO barrar a cobranca a mais que a tela
-- de Financeiro lanca de proposito (exame incluido depois, acerto de
-- diferenca).
--
-- Só que a cobranca do Financeiro grava o MESMO provider:
--
--     createCharge:  provider: method === 'pix' ? 'pix_manual' : 'manual'
--
-- Entao o indice barrava exatamente o caso que ele dizia preservar, com o
-- erro 23505 chegando na tela como "Registro duplicado." — sem nenhuma
-- pista de que era o Pix da recepcao que estava no caminho.
--
-- ---------------------------------------------------------------------
-- A correcao: dizer o que a coisa e, em vez de adivinhar pelo provedor
-- ---------------------------------------------------------------------
-- `provider` responde "por onde o dinheiro entra"; nao serve para responder
-- "quem gerou esta cobranca". A coluna nova responde a segunda pergunta, e
-- e ela que o indice passa a usar.
--
-- Cobranca antiga fica com `false` e sai do indice. Sao cobrancas ja
-- resolvidas, e a 0050 ja recolheu as duplicadas que existiam.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

alter table public.payments
  add column if not exists gerada_na_recepcao boolean not null default false;

comment on column public.payments.gerada_na_recepcao is
  'Verdadeiro para a cobranca que a tela da recepcao gera ao liberar o paciente. O indice unico de cobranca em aberto olha esta coluna, e nao o provedor: a cobranca extra lancada no Financeiro usa o mesmo provedor e nao pode ser barrada.';


-- ---------------------------------------------------------------------
-- Retroage no que a recepcao gerou antes desta coluna existir.
--
-- Criterio conservador: cobranca em aberto, do provedor que a recepcao
-- usava, com descricao no formato que so ela escreve ("Exames: ..."). Errar
-- para menos aqui e seguro — cobranca que ficar de fora do indice apenas
-- deixa de ter a protecao, sem barrar nada.
-- ---------------------------------------------------------------------
update public.payments
   set gerada_na_recepcao = true
 where gerada_na_recepcao = false
   and attendance_id is not null
   and provider = 'pix_manual'
   and description like 'Exames:%'
   and status in ('pendente', 'em_analise')
   and deleted_at is null;


drop index if exists public.uq_cobranca_aberta_da_recepcao;

create unique index if not exists uq_cobranca_aberta_da_recepcao
  on public.payments (tenant_id, attendance_id)
  where attendance_id is not null
    and gerada_na_recepcao
    and status in ('pendente', 'em_analise')
    and deleted_at is null;

comment on index public.uq_cobranca_aberta_da_recepcao is
  'Uma cobranca DA RECEPCAO em aberto por atendimento. Impede a cobranca dupla quando duas telas geram ao mesmo tempo, e nao alcanca a cobranca lancada no Financeiro.';


do $$
declare v_marcadas int;
begin
  select count(*) into v_marcadas from public.payments where gerada_na_recepcao;
  raise notice 'Cobrancas marcadas como geradas na recepcao: %', v_marcadas;
end$$;


-- ==========================================================
-- SEED: 0001_tenant_inicial.sql
-- ==========================================================

-- =====================================================================
-- SEED 0001 - Primeiro tenant da plataforma
-- Estes sao DADOS, nao codigo. Nenhum valor aqui esta fixado na aplicacao:
-- tudo e editavel em Configuracoes da Empresa.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_role_medico uuid;
  v_role_admin uuid;
  v_role_atendimento uuid;
  v_room_recepcao uuid;
  v_room_triagem uuid;
  v_room_audio uuid;
  v_room_ecg uuid;
  v_room_eeg uuid;
  v_room_espiro uuid;
  v_room_lab uuid;
  v_room_dinamo uuid;
  v_room_consultorio uuid;
  v_cat_ocupacional uuid;
  v_cat_exames uuid;
  v_cat_pacotes uuid;
  v_product uuid;
  v_package uuid;
begin
  -- ---------------- TENANT ----------------
  insert into public.tenants (slug, legal_name, trade_name, timezone, locale, currency, is_active)
  values ('h2', 'H2 Medicina Ocupacional', 'H2 Medicina Ocupacional', 'America/Sao_Paulo', 'pt-BR', 'BRL', true)
  on conflict (slug) do update set trade_name = excluded.trade_name
  returning id into v_tenant;

  if v_tenant is null then
    select id into v_tenant from public.tenants where slug = 'h2';
  end if;

  -- ---------------- MARCA ----------------
  -- Os caminhos do logo apontam para `public/marca/`, que vai no deploy
  -- (`outputFileTracingIncludes` no next.config.ts) e e lido direto do disco
  -- pelo gerador de PDF. Sem estas tres linhas, TODO documento -- A.S.O.,
  -- guia, laudo -- saia sem logo, e a home mostrava as iniciais "H2" no lugar
  -- da marca: nenhum seed definia o logo, e a clinica nao tinha como saber
  -- que era so preencher o campo.
  insert into public.tenant_branding (tenant_id, system_name, color_primary, color_secondary, color_accent, color_sidebar, footer_text,
                                      logo_url, logo_compact_url, favicon_url)
  values (v_tenant, 'H2 Medicina Ocupacional', '#0F766E', '#0EA5E9', '#F59E0B', '#0B1220',
          'Desenvolvido pelo Balao da Informatica',
          '/marca/h2-logo.png', '/marca/h2-logo-compacto.png', '/marca/h2-favicon.png')
  on conflict (tenant_id) do update
    set system_name = excluded.system_name,
        footer_text = excluded.footer_text,
        -- `coalesce` para nao sobrescrever logo que a clinica tenha subido
        -- pela tela de Configuracoes: o seed preenche o que esta vazio.
        logo_url = coalesce(public.tenant_branding.logo_url, excluded.logo_url),
        logo_compact_url = coalesce(public.tenant_branding.logo_compact_url, excluded.logo_compact_url),
        favicon_url = coalesce(public.tenant_branding.favicon_url, excluded.favicon_url);

  -- ---------------- CONFIGURACOES (todas editaveis no painel) ----------------
  insert into public.tenant_settings (tenant_id, group_key, settings) values
    (v_tenant, 'empresa', jsonb_build_object(
      'razao_social','H2 Medicina Ocupacional',
      'nome_fantasia','H2 Medicina Ocupacional',
      'cnpj', null, 'inscricao_municipal', null, 'site', null, 'dominio', null)),
    (v_tenant, 'contato', jsonb_build_object(
      'telefone', null, 'whatsapp', null, 'email', null,
      'cep', null, 'logradouro', null, 'numero', null, 'complemento', null,
      'bairro', null, 'cidade', null, 'estado', null)),
    (v_tenant, 'responsavel_tecnico', jsonb_build_object(
      'nome','Dra. Wania Sanches Picasso',
      'conselho','CRM', 'numero', null, 'uf', null, 'assinatura_url', null)),
    (v_tenant, 'documentos', jsonb_build_object(
      'cabecalho', null, 'rodape', null,
      'codigo_verificacao_ativo', true,
      'url_verificacao', '/verificar')),
    (v_tenant, 'institucional', jsonb_build_object(
      'politica_privacidade', null, 'termos_uso', null, 'sobre', null)),
    (v_tenant, 'totem', jsonb_build_object(
      'prefixos', jsonb_build_object('normal','A','prioritario','P','encaixe','E'),
      'tempo_reinicio_segundos', 45,
      'imprimir_etiqueta', true,
      'mostrar_instrucoes', true,
      'instrucoes','Informe seu CPF para localizar o agendamento.')),
    (v_tenant, 'painel_tv', jsonb_build_object(
      'quantidade_ultimas_chamadas', 5,
      'tempo_exibicao_segundos', 20,
      'aviso_sonoro', true,
      'volume', 0.8,
      'voz', 'pt-BR',
      'exibir_nome_parcial', true)),
    (v_tenant, 'filas', jsonb_build_object(
      'exige_triagem', true,
      'recepcao_obrigatoria', true,
      'ordem_fixa_exames', false,
      'peso_prioridade', 10,
      'peso_tempo_espera', 1)),
    (v_tenant, 'ecommerce', jsonb_build_object(
      'loja_ativa', true, 'nome_loja','Loja H2',
      'permite_compra_empresarial', true,
      'exige_login_checkout', false,
      'texto_checkout', null)),
    (v_tenant, 'pagamento', jsonb_build_object(
      'chave_pix', null, 'tipo_chave', 'aleatoria',
      'beneficiario', 'H2 MEDICINA OCUPACIONAL', 'cidade', 'SAO PAULO',
      'modo', 'manual', 'gateway', null)),
    (v_tenant, 'email', jsonb_build_object('provedor','manual','remetente', null, 'nome_remetente', null)),
    (v_tenant, 'ia', jsonb_build_object('provedor','template','modelo', null)),
    (v_tenant, 'scraper', jsonb_build_object('modo_padrao','teste','aprovacao_humana', true)),
    (v_tenant, 'app', jsonb_build_object('nome','H2 Paciente','permite_documentos', true, 'permite_compras', true))
  on conflict (tenant_id, group_key) do nothing;

  -- ---------------- MODULOS ----------------
  -- Nucleo clinico + financeiro ligado desde o inicio.
  insert into public.tenant_modules (tenant_id, module_key, is_enabled)
  select v_tenant, m, true from unnest(array[
    'agenda','totem','painel_tv','recepcao','triagem','exames','filas','crm','medico',
    'documentos','financeiro','relatorios','pwa','lgpd'
  ]) as m
  on conflict (tenant_id, module_key) do nothing;

  -- Loja, importacao automatizada e campanhas ficam desligadas por padrao.
  -- O modelo de dados e as telas existem; basta ligar em
  -- Configuracoes da empresa -> Modulos quando o cliente quiser usar.
  insert into public.tenant_modules (tenant_id, module_key, is_enabled)
  select v_tenant, m, false from unnest(array[
    'ecommerce','scraper','campanhas'
  ]) as m
  on conflict (tenant_id, module_key) do nothing;

  -- ---------------- PAPEIS ----------------
  insert into public.roles (tenant_id, code, name, description, is_system) values
    (v_tenant, 'medico_examinador', 'Medico e examinador', 'Realiza triagem, exames e consulta medica', true),
    (v_tenant, 'administrativo', 'Administrativo', 'Gestao completa do sistema', true),
    (v_tenant, 'atendimento', 'Atendimento e recepcao', 'Recepcao, filas e cobrancas', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_role_medico from public.roles where tenant_id = v_tenant and code = 'medico_examinador';
  select id into v_role_admin from public.roles where tenant_id = v_tenant and code = 'administrativo';
  select id into v_role_atendimento from public.roles where tenant_id = v_tenant and code = 'atendimento';

  -- Administrativo: todas as permissoes
  insert into public.role_permissions (role_id, permission_code)
  select v_role_admin, code from public.permissions
  on conflict do nothing;

  -- Medico e examinador
  insert into public.role_permissions (role_id, permission_code)
  select v_role_medico, c from unnest(array[
    'dashboard.ver','relatorios.ver','pacientes.ver','clinico.ver','agenda.ver','empresas.ver',
    'filas.operar','painel.operar','triagem.preencher','exames.preencher','exames.concluir',
    'medico.atender','documentos.emitir','crm.mover_manual'
  ]) as c
  on conflict do nothing;

  -- Atendimento e recepcao
  insert into public.role_permissions (role_id, permission_code)
  select v_role_atendimento, c from unnest(array[
    'dashboard.ver','pacientes.ver','pacientes.criar','pacientes.editar',
    'agenda.ver','agenda.administrar','empresas.ver','empresas.administrar',
    -- `exames.concluir` acompanha `filas.operar`: quem chama o paciente
    -- para a sala precisa poder encerrar o exame e devolver a sala. Sem
    -- isso a sala fica ocupada por quem ja saiu e a fila para.
    'totem.operar','recepcao.operar','filas.operar','painel.operar','exames.concluir',
    'financeiro.ver','financeiro.registrar','documentos.emitir','crm.mover_manual',
    'pedidos.administrar','importacoes.executar'
  ]) as c
  on conflict do nothing;

  -- ---------------- ESTAGIOS DO CRM ----------------
  insert into public.crm_stages (tenant_id, code, name, color, sort_order, is_terminal) values
    (v_tenant,'agendado','Agendado','#9CA3AF',1,false),
    (v_tenant,'checkin','Check-in realizado','#94A3B8',2,false),
    (v_tenant,'aguardando_recepcao','Aguardando recepcao','#9CA3AF',3,false),
    (v_tenant,'na_recepcao','Na recepcao','#3B82F6',4,false),
    (v_tenant,'aguardando_triagem','Aguardando triagem','#FB923C',5,false),
    (v_tenant,'em_triagem','Em triagem','#3B82F6',6,false),
    (v_tenant,'aguardando_exames','Aguardando exames','#FB923C',7,false),
    (v_tenant,'em_exames','Em exames','#3B82F6',8,false),
    (v_tenant,'aguardando_medico','Aguardando medico','#A855F7',9,false),
    (v_tenant,'em_consulta','Em consulta','#3B82F6',10,false),
    (v_tenant,'aguardando_documentos','Aguardando documentos','#FACC15',11,false),
    (v_tenant,'finalizado','Finalizado','#22C55E',12,true),
    (v_tenant,'cancelado','Cancelado','#4B5563',13,true),
    (v_tenant,'ausente','Ausente','#EF4444',14,true)
  on conflict (tenant_id, code) do nothing;

  -- ---------------- SALAS ----------------
  insert into public.rooms (tenant_id, code, name, kind, sort_order) values
    (v_tenant,'REC','Recepcao','recepcao',1),
    (v_tenant,'TRI','Triagem','triagem',2),
    (v_tenant,'AUD','Sala de Audiometria','exame',3),
    (v_tenant,'ECG','Sala de Eletrocardiograma','exame',4),
    (v_tenant,'EEG','Sala de Eletroencefalograma','exame',5),
    (v_tenant,'ESP','Sala de Espirometria','exame',6),
    (v_tenant,'LAB','Coleta Laboratorial','exame',7),
    (v_tenant,'DIN','Sala de Dinamometria','exame',8),
    (v_tenant,'CON','Consultorio Medico','consultorio',9)
  on conflict (tenant_id, code) do nothing;

  select id into v_room_recepcao from public.rooms where tenant_id=v_tenant and code='REC';
  select id into v_room_triagem  from public.rooms where tenant_id=v_tenant and code='TRI';
  select id into v_room_audio    from public.rooms where tenant_id=v_tenant and code='AUD';
  select id into v_room_ecg      from public.rooms where tenant_id=v_tenant and code='ECG';
  select id into v_room_eeg      from public.rooms where tenant_id=v_tenant and code='EEG';
  select id into v_room_espiro   from public.rooms where tenant_id=v_tenant and code='ESP';
  select id into v_room_lab      from public.rooms where tenant_id=v_tenant and code='LAB';
  select id into v_room_dinamo   from public.rooms where tenant_id=v_tenant and code='DIN';
  select id into v_room_consultorio from public.rooms where tenant_id=v_tenant and code='CON';

  -- ---------------- TIPOS DE EXAME ----------------
  insert into public.exam_types (tenant_id, code, name, description, average_minutes, default_room_id, sort_order, price, available_online, requires_result_document) values
    (v_tenant,'AUDIO','Audiometria','Avaliacao auditiva ocupacional',20,v_room_audio,1,90.00,true,true),
    (v_tenant,'ECG','Eletrocardiograma','ECG de repouso com laudo',15,v_room_ecg,2,110.00,true,true),
    (v_tenant,'EEG','Eletroencefalograma','EEG com laudo',30,v_room_eeg,3,220.00,true,true),
    (v_tenant,'ESPIRO','Espirometria','Prova de funcao pulmonar',20,v_room_espiro,4,120.00,true,true),
    (v_tenant,'LAB','Exames laboratoriais','Coleta de material biologico',10,v_room_lab,5,80.00,true,true),
    (v_tenant,'DINAMO','Dinamometria','Avaliacao de forca de preensao',15,v_room_dinamo,6,70.00,true,false),
    (v_tenant,'CLINICO','Consulta clinica ocupacional','Avaliacao medica e emissao de aptidao',20,v_room_consultorio,7,150.00,true,false)
  on conflict (tenant_id, code) do nothing;

  insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
  select v_tenant, et.default_room_id, et.id from public.exam_types et
   where et.tenant_id = v_tenant and et.default_room_id is not null
  on conflict do nothing;

  -- ---------------- TOTEM ----------------
  insert into public.totems (tenant_id, code, name, location)
  values (v_tenant, 'TOTEM01', 'Totem da recepcao', 'Entrada principal')
  on conflict (tenant_id, code) do nothing;

  -- ---------------- CATALOGO DA LOJA ----------------
  insert into public.product_categories (tenant_id, slug, name, description, sort_order) values
    (v_tenant,'saude-ocupacional','Saude Ocupacional','Servicos para empresas e colaboradores',1),
    (v_tenant,'exames','Exames','Exames complementares avulsos',2),
    (v_tenant,'pacotes','Pacotes','Combos com varios exames',3)
  on conflict (tenant_id, slug) do nothing;

  select id into v_cat_ocupacional from public.product_categories where tenant_id=v_tenant and slug='saude-ocupacional';
  select id into v_cat_exames from public.product_categories where tenant_id=v_tenant and slug='exames';
  select id into v_cat_pacotes from public.product_categories where tenant_id=v_tenant and slug='pacotes';

  -- Um produto por exame disponivel online
  insert into public.products (tenant_id, category_id, kind, slug, code, name, short_description,
                               price, duration_minutes, requires_scheduling, is_active, sort_order)
  select v_tenant, v_cat_exames, 'exame',
         lower(regexp_replace(et.name, '[^a-zA-Z0-9]+', '-', 'g')),
         et.code, et.name, et.description, coalesce(et.price, 0), et.average_minutes, true, true, et.sort_order
    from public.exam_types et
   where et.tenant_id = v_tenant and et.available_online
  on conflict (tenant_id, slug) do nothing;

  -- Pacote admissional
  insert into public.products (tenant_id, category_id, kind, slug, code, name, short_description,
                               description, price, promo_price, requires_scheduling, is_featured, is_active, sort_order)
  values (v_tenant, v_cat_pacotes, 'pacote', 'pacote-admissional', 'PKG-ADM',
          'Pacote Admissional Completo',
          'Consulta clinica ocupacional + audiometria + exames laboratoriais',
          'Pacote com tudo o que a empresa precisa para o exame admissional do colaborador.',
          320.00, 279.00, true, true, true, 1)
  on conflict (tenant_id, slug) do nothing
  returning id into v_product;

  if v_product is null then
    select id into v_product from public.products where tenant_id=v_tenant and slug='pacote-admissional';
  end if;

  insert into public.service_packages (tenant_id, product_id, name, description)
  values (v_tenant, v_product, 'Pacote Admissional Completo', 'Consulta + audiometria + laboratorio')
  on conflict (product_id) do nothing
  returning id into v_package;

  if v_package is null then
    select id into v_package from public.service_packages where product_id = v_product;
  end if;

  insert into public.package_items (tenant_id, package_id, exam_type_id, quantity, sort_order)
  select v_tenant, v_package, et.id, 1, et.sort_order
    from public.exam_types et
   where et.tenant_id = v_tenant and et.code in ('CLINICO','AUDIO','LAB')
  on conflict do nothing;

  -- ---------------- TEMPLATE DE CAMPANHA ----------------
  insert into public.email_templates (tenant_id, code, name, subject, body_html, body_text, variables)
  values (v_tenant, 'prospeccao_semanal', 'Prospeccao semanal',
    'Saude ocupacional em dia na {{empresa}}?',
    '<p>Ola, {{contato}}!</p><p>Somos a {{nome_fantasia}}. Ajudamos empresas como a <strong>{{empresa}}</strong> a manter os exames ocupacionais em dia, com agendamento rapido e laudos organizados.</p><p>{{lista_servicos}}</p><p><a href="{{link_loja}}">Ver servicos e agendar</a></p><p>{{rodape}}</p><p><a href="{{link_descadastro}}">Nao desejo mais receber</a></p>',
    E'Ola, {{contato}}!\n\nSomos a {{nome_fantasia}}. Ajudamos empresas como a {{empresa}} a manter os exames ocupacionais em dia.\n\n{{lista_servicos}}\n\nAgende em: {{link_loja}}\n\n{{rodape}}\nDescadastro: {{link_descadastro}}',
    '["empresa","contato","nome_fantasia","lista_servicos","link_loja","link_descadastro","rodape"]'::jsonb)
  on conflict (tenant_id, code) do nothing;

  -- ---------------- PROVEDORES (todos em modo manual/nao configurado) ----------------
  insert into public.provider_settings (tenant_id, category, provider, is_active, is_default, public_config, status) values
    (v_tenant,'pagamento','pix_manual', true, true, '{"descricao":"Pix com confirmacao manual pela recepcao"}'::jsonb,'ativo'),
    (v_tenant,'email','manual', true, true, '{"descricao":"Fila local; envio real exige provedor configurado"}'::jsonb,'ativo'),
    (v_tenant,'ia','template', true, true, '{"descricao":"Geracao por template; IA opcional"}'::jsonb,'ativo')
  on conflict (tenant_id, category, provider) do nothing;

  raise notice 'Seed concluido para o tenant %', v_tenant;
end$$;


-- ==========================================================
-- SEED: 0002_exames_da_clinica.sql
-- ==========================================================

-- =====================================================================
-- SEED 0002 - Exames realizados na clinica
--
-- Lista enviada pela recepcao em 27/08:
--   "exames realizados na clinica que devem ser inclusos nas opcoes de
--    agendamento tanto de cliente, quanto interno e incluso nas filas,
--    juntamente com as fichas em cada area: Acuidade, audiometria,
--    clinico, psicossocial, eletrocardiograma, eletroencefalograma,
--    espirometria, Exames laboratoriais, teste ishihara (cores), teste de
--    romberg, raiox, dinamometria escapular, lombar e palmar"
--
-- As salas NAO sao criadas aqui. Cada clinica organiza as suas do seu
-- jeito — a H2 numera de "Sala 1" a "Sala 9" — e inventar sala nova faz
-- aparecer um cartao vazio no quadro de filas que ninguem opera. Os
-- exames novos entram nas salas que a clinica ja usa para o exame
-- equivalente, e a tela de Salas permite remanejar depois.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_sala_forca   uuid;  -- onde a clinica ja faz dinamometria
  v_sala_triagem uuid;  -- testes de bancada: acuidade, cores, questionarios
begin
  for v_tenant in select id from public.tenants loop

    -- ----------------------------------------------------------------
    -- Passo do relogio na agenda
    -- "Mudar os horarios de agendamento para de 5 em 5 minutos" (21/08)
    -- "opcao de agendamento a cada 10 minutos" (27/08 — vale a ultima)
    -- ----------------------------------------------------------------
    insert into public.tenant_settings (tenant_id, group_key, settings)
    values (v_tenant, 'agenda', jsonb_build_object('intervalo_minutos', 10))
    on conflict (tenant_id, group_key) do nothing;

    -- ----------------------------------------------------------------
    -- De onde saem as salas dos exames novos
    --
    -- Forca: a sala em que a dinamometria generica ja era feita. Na H2 e
    -- a "Sala 5 — Coleta de exames"; num tenant novo e a sala DIN do seed
    -- inicial. Se nenhuma existir, cai na sala do laboratorio.
    -- ----------------------------------------------------------------
    select r.id into v_sala_forca
      from public.exam_types et
      join public.rooms r on r.id = et.default_room_id
     where et.tenant_id = v_tenant and et.code = 'DINAMO' and r.is_active
     limit 1;

    if v_sala_forca is null then
      select r.id into v_sala_forca
        from public.exam_types et
        join public.rooms r on r.id = et.default_room_id
       where et.tenant_id = v_tenant and et.code = 'LAB' and r.is_active
       limit 1;
    end if;

    -- Acuidade, visao de cores e os questionarios sao feitos na bancada da
    -- triagem — a propria ficha de triagem ja registra acuidade O.D./O.E.
    select id into v_sala_triagem
      from public.rooms
     where tenant_id = v_tenant and kind = 'triagem' and is_active and deleted_at is null
     order by sort_order
     limit 1;

    if v_sala_triagem is null then
      v_sala_triagem := v_sala_forca;
    end if;

    -- ----------------------------------------------------------------
    -- Exames novos
    --
    -- O raio X entra sem sala de proposito: "devera ser emitido uma guia
    -- no final do atendimento encaminhando para exame".
    -- ----------------------------------------------------------------
    insert into public.exam_types
      (tenant_id, code, name, description, average_minutes, default_room_id, sort_order,
       price, available_online, requires_result_document, is_external, requires_description)
    values
      (v_tenant,'ACUIDADE','Acuidade visual','Avaliacao de acuidade visual',
       10, v_sala_triagem,  8, 45.00, true, true, false, false),
      (v_tenant,'ISHIHARA','Teste de Ishihara (cores)','Avaliacao da visao de cores',
       10, v_sala_triagem,  9, 45.00, true, true, false, false),
      (v_tenant,'PSICO','Avaliacao psicossocial','Questionario de fatores de risco psicossocial',
       15, v_sala_triagem, 10, 80.00, true, true, false, false),
      (v_tenant,'ROMBERG','Teste de Romberg','Avaliacao de equilibrio',
       10, v_sala_triagem, 11, 45.00, true, true, false, false),
      (v_tenant,'FADIGA','Teste de fadiga','Questionario de sintomas de fadiga',
       10, v_sala_triagem, 12, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_PAL','Dinamometria palmar','Forca de preensao palmar direita e esquerda',
       10, v_sala_forca,   13, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_ESC','Dinamometria escapular','Forca escapular',
       10, v_sala_forca,   14, 45.00, true, true, false, false),
      (v_tenant,'DINAMO_LOM','Dinamometria lombar','Forca lombar',
       10, v_sala_forca,   15, 45.00, true, true, false, false),
      (v_tenant,'RAIOX','Raio X','Encaminhamento externo: a guia sai no fim do atendimento',
       0,  null,           16,  0.00, false, true, true, true)
    on conflict (tenant_id, code) do update
      set name                     = excluded.name,
          description              = excluded.description,
          average_minutes          = excluded.average_minutes,
          sort_order               = excluded.sort_order,
          is_external              = excluded.is_external,
          requires_description     = excluded.requires_description,
          requires_result_document = excluded.requires_result_document,
          is_active                = true,
          -- So preenche a sala se ainda nao houver uma ativa: se a clinica
          -- remanejou o exame, a escolha dela prevalece.
          default_room_id = case
            when excluded.default_room_id is null then public.exam_types.default_room_id
            when exists (
              select 1 from public.rooms r
               where r.id = public.exam_types.default_room_id and r.is_active
            ) then public.exam_types.default_room_id
            else excluded.default_room_id
          end;

    -- Exames laboratoriais precisam da descricao da analise solicitada.
    update public.exam_types
       set requires_description = true
     where tenant_id = v_tenant and code = 'LAB';

    -- A dinamometria generica foi separada em palmar, escapular e lombar.
    update public.exam_types
       set is_active = false
     where tenant_id = v_tenant and code = 'DINAMO';

    insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
    select v_tenant, et.default_room_id, et.id
      from public.exam_types et
     where et.tenant_id = v_tenant
       and et.default_room_id is not null
       and et.is_active
    on conflict do nothing;

    -- ----------------------------------------------------------------
    -- Exame que nao ocupa sala da clinica
    --
    -- Consulta clinica, psicossocial e Romberg sao perguntados pelo medico
    -- na propria consulta; raio X e feito fora. Nenhum dos quatro entra na
    -- fila de salas -- se entrar, fica com sala nula e prende o paciente,
    -- sem cartao que o mostre e sem botao que o alcance.
    --
    -- Precisa estar aqui e nao so nas migrations: numa instalacao nova o
    -- seed roda depois delas, quando os exames ainda nem existiam para
    -- serem marcados.
    -- ----------------------------------------------------------------
    update public.exam_types
       set ocupa_sala = (code not in ('RAIOX', 'CLINICO', 'PSICO', 'ROMBERG')),
           respondido_pelo_medico = (code in ('CLINICO', 'PSICO', 'ROMBERG'))
     where tenant_id = v_tenant;

    -- O psicossocial saiu da bancada da triagem em 22/09 e o Romberg em
    -- 29/09: quem pergunta e o medico.
    -- "pode deixar somente no modulo medico" / "o teste de romberg tem que
    --  mudar para ser realizado na aba medica" -- Isabella.
    delete from public.room_exam_types ret
     using public.exam_types et
     where et.id = ret.exam_type_id and et.tenant_id = v_tenant
       and et.code in ('PSICO', 'ROMBERG');

    update public.exam_types
       set default_room_id = null
     where tenant_id = v_tenant and code in ('PSICO', 'ROMBERG');

  end loop;
end$$;


-- ==========================================================
-- SEED: 0003_dados_da_clinica.sql
-- ==========================================================

-- =====================================================================
-- SEED 0003 - Dados cadastrais reais da clinica
--
-- "Documentos: todos os documentos gerados, dados da clinica estao
--  errados (cabecalho e rodape)"
--
-- O banco ainda tinha o endereco de exemplo (Praca da Se, Sao Paulo) que
-- veio do cadastro inicial, e era ele que saia impresso em todo A.S.O.,
-- atestado e comprovante.
--
-- Os dados corretos vieram do proprio modelo de ficha clinica da clinica
-- e das mensagens da recepcao.
--
-- A troca so acontece se o valor ainda for o de exemplo ou estiver vazio:
-- rodar de novo nao desfaz o que a clinica editar em Configuracoes.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_contato jsonb;
begin
  select id into v_tenant from public.tenants where slug = 'h2';
  if v_tenant is null then
    raise notice 'Tenant h2 nao encontrado; nada a corrigir.';
    return;
  end if;

  select settings into v_contato
    from public.tenant_settings
   where tenant_id = v_tenant and group_key = 'contato';

  -- Endereco: so mexe se ainda for o exemplo ou estiver em branco.
  if v_contato is null
     or coalesce(v_contato->>'logradouro', '') in ('', 'Praça da Sé')
  then
    update public.tenant_settings
       set settings = settings || jsonb_build_object(
             'telefone',    '(19) 3235-3599',
             'whatsapp',    '(19) 99956-3599',
             'cep',         '13023-185',
             'logradouro',  'Rua Sacramento',
             'numero',      '908',
             'complemento', 'Próximo ao Clube Fonte São Paulo',
             'bairro',      'Vila Itapura',
             'cidade',      'Campinas',
             'estado',      'SP')
     where tenant_id = v_tenant and group_key = 'contato';

    -- O e-mail de exemplo era o da empresa que desenvolveu o sistema.
    update public.tenant_settings
       set settings = settings || jsonb_build_object('email', null)
     where tenant_id = v_tenant
       and group_key = 'contato'
       and settings->>'email' = 'contato@balaodainformatica.com.br';

    raise notice 'Endereco e telefones da clinica corrigidos.';
  else
    raise notice 'Endereco ja preenchido pela clinica; mantido como esta.';
  end if;

  -- Razao social e nome fantasia completos, como saem nos documentos.
  update public.tenants
     set legal_name = 'H2 MEDICINA OCUPACIONAL LTDA',
         trade_name = 'H2 Medicina Ocupacional e Segurança do Trabalho'
   where id = v_tenant and legal_name = 'H2 Medicina Ocupacional';

  update public.tenant_settings
     set settings = settings || jsonb_build_object(
           'razao_social',  'H2 MEDICINA OCUPACIONAL LTDA',
           'nome_fantasia', 'H2 MEDICINA OCUPACIONAL E SEGURANÇA DO TRABALHO')
   where tenant_id = v_tenant
     and group_key = 'empresa'
     and settings->>'razao_social' = 'H2 Medicina Ocupacional';

  -- Cabecalho e rodape dos PDFs, que estavam vazios.
  update public.tenant_settings
     set settings = settings || jsonb_build_object(
           'cabecalho', 'H2 MEDICINA OCUPACIONAL E SEGURANÇA DO TRABALHO',
           'rodape',    'Rua Sacramento, 908 - Vila Itapura - Campinas/SP - CEP 13023-185'
                        || ' - Tel. (19) 3235-3599 - WhatsApp (19) 99956-3599')
   where tenant_id = v_tenant
     and group_key = 'documentos'
     and coalesce(settings->>'cabecalho', '') = '';

  -- Responsavel tecnico: o registro estava sem numero.
  update public.tenant_settings
     set settings = settings || jsonb_build_object(
           'nome', 'Dra. Wania Sanches Picasso',
           'conselho', 'CRM', 'numero', '79775', 'uf', 'SP')
   where tenant_id = v_tenant
     and group_key = 'responsavel_tecnico'
     and coalesce(settings->>'numero', '') = '';
end$$;
