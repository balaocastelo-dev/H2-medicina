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
