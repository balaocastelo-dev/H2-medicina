-- =====================================================================
-- 0048 - O portal do paciente para de entregar o prontuario
--
-- ---------------------------------------------------------------------
-- O que a auditoria encontrou
-- ---------------------------------------------------------------------
-- O portal (`/meu`) autentica com CPF + data de nascimento. Sem senha,
-- sem token, sem limite de tentativas.
--
-- No Brasil o CPF nao e segredo. Sobra adivinhar a data de nascimento:
-- uma janela de trinta anos sao ~11 mil tentativas, e nada no sistema
-- contava tentativa nenhuma.
--
-- E o que se alcancava depois de entrar era tudo: todo gerador de
-- documento gravava `is_patient_visible = true` fixo, entao a ficha
-- clinica (pressao, IMC, glicemia, antecedentes, estilo de vida) e a
-- avaliacao psicossocial vinham em PDF junto com o recibo.
--
-- Pior detalhe: CPF e data de nascimento sao os dois campos impressos no
-- A.S.O. que a clinica entrega ao RH da empresa. Quem recebia aquele
-- papel tinha, em maos, a credencial do portal.
--
-- Esta migration faz as duas metades do banco. A outra metade esta no
-- codigo: cada gerador passou a decidir a visibilidade por tipo de
-- documento (`src/modules/documents/visivel-ao-paciente.ts`).
--
-- Pode ser executada mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Documento clinico sai do portal — inclusive o que ja foi emitido
--
-- Retroativo de proposito: o estrago nao esta nos documentos de amanha,
-- esta nos que ja estao gravados com `true`.
--
-- A lista de tipos que FICAM e a mesma do codigo. Todos sao papel de
-- balcao: comprovam presenca, pagamento, agendamento, ou devolvem ao
-- paciente algo que ele proprio assinou.
-- ---------------------------------------------------------------------
update public.documents
   set is_patient_visible = false
 where is_patient_visible = true
   and kind::text not in (
     'recibo',
     'comprovante_comparecimento',
     'atestado_comparecimento',
     'comprovante_agendamento',
     'comprovante_compra',
     'resumo_pedido',
     'guia_exame',
     'autorizacao_envio_resultados'
   );


-- ---------------------------------------------------------------------
-- 2. Trava de tentativas
--
-- Guarda a tentativa, nao a credencial: o CPF entra como digest SHA-256,
-- que serve para contar tentativas do mesmo CPF e nao serve para montar
-- lista de CPF nenhum. A data de nascimento nao e guardada.
--
-- A contagem e por CPF porque e assim que o ataque acontece: mesmo CPF,
-- muitas datas.
-- ---------------------------------------------------------------------
create table if not exists public.portal_login_attempts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  cpf_digest  text not null,
  succeeded   boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists portal_login_attempts_janela
  on public.portal_login_attempts (tenant_id, cpf_digest, attempted_at desc);

alter table public.portal_login_attempts enable row level security;
alter table public.portal_login_attempts force row level security;

-- Ninguem le esta tabela pela API: ela existe para a funcao abaixo, que e
-- SECURITY DEFINER. Sem policy de select, `anon` e `authenticated` nao
-- alcancam o historico de tentativas.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'portal_login_attempts'
       and policyname = 'portal_attempts_admin_read'
  ) then
    create policy portal_attempts_admin_read
      on public.portal_login_attempts
      for select
      using (public.can_access(tenant_id, 'usuarios.administrar'));
  end if;
end$$;


-- ---------------------------------------------------------------------
-- Conta a tentativa e diz se ainda pode tentar.
--
-- Cinco falhas em quinze minutos fecham a porta para aquele CPF. Acerto
-- limpa o historico — quem entrou nao esta atacando ninguem.
--
-- Registra ANTES de responder, para que a propria chamada bloqueada
-- conte: senao bastaria insistir para nunca passar do quinto.
-- ---------------------------------------------------------------------
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

  v_digest := encode(digest(p_cpf, 'sha256'), 'hex');

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
  'Conta tentativa de acesso ao portal do paciente e devolve false quando o CPF passou de cinco falhas em quinze minutos.';


-- ---------------------------------------------------------------------
-- Diz se aquele CPF esta cumprindo trava, sem contar tentativa nova.
--
-- Chamada ANTES de conferir CPF e nascimento: bloqueado nao chega ao
-- banco de pacientes.
-- ---------------------------------------------------------------------
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
     and cpf_digest = encode(digest(p_cpf, 'sha256'), 'hex')
     and succeeded = false
     and attempted_at > now() - interval '15 minutes';

  return v_falhas < 5;
end$$;

comment on function public.portal_pode_tentar(uuid, text) is
  'Consulta a trava do portal do paciente sem registrar tentativa.';


-- ---------------------------------------------------------------------
-- 3. /verificar passa a olhar a clinica
--
-- A pagina publica de verificacao consultava `documents` so pelo codigo,
-- com a chave de servico e sem filtro de tenant: o codigo de OUTRA
-- clinica era apresentado como documento autentico sob o nome desta. A
-- correcao esta no codigo (`src/app/verificar/page.tsx`); o indice abaixo
-- so faz a consulta com os dois campos ficar barata.
-- ---------------------------------------------------------------------
create index if not exists documents_verificacao_por_clinica
  on public.documents (tenant_id, verification_code)
  where verification_code is not null;


do $$
declare v_fechados int; v_abertos int;
begin
  select count(*) into v_fechados from public.documents where is_patient_visible = false;
  select count(*) into v_abertos  from public.documents where is_patient_visible = true;
  raise notice 'Portal do paciente: % documentos fora do portal, % mantidos (administrativos).',
    v_fechados, v_abertos;
end$$;
