-- =====================================================================
-- SEED 0001 - Primeiro tenant da plataforma
-- Estes sao DADOS, nao codigo. Nenhum valor aqui esta fixado na aplicacao:
-- tudo e editavel em Configuracoes da Empresa.
-- =====================================================================

do $$
declare
  v_tenant uuid;
  v_role_medico uuid;
  v_role_admin uuid;
  v_role_atendimento uuid;
  v_room_recepcao uuid;
  v_room_triagem uuid;
  v_room_audio uuid;
  v_room_ecg uuid;
  v_room_eeg uuid;
  v_room_espiro uuid;
  v_room_lab uuid;
  v_room_dinamo uuid;
  v_room_consultorio uuid;
  v_cat_ocupacional uuid;
  v_cat_exames uuid;
  v_cat_pacotes uuid;
  v_product uuid;
  v_package uuid;
begin
  -- ---------------- TENANT ----------------
  insert into public.tenants (slug, legal_name, trade_name, timezone, locale, currency, is_active)
  values ('h2', 'H2 Medicina Ocupacional', 'H2 Medicina Ocupacional', 'America/Sao_Paulo', 'pt-BR', 'BRL', true)
  on conflict (slug) do update set trade_name = excluded.trade_name
  returning id into v_tenant;

  if v_tenant is null then
    select id into v_tenant from public.tenants where slug = 'h2';
  end if;

  -- ---------------- MARCA ----------------
  insert into public.tenant_branding (tenant_id, system_name, color_primary, color_secondary, color_accent, color_sidebar, footer_text)
  values (v_tenant, 'H2 Medicina Ocupacional', '#0F766E', '#0EA5E9', '#F59E0B', '#0B1220',
          'Desenvolvido pelo Balao da Informatica')
  on conflict (tenant_id) do update
    set system_name = excluded.system_name, footer_text = excluded.footer_text;

  -- ---------------- CONFIGURACOES (todas editaveis no painel) ----------------
  insert into public.tenant_settings (tenant_id, group_key, settings) values
    (v_tenant, 'empresa', jsonb_build_object(
      'razao_social','H2 Medicina Ocupacional',
      'nome_fantasia','H2 Medicina Ocupacional',
      'cnpj', null, 'inscricao_municipal', null, 'site', null, 'dominio', null)),
    (v_tenant, 'contato', jsonb_build_object(
      'telefone', null, 'whatsapp', null, 'email', null,
      'cep', null, 'logradouro', null, 'numero', null, 'complemento', null,
      'bairro', null, 'cidade', null, 'estado', null)),
    (v_tenant, 'responsavel_tecnico', jsonb_build_object(
      'nome','Dra. Wania Sanches Picasso',
      'conselho','CRM', 'numero', null, 'uf', null, 'assinatura_url', null)),
    (v_tenant, 'documentos', jsonb_build_object(
      'cabecalho', null, 'rodape', null,
      'codigo_verificacao_ativo', true,
      'url_verificacao', '/verificar')),
    (v_tenant, 'institucional', jsonb_build_object(
      'politica_privacidade', null, 'termos_uso', null, 'sobre', null)),
    (v_tenant, 'totem', jsonb_build_object(
      'prefixos', jsonb_build_object('normal','A','prioritario','P','encaixe','E'),
      'tempo_reinicio_segundos', 45,
      'imprimir_etiqueta', true,
      'mostrar_instrucoes', true,
      'instrucoes','Informe seu CPF para localizar o agendamento.')),
    (v_tenant, 'painel_tv', jsonb_build_object(
      'quantidade_ultimas_chamadas', 5,
      'tempo_exibicao_segundos', 20,
      'aviso_sonoro', true,
      'volume', 0.8,
      'voz', 'pt-BR',
      'exibir_nome_parcial', true)),
    (v_tenant, 'filas', jsonb_build_object(
      'exige_triagem', true,
      'recepcao_obrigatoria', true,
      'ordem_fixa_exames', false,
      'peso_prioridade', 10,
      'peso_tempo_espera', 1)),
    (v_tenant, 'ecommerce', jsonb_build_object(
      'loja_ativa', true, 'nome_loja','Loja H2',
      'permite_compra_empresarial', true,
      'exige_login_checkout', false,
      'texto_checkout', null)),
    (v_tenant, 'pagamento', jsonb_build_object(
      'chave_pix', null, 'tipo_chave', 'aleatoria',
      'beneficiario', 'H2 MEDICINA OCUPACIONAL', 'cidade', 'SAO PAULO',
      'modo', 'manual', 'gateway', null)),
    (v_tenant, 'email', jsonb_build_object('provedor','manual','remetente', null, 'nome_remetente', null)),
    (v_tenant, 'ia', jsonb_build_object('provedor','template','modelo', null)),
    (v_tenant, 'scraper', jsonb_build_object('modo_padrao','teste','aprovacao_humana', true)),
    (v_tenant, 'app', jsonb_build_object('nome','H2 Paciente','permite_documentos', true, 'permite_compras', true))
  on conflict (tenant_id, group_key) do nothing;

  -- ---------------- MODULOS ----------------
  insert into public.tenant_modules (tenant_id, module_key, is_enabled)
  select v_tenant, m, true from unnest(array[
    'agenda','totem','painel_tv','recepcao','triagem','exames','filas','crm','medico',
    'documentos','financeiro','ecommerce','scraper','campanhas','relatorios','pwa','lgpd'
  ]) as m
  on conflict (tenant_id, module_key) do nothing;

  -- ---------------- PAPEIS ----------------
  insert into public.roles (tenant_id, code, name, description, is_system) values
    (v_tenant, 'medico_examinador', 'Medico e examinador', 'Realiza triagem, exames e consulta medica', true),
    (v_tenant, 'administrativo', 'Administrativo', 'Gestao completa do sistema', true),
    (v_tenant, 'atendimento', 'Atendimento e recepcao', 'Recepcao, filas e cobrancas', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_role_medico from public.roles where tenant_id = v_tenant and code = 'medico_examinador';
  select id into v_role_admin from public.roles where tenant_id = v_tenant and code = 'administrativo';
  select id into v_role_atendimento from public.roles where tenant_id = v_tenant and code = 'atendimento';

  -- Administrativo: todas as permissoes
  insert into public.role_permissions (role_id, permission_code)
  select v_role_admin, code from public.permissions
  on conflict do nothing;

  -- Medico e examinador
  insert into public.role_permissions (role_id, permission_code)
  select v_role_medico, c from unnest(array[
    'dashboard.ver','relatorios.ver','pacientes.ver','clinico.ver','agenda.ver','empresas.ver',
    'filas.operar','painel.operar','triagem.preencher','exames.preencher','exames.concluir',
    'medico.atender','documentos.emitir','crm.mover_manual'
  ]) as c
  on conflict do nothing;

  -- Atendimento e recepcao
  insert into public.role_permissions (role_id, permission_code)
  select v_role_atendimento, c from unnest(array[
    'dashboard.ver','pacientes.ver','pacientes.criar','pacientes.editar',
    'agenda.ver','agenda.administrar','empresas.ver','empresas.administrar',
    'totem.operar','recepcao.operar','filas.operar','painel.operar',
    'financeiro.ver','financeiro.registrar','documentos.emitir','crm.mover_manual',
    'pedidos.administrar','importacoes.executar'
  ]) as c
  on conflict do nothing;

  -- ---------------- ESTAGIOS DO CRM ----------------
  insert into public.crm_stages (tenant_id, code, name, color, sort_order, is_terminal) values
    (v_tenant,'agendado','Agendado','#9CA3AF',1,false),
    (v_tenant,'checkin','Check-in realizado','#94A3B8',2,false),
    (v_tenant,'aguardando_recepcao','Aguardando recepcao','#9CA3AF',3,false),
    (v_tenant,'na_recepcao','Na recepcao','#3B82F6',4,false),
    (v_tenant,'aguardando_triagem','Aguardando triagem','#FB923C',5,false),
    (v_tenant,'em_triagem','Em triagem','#3B82F6',6,false),
    (v_tenant,'aguardando_exames','Aguardando exames','#FB923C',7,false),
    (v_tenant,'em_exames','Em exames','#3B82F6',8,false),
    (v_tenant,'aguardando_medico','Aguardando medico','#A855F7',9,false),
    (v_tenant,'em_consulta','Em consulta','#3B82F6',10,false),
    (v_tenant,'aguardando_documentos','Aguardando documentos','#FACC15',11,false),
    (v_tenant,'finalizado','Finalizado','#22C55E',12,true),
    (v_tenant,'cancelado','Cancelado','#4B5563',13,true),
    (v_tenant,'ausente','Ausente','#EF4444',14,true)
  on conflict (tenant_id, code) do nothing;

  -- ---------------- SALAS ----------------
  insert into public.rooms (tenant_id, code, name, kind, sort_order) values
    (v_tenant,'REC','Recepcao','recepcao',1),
    (v_tenant,'TRI','Triagem','triagem',2),
    (v_tenant,'AUD','Sala de Audiometria','exame',3),
    (v_tenant,'ECG','Sala de Eletrocardiograma','exame',4),
    (v_tenant,'EEG','Sala de Eletroencefalograma','exame',5),
    (v_tenant,'ESP','Sala de Espirometria','exame',6),
    (v_tenant,'LAB','Coleta Laboratorial','exame',7),
    (v_tenant,'DIN','Sala de Dinamometria','exame',8),
    (v_tenant,'CON','Consultorio Medico','consultorio',9)
  on conflict (tenant_id, code) do nothing;

  select id into v_room_recepcao from public.rooms where tenant_id=v_tenant and code='REC';
  select id into v_room_triagem  from public.rooms where tenant_id=v_tenant and code='TRI';
  select id into v_room_audio    from public.rooms where tenant_id=v_tenant and code='AUD';
  select id into v_room_ecg      from public.rooms where tenant_id=v_tenant and code='ECG';
  select id into v_room_eeg      from public.rooms where tenant_id=v_tenant and code='EEG';
  select id into v_room_espiro   from public.rooms where tenant_id=v_tenant and code='ESP';
  select id into v_room_lab      from public.rooms where tenant_id=v_tenant and code='LAB';
  select id into v_room_dinamo   from public.rooms where tenant_id=v_tenant and code='DIN';
  select id into v_room_consultorio from public.rooms where tenant_id=v_tenant and code='CON';

  -- ---------------- TIPOS DE EXAME ----------------
  insert into public.exam_types (tenant_id, code, name, description, average_minutes, default_room_id, sort_order, price, available_online, requires_result_document) values
    (v_tenant,'AUDIO','Audiometria','Avaliacao auditiva ocupacional',20,v_room_audio,1,90.00,true,true),
    (v_tenant,'ECG','Eletrocardiograma','ECG de repouso com laudo',15,v_room_ecg,2,110.00,true,true),
    (v_tenant,'EEG','Eletroencefalograma','EEG com laudo',30,v_room_eeg,3,220.00,true,true),
    (v_tenant,'ESPIRO','Espirometria','Prova de funcao pulmonar',20,v_room_espiro,4,120.00,true,true),
    (v_tenant,'LAB','Exames laboratoriais','Coleta de material biologico',10,v_room_lab,5,80.00,true,true),
    (v_tenant,'DINAMO','Dinamometria','Avaliacao de forca de preensao',15,v_room_dinamo,6,70.00,true,false),
    (v_tenant,'CLINICO','Consulta clinica ocupacional','Avaliacao medica e emissao de aptidao',20,v_room_consultorio,7,150.00,true,false)
  on conflict (tenant_id, code) do nothing;

  insert into public.room_exam_types (tenant_id, room_id, exam_type_id)
  select v_tenant, et.default_room_id, et.id from public.exam_types et
   where et.tenant_id = v_tenant and et.default_room_id is not null
  on conflict do nothing;

  -- ---------------- TOTEM ----------------
  insert into public.totems (tenant_id, code, name, location)
  values (v_tenant, 'TOTEM01', 'Totem da recepcao', 'Entrada principal')
  on conflict (tenant_id, code) do nothing;

  -- ---------------- CATALOGO DA LOJA ----------------
  insert into public.product_categories (tenant_id, slug, name, description, sort_order) values
    (v_tenant,'saude-ocupacional','Saude Ocupacional','Servicos para empresas e colaboradores',1),
    (v_tenant,'exames','Exames','Exames complementares avulsos',2),
    (v_tenant,'pacotes','Pacotes','Combos com varios exames',3)
  on conflict (tenant_id, slug) do nothing;

  select id into v_cat_ocupacional from public.product_categories where tenant_id=v_tenant and slug='saude-ocupacional';
  select id into v_cat_exames from public.product_categories where tenant_id=v_tenant and slug='exames';
  select id into v_cat_pacotes from public.product_categories where tenant_id=v_tenant and slug='pacotes';

  -- Um produto por exame disponivel online
  insert into public.products (tenant_id, category_id, kind, slug, code, name, short_description,
                               price, duration_minutes, requires_scheduling, is_active, sort_order)
  select v_tenant, v_cat_exames, 'exame',
         lower(regexp_replace(et.name, '[^a-zA-Z0-9]+', '-', 'g')),
         et.code, et.name, et.description, coalesce(et.price, 0), et.average_minutes, true, true, et.sort_order
    from public.exam_types et
   where et.tenant_id = v_tenant and et.available_online
  on conflict (tenant_id, slug) do nothing;

  -- Pacote admissional
  insert into public.products (tenant_id, category_id, kind, slug, code, name, short_description,
                               description, price, promo_price, requires_scheduling, is_featured, is_active, sort_order)
  values (v_tenant, v_cat_pacotes, 'pacote', 'pacote-admissional', 'PKG-ADM',
          'Pacote Admissional Completo',
          'Consulta clinica ocupacional + audiometria + exames laboratoriais',
          'Pacote com tudo o que a empresa precisa para o exame admissional do colaborador.',
          320.00, 279.00, true, true, true, 1)
  on conflict (tenant_id, slug) do nothing
  returning id into v_product;

  if v_product is null then
    select id into v_product from public.products where tenant_id=v_tenant and slug='pacote-admissional';
  end if;

  insert into public.service_packages (tenant_id, product_id, name, description)
  values (v_tenant, v_product, 'Pacote Admissional Completo', 'Consulta + audiometria + laboratorio')
  on conflict (product_id) do nothing
  returning id into v_package;

  if v_package is null then
    select id into v_package from public.service_packages where product_id = v_product;
  end if;

  insert into public.package_items (tenant_id, package_id, exam_type_id, quantity, sort_order)
  select v_tenant, v_package, et.id, 1, et.sort_order
    from public.exam_types et
   where et.tenant_id = v_tenant and et.code in ('CLINICO','AUDIO','LAB')
  on conflict do nothing;

  -- ---------------- TEMPLATE DE CAMPANHA ----------------
  insert into public.email_templates (tenant_id, code, name, subject, body_html, body_text, variables)
  values (v_tenant, 'prospeccao_semanal', 'Prospeccao semanal',
    'Saude ocupacional em dia na {{empresa}}?',
    '<p>Ola, {{contato}}!</p><p>Somos a {{nome_fantasia}}. Ajudamos empresas como a <strong>{{empresa}}</strong> a manter os exames ocupacionais em dia, com agendamento rapido e laudos organizados.</p><p>{{lista_servicos}}</p><p><a href="{{link_loja}}">Ver servicos e agendar</a></p><p>{{rodape}}</p><p><a href="{{link_descadastro}}">Nao desejo mais receber</a></p>',
    E'Ola, {{contato}}!\n\nSomos a {{nome_fantasia}}. Ajudamos empresas como a {{empresa}} a manter os exames ocupacionais em dia.\n\n{{lista_servicos}}\n\nAgende em: {{link_loja}}\n\n{{rodape}}\nDescadastro: {{link_descadastro}}',
    '["empresa","contato","nome_fantasia","lista_servicos","link_loja","link_descadastro","rodape"]'::jsonb)
  on conflict (tenant_id, code) do nothing;

  -- ---------------- PROVEDORES (todos em modo manual/nao configurado) ----------------
  insert into public.provider_settings (tenant_id, category, provider, is_active, is_default, public_config, status) values
    (v_tenant,'pagamento','pix_manual', true, true, '{"descricao":"Pix com confirmacao manual pela recepcao"}'::jsonb,'ativo'),
    (v_tenant,'email','manual', true, true, '{"descricao":"Fila local; envio real exige provedor configurado"}'::jsonb,'ativo'),
    (v_tenant,'ia','template', true, true, '{"descricao":"Geracao por template; IA opcional"}'::jsonb,'ativo')
  on conflict (tenant_id, category, provider) do nothing;

  raise notice 'Seed concluido para o tenant %', v_tenant;
end$$;
