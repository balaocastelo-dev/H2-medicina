-- =====================================================================
-- 0008 - E-commerce white label: catalogo, carrinho, pedidos, cupons
-- =====================================================================

create table if not exists public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  parent_id   uuid references public.product_categories(id) on delete set null,
  slug        text not null,
  name        text not null,
  description text,
  image_url   text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  category_id        uuid references public.product_categories(id) on delete set null,
  kind               product_kind not null default 'exame',
  slug               text not null,
  code               text,
  sku                text,
  name               text not null,
  short_description  text,
  description        text,
  image_url          text,
  price              numeric(12,2) not null default 0 check (price >= 0),
  promo_price        numeric(12,2) check (promo_price is null or promo_price >= 0),
  promo_starts_at    timestamptz,
  promo_ends_at      timestamptz,
  stock              int,
  sales_limit        int,
  duration_minutes   int,
  requires_scheduling boolean not null default false,
  availability_rules jsonb not null default '{}'::jsonb,
  unit               text not null default 'un',
  weight_grams       int,
  width_cm           numeric(8,2),
  height_cm          numeric(8,2),
  length_cm          numeric(8,2),
  specific_terms     text,
  is_featured        boolean not null default false,
  sort_order         int not null default 0,
  is_active          boolean not null default true,
  search_key         text generated always as (public.normalize_text(name || ' ' || coalesce(short_description,''))) stored,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  unique (tenant_id, slug)
);
create index if not exists idx_products_tenant_active on public.products (tenant_id, is_active) where deleted_at is null;
create index if not exists idx_products_search on public.products using gin (search_key gin_trgm_ops);

create table if not exists public.product_images (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  url         text not null,
  alt_text    text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  sku         text,
  name        text not null,
  attributes  jsonb not null default '{}'::jsonb,
  price       numeric(12,2),
  stock       int,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Pacotes de servicos (produto -> exames incluidos) ----------------------
create table if not exists public.service_packages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (product_id)
);

create table if not exists public.package_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  package_id    uuid not null references public.service_packages(id) on delete cascade,
  exam_type_id  uuid references public.exam_types(id) on delete restrict,
  product_id    uuid references public.products(id) on delete set null,
  quantity      int not null default 1 check (quantity > 0),
  sort_order    int not null default 0,
  constraint package_items_target check (exam_type_id is not null or product_id is not null)
);
create index if not exists idx_package_items_package on public.package_items (package_id);

-- ---------------------------------------------------------------------
-- CARRINHO
-- ---------------------------------------------------------------------
create table if not exists public.carts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid,
  session_token text,
  company_id    uuid references public.companies(id) on delete set null,
  status        text not null default 'aberto',    -- aberto | convertido | abandonado
  coupon_id     uuid,
  notes         text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_carts_user on public.carts (tenant_id, user_id) where status = 'aberto';
create unique index if not exists uq_carts_session on public.carts (tenant_id, session_token) where session_token is not null and status = 'aberto';

create table if not exists public.cart_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  cart_id      uuid not null references public.carts(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete restrict,
  variant_id   uuid references public.product_variants(id) on delete set null,
  patient_id   uuid references public.patients(id) on delete set null,
  beneficiary_name text,
  beneficiary_document text,
  quantity     int not null default 1 check (quantity > 0),
  unit_price   numeric(12,2) not null,
  discount     numeric(12,2) not null default 0,
  total        numeric(12,2) generated always as (greatest(unit_price * quantity - discount, 0)) stored,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_cart_items_cart on public.cart_items (cart_id);

-- ---------------------------------------------------------------------
-- PEDIDOS
-- ---------------------------------------------------------------------
create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  order_number      text not null,
  status            order_status not null default 'aguardando_pagamento',
  buyer_kind        text not null default 'pessoa_fisica',   -- pessoa_fisica | pessoa_juridica
  buyer_user_id     uuid,
  buyer_name        text not null,
  buyer_document    text,
  buyer_email       citext,
  buyer_phone       text,
  company_id        uuid references public.companies(id) on delete set null,
  contract_id       uuid references public.company_contracts(id) on delete set null,
  shipping_zip      text,
  shipping_street   text,
  shipping_number   text,
  shipping_complement text,
  shipping_district text,
  shipping_city     text,
  shipping_state    char(2),
  subtotal          numeric(12,2) not null default 0,
  discount          numeric(12,2) not null default 0,
  shipping_amount   numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  coupon_id         uuid,
  payment_method    payment_method,
  payment_status    payment_status not null default 'pendente',
  requires_scheduling boolean not null default false,
  scheduling_done   boolean not null default false,
  origin            data_origin not null default 'ecommerce',
  notes             text,
  terms_accepted_at timestamptz,
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz,
  unique (tenant_id, order_number)
);
create index if not exists idx_orders_tenant_status on public.orders (tenant_id, status, created_at desc);
create index if not exists idx_orders_company on public.orders (company_id);

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  order_id       uuid not null references public.orders(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  patient_id     uuid references public.patients(id) on delete set null,
  beneficiary_name text,
  beneficiary_document text,
  beneficiary_birth_date date,
  product_name   text not null,
  product_kind   product_kind not null default 'exame',
  quantity       int not null default 1 check (quantity > 0),
  unit_price     numeric(12,2) not null,
  discount       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  requires_scheduling boolean not null default false,
  appointment_id uuid references public.appointments(id) on delete set null,
  fulfillment_status text not null default 'pendente', -- pendente | agendado | atendido | separado | enviado | entregue | cancelado
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items (order_id);

create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  reason      text,
  changed_by  uuid,
  is_manual   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_order_status_history_order on public.order_status_history (order_id, created_at);

-- ---------------------------------------------------------------------
-- CUPONS E PROMOCOES
-- ---------------------------------------------------------------------
create table if not exists public.coupons (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  code              citext not null,
  description       text,
  discount_kind     text not null default 'percentual',   -- percentual | valor
  discount_value    numeric(12,2) not null check (discount_value >= 0),
  minimum_amount    numeric(12,2) not null default 0,
  starts_at         timestamptz,
  ends_at           timestamptz,
  total_limit       int,
  per_buyer_limit   int,
  used_count        int not null default 0,
  allowed_products  uuid[],
  allowed_categories uuid[],
  allowed_companies uuid[],
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  unique (tenant_id, code)
);

create table if not exists public.coupon_usages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  coupon_id   uuid not null references public.coupons(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  user_id     uuid,
  buyer_document text,
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_coupon_usages_coupon on public.coupon_usages (coupon_id);

create table if not exists public.promotions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  description  text,
  banner_url   text,
  link         text,
  discount_kind text,
  discount_value numeric(12,2),
  product_ids  uuid[],
  category_ids uuid[],
  starts_at    timestamptz,
  ends_at      timestamptz,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  variant_id   uuid references public.product_variants(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  movement     text not null,   -- entrada | saida | ajuste | reserva | cancelamento
  quantity     int not null,
  balance_after int,
  reason       text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_inventory_movements_product on public.inventory_movements (product_id, created_at desc);

-- Chaves cruzadas adiadas ------------------------------------------------
alter table public.carts drop constraint if exists carts_coupon_fk;
alter table public.carts add constraint carts_coupon_fk
  foreign key (coupon_id) references public.coupons(id) on delete set null;

alter table public.orders drop constraint if exists orders_coupon_fk;
alter table public.orders add constraint orders_coupon_fk
  foreign key (coupon_id) references public.coupons(id) on delete set null;

alter table public.payments drop constraint if exists payments_order_fk;
alter table public.payments add constraint payments_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.payments drop constraint if exists payments_coupon_fk;
alter table public.payments add constraint payments_coupon_fk
  foreign key (coupon_id) references public.coupons(id) on delete set null;

alter table public.appointments drop constraint if exists appointments_order_fk;
alter table public.appointments add constraint appointments_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.attendances drop constraint if exists attendances_order_fk;
alter table public.attendances add constraint attendances_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.documents drop constraint if exists documents_order_fk;
alter table public.documents add constraint documents_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

alter table public.documents drop constraint if exists documents_payment_fk;
alter table public.documents add constraint documents_payment_fk
  foreign key (payment_id) references public.payments(id) on delete set null;

alter table public.patient_exams drop constraint if exists patient_exams_order_item_fk;
alter table public.patient_exams add constraint patient_exams_order_item_fk
  foreign key (order_item_id) references public.order_items(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array[
    'product_categories','products','product_variants','service_packages',
    'carts','cart_items','orders','order_items','coupons','promotions'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;
