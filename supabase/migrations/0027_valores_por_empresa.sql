-- =====================================================================
-- Valor de cada exame negociado com a empresa
--
-- "cada empresa tem um valor para exame, entao vincular o valor ao
-- contrato da empresa" — o preco do mesmo exame muda de contrato para
-- contrato, e hoje a recepcao cobra de cabeca.
--
-- O valor fica na empresa, nao no contrato: o contrato vence e e renovado,
-- e o preco negociado sobrevive a renovacao. Quando um contrato precisar de
-- preco proprio, basta apontar contract_id.
-- =====================================================================

create table if not exists public.company_exam_prices (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  exam_type_id  uuid not null references public.exam_types(id) on delete cascade,
  -- Opcional: preco especifico de um contrato, quando houver mais de um.
  contract_id   uuid references public.company_contracts(id) on delete set null,
  price         numeric(12,2) not null check (price >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

comment on table public.company_exam_prices is
  'Preco de cada exame negociado com a empresa. Sem linha aqui, vale o preco de tabela do exame.';

create unique index if not exists uq_exam_price_empresa
  on public.company_exam_prices (company_id, exam_type_id, coalesce(contract_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

create index if not exists idx_exam_price_empresa
  on public.company_exam_prices (tenant_id, company_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Preco de tabela do exame, usado quando a empresa nao negociou o seu
-- ---------------------------------------------------------------------
alter table public.exam_types
  add column if not exists default_price numeric(12,2) not null default 0;

comment on column public.exam_types.default_price is
  'Preco padrao do exame, usado para particular e para empresa sem valor negociado.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.company_exam_prices enable row level security;
alter table public.company_exam_prices force row level security;

drop policy if exists tenant_select on public.company_exam_prices;
drop policy if exists tenant_write  on public.company_exam_prices;

-- Quem atende precisa ver o preco para cobrar na recepcao.
create policy tenant_select on public.company_exam_prices for select to authenticated
  using (public.belongs_to_tenant(tenant_id));

create policy tenant_write on public.company_exam_prices for all to authenticated
  using (public.can_access(tenant_id, 'empresas.administrar'))
  with check (public.can_access(tenant_id, 'empresas.administrar'));

drop trigger if exists set_updated_at on public.company_exam_prices;
create trigger set_updated_at before update on public.company_exam_prices
  for each row execute function public.tg_set_updated_at();
