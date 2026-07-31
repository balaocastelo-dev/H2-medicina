-- =====================================================================
-- 0002 - Tenants, white label, identidade, papeis e permissoes
-- =====================================================================

-- ---------------------------------------------------------------------
-- TENANTS
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            citext not null unique,
  legal_name      text not null,
  trade_name      text not null,
  document        text,
  is_active       boolean not null default true,
  primary_domain  text,
  timezone        text not null default 'America/Sao_Paulo',
  locale          text not null default 'pt-BR',
  currency        text not null default 'BRL',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint tenants_document_valid
    check (document is null or public.is_valid_cnpj(document) or public.is_valid_cpf(document))
);
create index if not exists idx_tenants_active on public.tenants (is_active) where deleted_at is null;

-- Configuracoes gerais (chave/valor tipado por grupo) -------------------
create table if not exists public.tenant_settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  group_key   text not null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, group_key)
);
comment on table public.tenant_settings is
  'Configuracoes editaveis pelo painel. group_key: empresa, contato, documentos, responsavel_tecnico, totem, painel_tv, filas, ecommerce, scraper, email, ia, pagamento, app, institucional.';

-- Marca / identidade visual --------------------------------------------
create table if not exists public.tenant_branding (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  system_name      text not null default 'Sistema Clinico',
  logo_url         text,
  logo_compact_url text,
  favicon_url      text,
  color_primary    text not null default '#0F766E',
  color_secondary  text not null default '#0EA5E9',
  color_accent     text not null default '#F59E0B',
  color_sidebar    text not null default '#0B1220',
  footer_text      text,
  pdf_header_html  text,
  pdf_footer_html  text,
  login_background_url text,
  status_colors    jsonb not null default jsonb_build_object(
    'aguardando','#9CA3AF',
    'chamado','#FACC15',
    'pendente','#FB923C',
    'em_atendimento','#3B82F6',
    'concluido','#22C55E',
    'alerta','#EF4444',
    'aguardando_medico','#A855F7',
    'cancelado','#4B5563'
  ),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Modulos habilitados ---------------------------------------------------
create table if not exists public.tenant_modules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  module_key  text not null,
  is_enabled  boolean not null default true,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, module_key)
);

-- ---------------------------------------------------------------------
-- IDENTIDADE
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  tenant_id         uuid references public.tenants(id) on delete set null,
  full_name         text not null default '',
  email             citext,
  phone             text,
  avatar_url        text,
  job_title         text,
  council_type      text,               -- CRM, COREN, etc.
  council_number    text,
  council_state     text,
  signature_url     text,
  is_active         boolean not null default true,
  is_platform_admin boolean not null default false,
  blocked_at        timestamptz,
  blocked_reason    text,
  last_sign_in_at   timestamptz,
  must_change_password boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz
);
create index if not exists idx_profiles_tenant on public.profiles (tenant_id) where deleted_at is null;

-- Papeis ---------------------------------------------------------------
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  code         text not null,
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Catalogo global de permissoes ----------------------------------------
create table if not exists public.permissions (
  code        text primary key,
  module      text not null,
  name        text not null,
  description text,
  is_sensitive boolean not null default false
);

create table if not exists public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, role_id)
);

-- Permissoes concedidas/revogadas individualmente ----------------------
create table if not exists public.user_permissions (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  is_granted      boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  primary key (user_id, permission_code)
);

-- Convites --------------------------------------------------------------
create table if not exists public.user_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       citext not null,
  full_name   text,
  role_id     uuid references public.roles(id) on delete set null,
  token_hash  text not null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (tenant_id, email, token_hash)
);

-- Sessoes/auditoria de acesso -------------------------------------------
create table if not exists public.auth_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete set null,
  user_id     uuid,
  email       citext,
  event       text not null,       -- login, logout, login_failed, password_reset, blocked
  ip_address  inet,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_auth_events_tenant_date on public.auth_events (tenant_id, created_at desc);

-- ---------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tenants','tenant_settings','tenant_branding','tenant_modules',
    'profiles','roles'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Helpers de seguranca (usados por todas as policies de RLS)
-- ---------------------------------------------------------------------

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_platform_admin and is_active and deleted_at is null
                   from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_active and blocked_at is null and deleted_at is null
                   from public.profiles where id = auth.uid()), false);
$$;

-- Pertence ao tenant informado (admin da plataforma passa em qualquer um)
create or replace function public.belongs_to_tenant(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
     and (public.is_platform_admin() or target = public.current_tenant_id());
$$;

-- Permissao efetiva = (papel concede OU concessao individual) E nao revogada
create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user() and (
    public.is_platform_admin()
    or (
      not exists (
        select 1 from public.user_permissions up
        where up.user_id = auth.uid() and up.permission_code = perm and up.is_granted = false
      )
      and (
        exists (
          select 1
          from public.user_roles ur
          join public.role_permissions rp on rp.role_id = ur.role_id
          where ur.user_id = auth.uid() and rp.permission_code = perm
        )
        or exists (
          select 1 from public.user_permissions up
          where up.user_id = auth.uid() and up.permission_code = perm and up.is_granted = true
        )
      )
    )
  );
$$;

-- Acesso a um registro do tenant exigindo permissao
create or replace function public.can_access(target_tenant uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.belongs_to_tenant(target_tenant) and public.has_permission(perm);
$$;

comment on function public.has_permission is
  'Permissao efetiva do usuario autenticado. Revogacao individual sempre prevalece sobre o papel.';
