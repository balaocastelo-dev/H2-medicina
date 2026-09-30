-- =====================================================================
-- 0053 - A trava do portal do paciente funciona onde importa
--
-- ---------------------------------------------------------------------
-- O defeito, que era meu e desta noite
-- ---------------------------------------------------------------------
-- As duas funcoes da 0048 chamam `digest(p_cpf, 'sha256')`, que vem do
-- pgcrypto, com `set search_path = public, pg_temp`.
--
-- No banco de teste isso funciona: a 0001 roda `create extension pgcrypto`
-- e a extensao cai em `public`. No Supabase hospedado o pgcrypto JA VEM
-- instalado, no schema `extensions` — logo o `create extension if not
-- exists` da 0001 e no-op e `digest` NAO esta em `public`.
--
-- Com o `search_path` sem `extensions`, as duas funcoes levantavam
-- "function digest(text, unknown) does not exist". E o codigo falha ABERTO:
-- `.rpc()` devolve `{ data: null, error }` sem lancar, o erro e descartado,
-- `null` nao e `false`, e a trava simplesmente nao contava nada.
--
-- Ou seja: a protecao contra forca bruta existia no teste e nao existia na
-- clinica, sem uma linha de log dizendo isso. O pior tipo de defeito.
--
-- ---------------------------------------------------------------------
-- A correcao: `sha256`, que e do proprio Postgres
-- ---------------------------------------------------------------------
-- `sha256(bytea)` e funcao NUCLEO do Postgres desde a versao 14 — nao
-- depende de extensao nenhuma, nao depende de qual schema alguem escolheu,
-- e da o mesmo resultado nos dois ambientes. Trocar por ela tira a
-- dependencia inteira em vez de remendar o `search_path`.
--
-- O digest muda de valor (mesma funcao, chamada diferente), entao as
-- tentativas ja registradas deixam de casar. Sao tentativas de login das
-- ultimas horas: a tabela e limpa junto, e ninguem fica preso por causa da
-- troca.
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- Contador zerado: os digests antigos nao casam mais com os novos, e
-- manter linhas que nunca serao consultadas so confunde quem for auditar.
delete from public.portal_login_attempts;


create or replace function public.portal_registrar_tentativa(
  p_tenant uuid,
  p_cpf    text,
  p_ok     boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digest text;
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  -- `sha256` e do nucleo do Postgres: nao depende de pgcrypto nem de em
  -- qual schema ele foi instalado.
  v_digest := encode(sha256(convert_to(p_cpf, 'UTF8')), 'hex');

  if p_ok then
    -- Entrou: o contador dele zera.
    delete from public.portal_login_attempts
     where tenant_id = p_tenant and cpf_digest = v_digest;
    insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
    values (p_tenant, v_digest, true);
    return true;
  end if;

  insert into public.portal_login_attempts (tenant_id, cpf_digest, succeeded)
  values (p_tenant, v_digest, false);

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = v_digest
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_registrar_tentativa(uuid, text, boolean) is
  'Conta tentativa de acesso ao portal do paciente e devolve false quando o CPF passou de cinco falhas em quinze minutos. Usa sha256 do nucleo do Postgres, nao pgcrypto.';


create or replace function public.portal_pode_tentar(
  p_tenant uuid,
  p_cpf    text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_falhas int;
begin
  if p_tenant is null or coalesce(p_cpf, '') = '' then
    return false;
  end if;

  select count(*) into v_falhas
    from public.portal_login_attempts
   where tenant_id = p_tenant
     and cpf_digest = encode(sha256(convert_to(p_cpf, 'UTF8')), 'hex')
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_pode_tentar(uuid, text) is
  'Consulta a trava do portal do paciente sem registrar tentativa.';


-- ---------------------------------------------------------------------
-- Prova que a funcao responde de verdade neste banco.
--
-- A 0048 nao tinha esta checagem, e foi por isso que o defeito passou: a
-- funcao existia, era chamavel, e falhava so na hora de executar. Aqui ela
-- e EXECUTADA na migration — se `sha256` nao existir neste Postgres, a
-- migration para com erro em vez de deixar a clinica sem trava.
-- ---------------------------------------------------------------------
do $$
declare
  v_tenant uuid;
  v_resposta boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  if v_tenant is null then
    raise notice 'Sem clinica cadastrada: trava do portal nao pode ser exercitada agora.';
    return;
  end if;

  -- CPF que nao existe em cadastro nenhum, so para exercitar a funcao.
  v_resposta := public.portal_pode_tentar(v_tenant, '00000000000');
  if v_resposta is null then
    raise exception 'portal_pode_tentar devolveu nulo: a trava do portal nao esta funcionando';
  end if;

  raise notice 'Trava do portal do paciente respondendo (pode tentar: %).', v_resposta;
end$$;
