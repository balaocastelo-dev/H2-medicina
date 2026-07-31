-- =====================================================================
-- 0007 - Financeiro, pagamentos, transacoes e cobrancas Pix
-- =====================================================================

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  attendance_id  uuid references public.attendances(id) on delete set null,
  order_id       uuid,
  patient_id     uuid references public.patients(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,
  contract_id    uuid references public.company_contracts(id) on delete set null,
  reference      text,
  description    text,
  amount         numeric(12,2) not null check (amount >= 0),
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  net_amount     numeric(12,2) generated always as (greatest(amount - discount, 0)) stored,
  method         payment_method not null default 'pix',
  status         payment_status not null default 'pendente',
  due_date       date,
  paid_at        timestamptz,
  cancelled_at   timestamptz,
  refunded_at    timestamptz,
  refund_amount  numeric(12,2),
  refund_reason  text,
  coupon_id      uuid,
  provider       text not null default 'manual',
  provider_reference text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  deleted_at     timestamptz
);
create index if not exists idx_payments_tenant_status on public.payments (tenant_id, status, created_at desc);
create index if not exists idx_payments_attendance on public.payments (attendance_id);
create index if not exists idx_payments_order on public.payments (order_id);

create table if not exists public.payment_transactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  payment_id   uuid not null references public.payments(id) on delete cascade,
  event        text not null,      -- criada | confirmada | falha | estorno | cancelamento | webhook
  status       payment_status not null,
  amount       numeric(12,2),
  provider     text not null default 'manual',
  provider_payload jsonb not null default '{}'::jsonb,
  performed_by uuid,
  is_manual    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_payment_transactions_payment on public.payment_transactions (payment_id, created_at desc);

create table if not exists public.pix_charges (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  payment_id    uuid not null references public.payments(id) on delete cascade,
  pix_key       text not null,
  key_kind      text not null default 'aleatoria',
  merchant_name text not null,
  merchant_city text not null,
  txid          text not null,
  amount        numeric(12,2) not null,
  payload       text not null,          -- BR Code (copia e cola)
  qrcode_data_url text,
  expires_at    timestamptz,
  confirmed_at  timestamptz,
  confirmed_by  uuid,
  confirmation_mode text not null default 'manual',  -- manual | webhook
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, txid)
);

create table if not exists public.cash_registers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  opened_by   uuid,
  opened_at   timestamptz not null default now(),
  closed_by   uuid,
  closed_at   timestamptz,
  opening_amount numeric(12,2) not null default 0,
  closing_amount numeric(12,2),
  notes       text,
  created_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['payments','pix_charges'] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;
