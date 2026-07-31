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
