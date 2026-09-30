-- =====================================================================
-- ZERAR O MOVIMENTO -- tira todo o teste, mantem o cadastro
--
-- ATENCAO: ISTO APAGA DADO DE VERDADE, E NAO TEM DESFAZER.
--
-- Antes de rodar: Supabase > Database > Backups. Leva um minuto e e a
-- unica coisa entre voce e um "e agora?".
--
-- ---------------------------------------------------------------------
-- O que SAI
-- ---------------------------------------------------------------------
--   Pacientes e tudo que esta pendurado neles: atendimentos,
--   agendamentos, filas, senhas, chamadas de TV, exames feitos,
--   triagens, consultas, anexos, consentimentos, assinaturas.
--   Documentos gerados e quem os abriu.
--   Todo o movimento financeiro: cobrancas, Pix, repasses, contas.
--   A trilha de auditoria e o registro de acesso clinico.
--
-- ---------------------------------------------------------------------
-- O que FICA
-- ---------------------------------------------------------------------
--   Usuarios e medicos, com permissoes e assinaturas.
--   EMPRESAS, com contratos, valores negociados e perfis de risco.
--   Salas, exames, precos de tabela, procedimentos de repasse.
--   Configuracoes da clinica: endereco, telefone, logo, cores, Pix.
--
-- Para apagar tambem as empresas, use ZERAR-PARA-O-PRIMEIRO-DIA.sql.
--
-- ---------------------------------------------------------------------
-- O que o SQL nao alcanca
-- ---------------------------------------------------------------------
--   Os PDFs ja gerados continuam no Storage. Depois de rodar, limpe o
--   bucket `clinical-documents` pelo painel do Supabase -- senao eles
--   ficam ocupando espaco sem aparecer em lugar nenhum do sistema.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_pacientes int;
  v_atendimentos int;
  v_documentos int;
  v_cobrancas int;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise exception 'Nenhuma clinica cadastrada neste banco.';
  end if;

  select count(*) into v_pacientes    from public.patients    where tenant_id = v_tenant;
  select count(*) into v_atendimentos from public.attendances where tenant_id = v_tenant;
  select count(*) into v_documentos   from public.documents   where tenant_id = v_tenant;
  select count(*) into v_cobrancas    from public.payments    where tenant_id = v_tenant;

  raise notice 'Vou apagar: % paciente(s), % atendimento(s), % documento(s), % cobranca(s).',
    v_pacientes, v_atendimentos, v_documentos, v_cobrancas;

  -- -------------------------------------------------------------------
  -- A ordem importa: filho antes do pai.
  --
  -- Muita coisa tem `on delete cascade`, mas nao tudo. Apagar na ordem
  -- errada nao corrompe nada (o banco recusa), mas deixa o script pela
  -- metade -- o que e pior do que nao ter rodado.
  --
  -- `to_regclass` em cada passo: a clinica pode nao ter todos os modulos
  -- ligados, e tabela que nao existe nao pode derrubar a limpeza.
  -- -------------------------------------------------------------------

  -- Movimento clinico
  if to_regclass('public.exam_results')          is not null then delete from public.exam_results          where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_exams')         is not null then delete from public.patient_exams         where tenant_id = v_tenant; end if;
  if to_regclass('public.triages')               is not null then delete from public.triages               where tenant_id = v_tenant; end if;
  if to_regclass('public.medical_consultations') is not null then delete from public.medical_consultations where tenant_id = v_tenant; end if;
  if to_regclass('public.medical_notes')         is not null then delete from public.medical_notes         where tenant_id = v_tenant; end if;

  -- Documentos e assinaturas
  if to_regclass('public.document_views')     is not null then delete from public.document_views     where tenant_id = v_tenant; end if;
  if to_regclass('public.documents')          is not null then delete from public.documents          where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_signatures') is not null then delete from public.patient_signatures where tenant_id = v_tenant; end if;
  -- Anexo de exame laudado depois. Faltava no script antigo: o arquivo
  -- sumia do Storage na limpeza manual e a linha ficava apontando para
  -- um paciente que nao existia mais.
  if to_regclass('public.patient_attachments') is not null then delete from public.patient_attachments where tenant_id = v_tenant; end if;

  -- Filas, senhas e painel
  if to_regclass('public.tv_calls')      is not null then delete from public.tv_calls      where tenant_id = v_tenant; end if;
  if to_regclass('public.queue_events')  is not null then delete from public.queue_events  where tenant_id = v_tenant; end if;
  if to_regclass('public.queue_tickets') is not null then delete from public.queue_tickets where tenant_id = v_tenant; end if;
  if to_regclass('public.crm_movements') is not null then delete from public.crm_movements where tenant_id = v_tenant; end if;

  -- Financeiro do movimento.
  --
  -- `payment_transactions` e `pix_charges` caem junto com `payments` por
  -- cascade; ficam aqui assim mesmo para o caso de alguem ter mexido nas
  -- chaves depois.
  if to_regclass('public.payment_transactions') is not null then delete from public.payment_transactions where tenant_id = v_tenant; end if;
  if to_regclass('public.fee_entries')          is not null then delete from public.fee_entries          where tenant_id = v_tenant; end if;
  if to_regclass('public.pix_charges')          is not null then delete from public.pix_charges          where tenant_id = v_tenant; end if;
  if to_regclass('public.payments')             is not null then delete from public.payments             where tenant_id = v_tenant; end if;
  if to_regclass('public.payables')             is not null then delete from public.payables             where tenant_id = v_tenant; end if;
  if to_regclass('public.cash_registers')       is not null then delete from public.cash_registers       where tenant_id = v_tenant; end if;

  -- Atendimento e agenda
  if to_regclass('public.appointment_exams') is not null then delete from public.appointment_exams where tenant_id = v_tenant; end if;
  if to_regclass('public.attendances')       is not null then delete from public.attendances       where tenant_id = v_tenant; end if;
  if to_regclass('public.appointments')      is not null then delete from public.appointments      where tenant_id = v_tenant; end if;

  -- Avisos e pedidos do paciente
  if to_regclass('public.notifications')          is not null then delete from public.notifications          where tenant_id = v_tenant; end if;
  if to_regclass('public.data_subject_requests')  is not null then delete from public.data_subject_requests  where tenant_id = v_tenant; end if;
  if to_regclass('public.scraper_import_reviews') is not null then delete from public.scraper_import_reviews where tenant_id = v_tenant; end if;

  -- Importacoes
  if to_regclass('public.file_imports') is not null then delete from public.file_imports where tenant_id = v_tenant; end if;
  if to_regclass('public.scraper_runs') is not null then delete from public.scraper_runs where tenant_id = v_tenant; end if;

  -- Loja (se estiver ligada)
  if to_regclass('public.order_items')   is not null then delete from public.order_items   where tenant_id = v_tenant; end if;
  if to_regclass('public.orders')        is not null then delete from public.orders        where tenant_id = v_tenant; end if;
  if to_regclass('public.cart_items')    is not null then delete from public.cart_items    where tenant_id = v_tenant; end if;
  if to_regclass('public.carts')         is not null then delete from public.carts         where tenant_id = v_tenant; end if;
  if to_regclass('public.coupon_usages') is not null then delete from public.coupon_usages where tenant_id = v_tenant; end if;

  -- Paciente e o que e so dele
  if to_regclass('public.patient_consents')    is not null then delete from public.patient_consents    where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_duplicates')  is not null then delete from public.patient_duplicates  where tenant_id = v_tenant; end if;
  if to_regclass('public.patient_employments') is not null then delete from public.patient_employments where tenant_id = v_tenant; end if;
  if to_regclass('public.patients')            is not null then delete from public.patients            where tenant_id = v_tenant; end if;

  -- Marketing
  if to_regclass('public.email_events')        is not null then delete from public.email_events        where tenant_id = v_tenant; end if;
  if to_regclass('public.campaign_recipients') is not null then delete from public.campaign_recipients where tenant_id = v_tenant; end if;
  if to_regclass('public.email_campaigns')     is not null then delete from public.email_campaigns     where tenant_id = v_tenant; end if;

  -- -------------------------------------------------------------------
  -- Trilhas do periodo de teste.
  --
  -- A auditoria guarda o nome do paciente na descricao; sem isto, a tela
  -- de auditoria abre no primeiro dia cheia dos testes. O registro de
  -- acesso clinico (LGPD) sai pelo mesmo motivo.
  --
  -- Vao por ultimo de proposito: assim a limpeza acima ja aconteceu e o
  -- que sobrar de auditoria e desta operacao em diante.
  -- -------------------------------------------------------------------
  if to_regclass('public.clinical_access_logs') is not null then delete from public.clinical_access_logs where tenant_id = v_tenant; end if;
  if to_regclass('public.audit_logs')           is not null then delete from public.audit_logs           where tenant_id = v_tenant; end if;

  -- Contador de tentativas do portal do paciente: sao tentativas de
  -- login do teste, e manter so atrapalharia quem for entrar amanha.
  if to_regclass('public.portal_login_attempts') is not null then delete from public.portal_login_attempts where tenant_id = v_tenant; end if;

  -- -------------------------------------------------------------------
  -- Salas voltam a ficar livres.
  --
  -- Sala apontando para um atendimento que nao existe mais fica presa em
  -- "ocupada" e nao chama ninguem no primeiro dia.
  -- -------------------------------------------------------------------
  update public.rooms
     set status = 'disponivel', current_attendance_id = null
   where tenant_id = v_tenant;

  raise notice 'Pronto. Usuarios, medicos, EMPRESAS, salas, exames e configuracoes continuam no lugar.';
  raise notice 'Lembre de limpar o bucket clinical-documents no painel do Supabase.';
end$$;


-- ---------------------------------------------------------------------
-- Conferencia: o de cima tem de vir zero; o de baixo, nao.
-- ---------------------------------------------------------------------
select '1. deve estar zero' as bloco, 'pacientes'    as item, count(*) as quantos from public.patients
union all select '1. deve estar zero', 'atendimentos', count(*) from public.attendances
union all select '1. deve estar zero', 'agendamentos', count(*) from public.appointments
union all select '1. deve estar zero', 'documentos',   count(*) from public.documents
union all select '1. deve estar zero', 'cobrancas',    count(*) from public.payments
union all select '1. deve estar zero', 'repasses',     count(*) from public.fee_entries
union all select '1. deve estar zero', 'salas ocupadas', count(*) from public.rooms where status = 'ocupada'
union all select '2. deve continuar',  'usuarios',     count(*) from public.profiles
union all select '2. deve continuar',  'empresas',     count(*) from public.companies
union all select '2. deve continuar',  'salas',        count(*) from public.rooms
union all select '2. deve continuar',  'exames',       count(*) from public.exam_types
union all select '2. deve continuar',  'procedimentos', count(*) from public.procedure_types
order by 1, 2;
