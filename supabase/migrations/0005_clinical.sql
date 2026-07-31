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
