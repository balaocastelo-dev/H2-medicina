-- =====================================================================
-- 0045 - Registros que nunca chegavam a ser gravados
--
-- Encontrados por uma auditoria independente das politicas de RLS cruzadas
-- com os papeis do seed. Os tres achados tem a mesma forma: a acao exige
-- uma permissao, passa, e depois grava numa tabela que exige OUTRA -- e o
-- resultado da gravacao nunca e conferido.
--
-- INSERT barrado pelo RLS levanta erro. Mas quando o erro nao e lido, ele
-- some dentro de um `catch` que so escreve no console do servidor. Para
-- quem usa o sistema, a acao deu certo.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A trilha de acesso a prontuario (LGPD) estava vazia desde sempre
--
-- `clinical_access_logs` exige `logs.ver` para LER e para ESCREVER. Ler e
-- certo: essa trilha e material de auditoria. Escrever, nao -- quem escreve
-- e justamente quem abriu o prontuario, e nenhum papel clinico tem
-- `logs.ver`. Entao toda gravacao era barrada.
--
-- O efeito e o pior possivel para o que a tabela existe: ela nao registrou
-- nenhum acesso, e e ela que responde "quem abriu o prontuario deste
-- paciente" quando o titular pergunta.
--
-- A resposta nao e dar `logs.ver` a todo mundo -- isso deixaria qualquer um
-- LER a trilha. E uma funcao que so sabe ESCREVER, e que grava sempre em
-- nome de quem esta logado.
-- ---------------------------------------------------------------------
create or replace function public.registrar_acesso_clinico(
  p_tenant uuid,
  p_patient uuid,
  p_context text,
  p_reference uuid default null,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sem sessao nao ha acesso a registrar.
  if auth.uid() is null then return; end if;

  -- So registra acesso dentro da propria clinica: a funcao passa por cima
  -- do RLS, entao a checagem de tenant precisa estar escrita aqui.
  if not public.belongs_to_tenant(p_tenant) then return; end if;

  -- `ip_address` e do tipo `inet`, e o endereco chega como texto vindo do
  -- cabecalho `x-forwarded-for`. O cast e explicito porque o Postgres nao
  -- converte texto para inet sozinho neste contexto -- e um endereco mal
  -- formado nao pode derrubar o registro do acesso, que e o que importa
  -- aqui: por isso a conversao acontece dentro de um bloco que, falhando,
  -- grava o acesso sem o IP.
  begin
    insert into public.clinical_access_logs
      (tenant_id, user_id, patient_id, context, reference_id, ip_address, user_agent)
    values (p_tenant, auth.uid(), p_patient, p_context, p_reference,
            nullif(trim(coalesce(p_ip, '')), '')::inet, p_user_agent);
  exception when others then
    insert into public.clinical_access_logs
      (tenant_id, user_id, patient_id, context, reference_id, ip_address, user_agent)
    values (p_tenant, auth.uid(), p_patient, p_context, p_reference, null, p_user_agent);
  end;
end$$;

comment on function public.registrar_acesso_clinico(uuid, uuid, text, uuid, text, text) is
  'Grava um acesso a dado clinico em nome de quem esta logado. Escreve sem poder ler: a trilha continua visivel so para quem tem logs.ver.';

grant execute on function public.registrar_acesso_clinico(uuid, uuid, text, uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. O consentimento LGPD se perdia quando quem emitia o termo era o medico
--
-- `patient_consents` exige `pacientes.editar` para gravar. Quem emite o
-- termo de autorizacao tem `documentos.emitir` -- o medico tem uma e nao a
-- outra. Pela recepcao funcionava, o que escondia o defeito: o termo saia,
-- a assinatura era gravada, e o registro de consentimento -- o que se
-- procura quando o titular pergunta o que autorizou -- nao existia.
--
-- Emitir o termo E o ato que cria o consentimento. Quem pode emitir precisa
-- poder registrar.
-- ---------------------------------------------------------------------
drop policy if exists tenant_write on public.patient_consents;
create policy tenant_write on public.patient_consents for all to authenticated
  using (
    public.can_access_any(tenant_id, array['pacientes.editar','documentos.emitir'])
  )
  with check (
    public.can_access_any(tenant_id, array['pacientes.editar','documentos.emitir'])
  );


-- ---------------------------------------------------------------------
-- 3. Anexos de exame: nenhum papel conseguia anexar E ver
--
-- `patient_attachments` exige `clinico.ver` para ler e `exames.preencher`
-- para gravar. A acao exigia `pacientes.editar`, que e de outro eixo:
--
--   - `atendimento` tem `pacientes.editar`, passa na acao, e entao NAO
--     consegue gravar nem enxergar o que anexou. O upload subia para o
--     balde e o registro nao entrava: arquivo orfao;
--   - `medico_examinador` tem `clinico.ver` e `exames.preencher`, ou seja,
--     tudo que o RLS pede -- e era barrado na porta, pela acao.
--
-- Anexar resultado de exame e ato clinico. A acao passa a exigir
-- `exames.preencher`, que e o que o RLS ja exigia, e os dois lados voltam a
-- falar a mesma lingua. Nada muda aqui no banco; o conserto e na aplicacao,
-- e esta anotado para quem for ler esta migration procurando o par.
-- ---------------------------------------------------------------------


do $$
declare v_logs int;
begin
  select count(*) into v_logs from public.clinical_access_logs;
  raise notice 'Acessos clinicos registrados ate agora: % (esperado zero antes desta correcao)', v_logs;
end$$;
