-- =====================================================================
-- 0012 - Row Level Security em todas as tabelas
-- Regra geral: nenhum tenant enxerga dados de outro tenant.
-- =====================================================================

-- Habilita RLS em todas as tabelas do schema public
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', r.tablename);
    execute format('alter table public.%I force row level security;', r.tablename);
  end loop;
end$$;

-- Remove policies pre-existentes para tornar a migration reexecutavel
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I;', r.policyname, r.tablename);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Gerador de policies para tabelas com tenant_id
-- ---------------------------------------------------------------------
do $$
declare
  spec text[];
  tbl  text;
  rperm text;
  wperm text;
  specs text[][] := array[
    -- tabela                         leitura                escrita
    array['tenant_settings',          'dashboard.ver',       'whitelabel.configurar'],
    array['tenant_branding',          'dashboard.ver',       'whitelabel.configurar'],
    array['tenant_modules',           'dashboard.ver',       'whitelabel.configurar'],
    array['roles',                    'dashboard.ver',       'permissoes.administrar'],
    array['user_roles',               'dashboard.ver',       'permissoes.administrar'],
    array['user_permissions',         'dashboard.ver',       'permissoes.administrar'],
    array['user_invitations',         'usuarios.administrar','usuarios.administrar'],

    array['companies',                'empresas.ver',        'empresas.administrar'],
    array['company_contacts',         'empresas.ver',        'empresas.administrar'],
    array['company_contracts',        'empresas.ver',        'empresas.administrar'],

    array['patients',                 'pacientes.ver',       'pacientes.editar'],
    array['patient_employments',      'pacientes.ver',       'pacientes.editar'],
    array['patient_duplicates',       'pacientes.ver',       'pacientes.editar'],
    array['patient_consents',         'pacientes.ver',       'pacientes.editar'],

    array['exam_types',               'agenda.ver',          'salas.administrar'],
    array['rooms',                    'agenda.ver',          'salas.administrar'],
    array['room_exam_types',          'agenda.ver',          'salas.administrar'],
    array['room_status_history',      'agenda.ver',          'filas.operar'],
    array['crm_stages',               'agenda.ver',          'salas.administrar'],

    array['appointments',             'agenda.ver',          'agenda.administrar'],
    array['appointment_exams',        'agenda.ver',          'agenda.administrar'],
    array['attendances',              'agenda.ver',          'recepcao.operar'],
    array['totems',                   'agenda.ver',          'salas.administrar'],
    array['queue_tickets',            'agenda.ver',          'totem.operar'],
    array['queue_events',             'agenda.ver',          'filas.operar'],
    array['tv_calls',                 'agenda.ver',          'painel.operar'],

    array['triages',                  'clinico.ver',         'triagem.preencher'],
    array['triage_revisions',         'clinico.ver',         'triagem.preencher'],
    array['patient_exams',            'agenda.ver',          'filas.operar'],
    array['exam_results',             'clinico.ver',         'exames.preencher'],
    array['medical_consultations',    'clinico.ver',         'medico.atender'],
    array['medical_notes',            'clinico.ver',         'medico.atender'],
    array['patient_attachments',      'clinico.ver',         'exames.preencher'],

    array['crm_movements',            'agenda.ver',          'crm.mover_manual'],
    array['document_templates',       'documentos.emitir',   'whitelabel.configurar'],
    array['documents',                'documentos.emitir',   'documentos.emitir'],
    array['document_deliveries',      'documentos.emitir',   'documentos.emitir'],
    array['document_views',           'logs.ver',            'documentos.emitir'],

    array['payments',                 'financeiro.ver',      'financeiro.registrar'],
    array['payment_transactions',     'financeiro.ver',      'financeiro.registrar'],
    array['pix_charges',              'financeiro.ver',      'financeiro.registrar'],
    array['cash_registers',           'financeiro.ver',      'financeiro.registrar'],

    array['product_categories',       'dashboard.ver',       'produtos.administrar'],
    array['products',                 'dashboard.ver',       'produtos.administrar'],
    array['product_images',           'dashboard.ver',       'produtos.administrar'],
    array['product_variants',         'dashboard.ver',       'produtos.administrar'],
    array['service_packages',         'dashboard.ver',       'produtos.administrar'],
    array['package_items',            'dashboard.ver',       'produtos.administrar'],
    array['carts',                    'pedidos.administrar', 'pedidos.administrar'],
    array['cart_items',               'pedidos.administrar', 'pedidos.administrar'],
    array['orders',                   'pedidos.administrar', 'pedidos.administrar'],
    array['order_items',              'pedidos.administrar', 'pedidos.administrar'],
    array['order_status_history',     'pedidos.administrar', 'pedidos.administrar'],
    array['coupons',                  'pedidos.administrar', 'ecommerce.administrar'],
    array['coupon_usages',            'pedidos.administrar', 'ecommerce.administrar'],
    array['promotions',               'dashboard.ver',       'ecommerce.administrar'],
    array['inventory_movements',      'produtos.administrar','produtos.administrar'],

    array['scraper_connectors',       'scraper.administrar', 'scraper.administrar'],
    array['scraper_connector_fields', 'scraper.administrar', 'scraper.administrar'],
    array['source_field_mappings',    'importacoes.executar','scraper.administrar'],
    array['scraper_runs',             'importacoes.executar','importacoes.executar'],
    array['scraper_run_logs',         'importacoes.executar','importacoes.executar'],
    array['scraper_raw_records',      'importacoes.aprovar', 'importacoes.executar'],
    array['scraper_normalized_records','importacoes.aprovar','importacoes.executar'],
    array['scraper_import_reviews',   'importacoes.aprovar', 'importacoes.aprovar'],
    array['import_conflicts',         'importacoes.aprovar', 'importacoes.aprovar'],
    array['file_imports',             'importacoes.executar','importacoes.executar'],

    array['email_templates',          'campanhas.administrar','campanhas.administrar'],
    array['email_campaigns',          'campanhas.administrar','campanhas.administrar'],
    array['email_recipients',         'campanhas.administrar','campanhas.administrar'],
    array['email_events',             'campanhas.administrar','campanhas.administrar'],
    array['unsubscribe_list',         'campanhas.administrar','campanhas.administrar'],

    array['provider_settings',        'integracoes.configurar','integracoes.configurar'],
    array['data_subject_requests',    'lgpd.administrar',    'lgpd.administrar'],
    array['auth_events',              'logs.ver',            'logs.ver'],
    array['clinical_access_logs',     'logs.ver',            'logs.ver']
  ];
begin
  foreach spec slice 1 in array specs loop
    tbl := spec[1]; rperm := spec[2]; wperm := spec[3];

    execute format($f$
      create policy tenant_select on public.%1$I for select to authenticated
      using (public.can_access(tenant_id, %2$L));
    $f$, tbl, rperm);

    execute format($f$
      create policy tenant_insert on public.%1$I for insert to authenticated
      with check (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);

    execute format($f$
      create policy tenant_update on public.%1$I for update to authenticated
      using (public.can_access(tenant_id, %2$L))
      with check (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);

    execute format($f$
      create policy tenant_delete on public.%1$I for delete to authenticated
      using (public.can_access(tenant_id, %2$L));
    $f$, tbl, wperm);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- Policies especificas
-- ---------------------------------------------------------------------

-- TENANTS: usuario le o proprio tenant; so admin da plataforma cria/apaga
create policy tenants_select on public.tenants for select to authenticated
  using (public.is_platform_admin() or id = public.current_tenant_id());
create policy tenants_update on public.tenants for update to authenticated
  using (public.can_access(id, 'whitelabel.configurar'))
  with check (public.can_access(id, 'whitelabel.configurar'));
create policy tenants_insert on public.tenants for insert to authenticated
  with check (public.is_platform_admin());
create policy tenants_delete on public.tenants for delete to authenticated
  using (public.is_platform_admin());

-- PROFILES: o proprio usuario sempre se enxerga (evita recursao no login)
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_select_tenant on public.profiles for select to authenticated
  using (public.can_access(tenant_id, 'usuarios.administrar'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_platform_admin = (select p.is_platform_admin from public.profiles p where p.id = auth.uid()));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.can_access(tenant_id, 'usuarios.administrar'))
  with check (public.can_access(tenant_id, 'usuarios.administrar'));
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check (public.can_access(tenant_id, 'usuarios.administrar'));

-- PERMISSIONS: catalogo global somente leitura
create policy permissions_select on public.permissions for select to authenticated using (true);

-- ROLE_PERMISSIONS: segue o tenant do papel
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.belongs_to_tenant(r.tenant_id)));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.can_access(r.tenant_id, 'permissoes.administrar')))
  with check (exists (select 1 from public.roles r where r.id = role_id and public.can_access(r.tenant_id, 'permissoes.administrar')));

-- NOTIFICACOES: destinatario le as proprias
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.can_access(tenant_id, 'dashboard.ver'));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.belongs_to_tenant(tenant_id));

-- AUDITORIA: append-only. Ninguem altera nem apaga pela API.
create policy audit_select on public.audit_logs for select to authenticated
  using (public.can_access(tenant_id, 'logs.ver'));
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (public.belongs_to_tenant(tenant_id));
-- (sem policy de update/delete => bloqueado para qualquer usuario autenticado)

-- SYSTEM_SETTINGS: somente admin da plataforma
create policy system_settings_all on public.system_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- Credenciais cifradas: ver migration 0015, que move os segredos para o
-- schema `private` (nao exposto pela API) e cria as views seguras
-- scraper_connectors_safe / provider_settings_safe.
-- Revogar por coluna nao funciona quando existe GRANT no nivel da tabela.
-- ---------------------------------------------------------------------
