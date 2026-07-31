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
