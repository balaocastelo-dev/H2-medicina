-- =====================================================================
-- ZERAR O SISTEMA PARA O PRIMEIRO DIA DE USO
--
-- "zerar o sistema a ponto de comecar sem nada, os medicos ficam, todos
--  os pacientes cadastrados sai, todos os documentos gerados sai, todas
--  as empresas cadastradas sai." -- Isabella, 15/09.
--
-- ATENCAO: ISTO APAGA DADO DE VERDADE, E NAO TEM DESFAZER.
--
-- Antes de rodar:
--   1. Confirme com a clinica que nao ha atendimento real gravado que
--      precise ser guardado. Eles usaram o sistema em 14, 15 e 16/09.
--   2. Faca um backup no Supabase (Database > Backups) -- leva um minuto
--      e e a unica coisa entre voce e um "e agora?".
--
-- O que FICA:
--   - Usuarios e medicos, com suas permissoes e assinaturas
--   - Salas, exames, precos, procedimentos
--   - Configuracoes da clinica (endereco, telefone, logo, cores)
--
-- O que SAI:
--   - Pacientes, atendimentos, agendamentos, filas, senhas
--   - Documentos gerados e resultados de exame
--   - Empresas, contratos, valores e perfis de risco
--   - Movimento financeiro (cobrancas, repasses, contas)
--
-- Os arquivos em Storage nao sao apagados por SQL. Depois de rodar,
-- limpe o bucket clinical-documents pelo painel do Supabase, senao os
-- PDFs antigos continuam ocupando espaco (sem aparecer no sistema).
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_pacientes int;
  v_atendimentos int;
  v_documentos int;
  v_empresas int;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise exception 'Nenhum tenant cadastrado.';
  end if;

  select count(*) into v_pacientes    from public.patients    where tenant_id = v_tenant;
  select count(*) into v_atendimentos from public.attendances where tenant_id = v_tenant;
  select count(*) into v_documentos   from public.documents   where tenant_id = v_tenant;
  select count(*) into v_empresas     from public.companies   where tenant_id = v_tenant;

  raise notice 'Vou apagar: % paciente(s), % atendimento(s), % documento(s), % empresa(s).',
    v_pacientes, v_atendimentos, v_documentos, v_empresas;

  -- -------------------------------------------------------------------
  -- A ordem importa: filho antes do pai.
  --
  -- Muita coisa tem "on delete cascade", mas nao tudo. Apagar na ordem
  -- errada nao corrompe nada -- o banco recusa -- mas deixa o script pela
  -- metade, o que e pior do que nao ter rodado.
  --
  -- `to_regclass` em cada passo: a clinica pode nao ter todos os modulos
  -- ligados, e tabela que nao existe nao pode derrubar a limpeza.
  -- -------------------------------------------------------------------

  -- Movimento clinico
  if to_regclass('public.exam_results')     is not null then delete from public.exam_results     where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_exams')    is not null then delete from public.patient_exams    where tenant_id = v_tenant; end if;
  if to_regclass('public.triages')          is not null then delete from public.triages          where tenant_id = v_tenant; end if;
  if to_regclass('public.medical_consultations') is not null then delete from public.medical_consultations where tenant_id = v_tenant; end if;
  if to_regclass('public.medical_notes')    is not null then delete from public.medical_notes    where tenant_id = v_tenant; end if;

  -- Documentos e assinaturas
  if to_regclass('public.document_views')     is not null then delete from public.document_views     where tenant_id = v_tenant; end if;
  if to_regclass('public.documents')          is not null then delete from public.documents          where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_signatures') is not null then delete from public.patient_signatures where tenant_id = v_tenant; end if;

  -- Filas, senhas e painel
  if to_regclass('public.tv_calls')       is not null then delete from public.tv_calls       where tenant_id = v_tenant; end if;
  if to_regclass('public.queue_events')   is not null then delete from public.queue_events   where tenant_id = v_tenant; end if;
  if to_regclass('public.queue_tickets')  is not null then delete from public.queue_tickets  where tenant_id = v_tenant; end if;
  if to_regclass('public.crm_movements')  is not null then delete from public.crm_movements  where tenant_id = v_tenant; end if;

  -- Financeiro do movimento
  if to_regclass('public.fee_entries')  is not null then delete from public.fee_entries  where tenant_id = v_tenant; end if;
  if to_regclass('public.pix_charges')  is not null then delete from public.pix_charges  where tenant_id = v_tenant; end if;
  if to_regclass('public.payments')     is not null then delete from public.payments     where tenant_id = v_tenant; end if;
  if to_regclass('public.payables')     is not null then delete from public.payables     where tenant_id = v_tenant; end if;
  if to_regclass('public.cash_registers') is not null then delete from public.cash_registers where tenant_id = v_tenant; end if;

  -- Atendimento e agenda
  if to_regclass('public.attendances')  is not null then delete from public.attendances  where tenant_id = v_tenant; end if;
  if to_regclass('public.appointments') is not null then delete from public.appointments where tenant_id = v_tenant; end if;

  -- Importacoes
  if to_regclass('public.file_imports') is not null then delete from public.file_imports where tenant_id = v_tenant; end if;
  if to_regclass('public.scraper_runs') is not null then delete from public.scraper_runs where tenant_id = v_tenant; end if;

  -- Loja (se estiver ligada)
  if to_regclass('public.order_items')   is not null then delete from public.order_items   where tenant_id = v_tenant; end if;
  if to_regclass('public.orders')        is not null then delete from public.orders        where tenant_id = v_tenant; end if;
  if to_regclass('public.cart_items')    is not null then delete from public.cart_items    where tenant_id = v_tenant; end if;
  if to_regclass('public.carts')         is not null then delete from public.carts         where tenant_id = v_tenant; end if;
  if to_regclass('public.coupon_usages') is not null then delete from public.coupon_usages where tenant_id = v_tenant; end if;

  -- Paciente
  if to_regclass('public.patient_duplicates')  is not null then delete from public.patient_duplicates  where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_employments') is not null then delete from public.patient_employments where tenant_id = v_tenant; end if;
  if to_regclass('public.patients')            is not null then delete from public.patients            where tenant_id = v_tenant; end if;

  -- Empresa: contratos, valores e riscos saem junto
  if to_regclass('public.company_exam_prices')   is not null then delete from public.company_exam_prices   where tenant_id = v_tenant; end if;
  if to_regclass('public.company_risk_profiles') is not null then delete from public.company_risk_profiles where tenant_id = v_tenant; end if;
  if to_regclass('public.company_contracts')     is not null then delete from public.company_contracts     where tenant_id = v_tenant; end if;
  if to_regclass('public.company_contacts')      is not null then delete from public.company_contacts      where tenant_id = v_tenant; end if;
  if to_regclass('public.companies')             is not null then delete from public.companies             where tenant_id = v_tenant; end if;

  -- Marketing
  if to_regclass('public.email_events')      is not null then delete from public.email_events      where tenant_id = v_tenant; end if;
  if to_regclass('public.email_campaigns')   is not null then delete from public.email_campaigns   where tenant_id = v_tenant; end if;
  if to_regclass('public.campaign_recipients') is not null then delete from public.campaign_recipients where tenant_id = v_tenant; end if;

  -- -------------------------------------------------------------------
  -- Salas voltam a ficar livres.
  --
  -- Uma sala apontando para um atendimento que nao existe mais fica presa
  -- em "ocupada" e nao chama ninguem no primeiro dia.
  -- -------------------------------------------------------------------
  update public.rooms
     set status = 'disponivel', current_attendance_id = null
   where tenant_id = v_tenant;

  raise notice 'Pronto. Usuarios, medicos, salas, exames e configuracoes continuam no lugar.';
  raise notice 'Lembre de limpar o bucket clinical-documents no painel do Supabase.';
end$$;

-- ---------------------------------------------------------------------
-- Conferencia: tudo zero, menos o que devia ficar.
-- ---------------------------------------------------------------------
select 'pacientes'    as tabela, count(*) as restam from public.patients
union all select 'atendimentos', count(*) from public.attendances
union all select 'agendamentos', count(*) from public.appointments
union all select 'documentos',   count(*) from public.documents
union all select 'empresas',     count(*) from public.companies
union all select 'cobrancas',    count(*) from public.payments
union all select '— devem ficar —', null
union all select 'usuarios',     count(*) from public.profiles
union all select 'salas',        count(*) from public.rooms
union all select 'exames',       count(*) from public.exam_types
order by 1;
