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
