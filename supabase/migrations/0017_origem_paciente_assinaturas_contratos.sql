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
