-- =====================================================================
-- 0015 - Segredos em schema privado
--
-- Motivo: no PostgREST/Supabase o papel `authenticated` recebe GRANT de
-- SELECT no nivel da TABELA. Um `revoke select (coluna)` nao tem efeito
-- nesse cenario — a coluna continua legivel. A unica barreira confiavel e
-- manter o segredo fora do schema exposto pela API.
--
-- O schema `private` nao e exposto pelo PostgREST e nao recebe grants.
-- Somente a service role (backend) e funcoes SECURITY DEFINER acessam.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Credenciais dos conectores de importacao --------------------------------
create table if not exists private.connector_secrets (
  connector_id       uuid primary key references public.scraper_connectors(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  password_encrypted bytea,
  extra_secrets      jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

-- Credenciais dos provedores (e-mail, IA, pagamento) ----------------------
create table if not exists private.provider_secrets (
  provider_setting_id uuid primary key references public.provider_settings(id) on delete cascade,
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  secret_encrypted    bytea,
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);

alter table private.connector_secrets enable row level security;
alter table private.provider_secrets enable row level security;
-- Sem policies: nenhum usuario autenticado acessa. Somente service role.

-- Migra dados existentes e remove as colunas do schema publico ------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'scraper_connectors'
       and column_name = 'password_encrypted'
  ) then
    insert into private.connector_secrets (connector_id, tenant_id, password_encrypted)
    select id, tenant_id, password_encrypted
      from public.scraper_connectors
     where password_encrypted is not null
    on conflict (connector_id) do nothing;

    drop view if exists public.scraper_connectors_safe;
    alter table public.scraper_connectors drop column password_encrypted;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'provider_settings'
       and column_name = 'secret_encrypted'
  ) then
    insert into private.provider_secrets (provider_setting_id, tenant_id, secret_encrypted)
    select id, tenant_id, secret_encrypted
      from public.provider_settings
     where secret_encrypted is not null
    on conflict (provider_setting_id) do nothing;

    drop view if exists public.provider_settings_safe;
    alter table public.provider_settings drop column secret_encrypted;
  end if;
end$$;

-- Views seguras (agora indicam apenas se existe segredo) ------------------
create or replace view public.scraper_connectors_safe
with (security_invoker = true) as
select c.id, c.tenant_id, c.code, c.name, c.kind, c.base_url, c.agenda_url, c.auth_kind, c.username,
       exists (select 1 from private.connector_secrets s
                where s.connector_id = c.id and s.password_encrypted is not null) as has_password,
       c.extra_fields, c.navigation_rules, c.pagination_rules, c.date_filter_rules,
       c.timezone, c.schedule_cron, c.run_mode, c.auto_approve, c.authorization_confirmed,
       c.authorization_note, c.is_active, c.last_run_at, c.next_run_at,
       c.created_at, c.updated_at
from public.scraper_connectors c
where c.deleted_at is null;

create or replace view public.provider_settings_safe
with (security_invoker = true) as
select p.id, p.tenant_id, p.category, p.provider, p.is_active, p.is_default, p.public_config,
       exists (select 1 from private.provider_secrets s
                where s.provider_setting_id = p.id and s.secret_encrypted is not null) as has_secret,
       p.status, p.last_checked_at, p.created_at, p.updated_at
from public.provider_settings p;

grant select on public.scraper_connectors_safe to authenticated;
grant select on public.provider_settings_safe to authenticated;

-- Grava a senha do conector cifrada, sem nunca devolve-la -------------------
create or replace function public.set_connector_password(
  p_connector uuid, p_password text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.scraper_connectors where id = p_connector;
  if v_tenant is null then
    raise exception 'Conector nao encontrado' using errcode = 'P0002';
  end if;
  if not public.can_access(v_tenant, 'scraper.administrar') then
    raise exception 'Sem permissao para configurar conectores' using errcode = '42501';
  end if;

  insert into private.connector_secrets (connector_id, tenant_id, password_encrypted, updated_by)
  values (p_connector, v_tenant, pgp_sym_encrypt(p_password, p_key), auth.uid())
  on conflict (connector_id) do update
    set password_encrypted = excluded.password_encrypted,
        updated_at = now(),
        updated_by = excluded.updated_by;
end$$;

grant execute on function public.set_connector_password(uuid, text, text) to authenticated;

comment on schema private is
  'Schema nao exposto pela API. Guarda segredos que jamais podem chegar ao navegador.';
