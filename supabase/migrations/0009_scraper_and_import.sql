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
