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
