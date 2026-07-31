
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

  insert into public.tv_calls (tenant_id, ticket_code, patient_label, room_name, destination, priority)
  values (p_tenant, coalesce(v_ticket.code, '---'),
          split_part(coalesce(v_patient_name,''), ' ', 1),
          v_room.name, 'sala', v_exam.priority);

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
  insert into public.tenant_branding (tenant_id, system_name, color_primary, color_secondary, color_accent, color_sidebar, footer_text)
  values (v_tenant, 'H2 Medicina Ocupacional', '#0F766E', '#0EA5E9', '#F59E0B', '#0B1220',
          'Desenvolvido pelo Balao da Informatica')
  on conflict (tenant_id) do update
    set system_name = excluded.system_name, footer_text = excluded.footer_text;

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
  insert into public.tenant_modules (tenant_id, module_key, is_enabled)
  select v_tenant, m, true from unnest(array[
    'agenda','totem','painel_tv','recepcao','triagem','exames','filas','crm','medico',
    'documentos','financeiro','ecommerce','scraper','campanhas','relatorios','pwa','lgpd'
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
    'totem.operar','recepcao.operar','filas.operar','painel.operar',
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
