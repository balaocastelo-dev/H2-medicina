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
