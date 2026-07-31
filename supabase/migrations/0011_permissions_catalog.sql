-- =====================================================================
-- 0011 - Catalogo global de permissoes
-- =====================================================================
insert into public.permissions (code, module, name, description, is_sensitive) values
  ('dashboard.ver',        'dashboard',  'Visualizar dashboard',            'Acessa paineis e indicadores', false),
  ('relatorios.ver',       'relatorios', 'Visualizar relatorios',           'Acessa relatorios gerenciais', false),

  ('pacientes.ver',        'pacientes',  'Visualizar pacientes',            'Consulta cadastro de pacientes', false),
  ('pacientes.criar',      'pacientes',  'Criar pacientes',                 'Cria novos pacientes', false),
  ('pacientes.editar',     'pacientes',  'Editar pacientes',                'Altera dados cadastrais', false),
  ('pacientes.excluir',    'pacientes',  'Excluir pacientes',               'Remove (soft delete) pacientes', true),
  ('clinico.ver',          'clinico',    'Consultar dados clinicos',        'Le prontuario, triagem, exames e consultas', true),

  ('agenda.ver',           'agenda',     'Visualizar agenda',               'Consulta agendamentos', false),
  ('agenda.administrar',   'agenda',     'Administrar agenda',              'Cria, remarca e cancela agendamentos', false),

  ('empresas.ver',         'empresas',   'Visualizar empresas',             'Consulta empresas clientes', false),
  ('empresas.administrar', 'empresas',   'Administrar empresas',            'Cria e edita empresas e contatos', false),

  ('totem.operar',         'totem',      'Operar totem',                    'Emite senhas no totem', false),
  ('recepcao.operar',      'recepcao',   'Operar recepcao',                 'Confirma chegada e organiza filas', false),
  ('filas.operar',         'filas',      'Operar filas e salas',            'Chama, inicia e conclui atendimentos', false),
  ('painel.operar',        'painel',     'Operar painel de chamadas',       'Controla o painel de TV', false),
  ('salas.administrar',    'salas',      'Administrar salas',               'Cadastra salas e tipos de exame', false),

  ('triagem.preencher',    'triagem',    'Preencher triagem',               'Registra sinais vitais e alertas', true),
  ('exames.preencher',     'exames',     'Preencher exames',                'Registra execucao e resultados', true),
  ('exames.concluir',      'exames',     'Concluir exames',                 'Finaliza exames do paciente', true),
  ('medico.atender',       'medico',     'Realizar atendimento medico',     'Registra anamnese, conclusao e aptidao', true),
  ('crm.mover_manual',     'crm',        'Mover paciente manualmente',      'Arrasta cartoes no CRM', false),

  ('documentos.emitir',    'documentos', 'Emitir documentos',               'Gera PDFs e atestados', true),

  ('financeiro.ver',       'financeiro', 'Consultar financeiro',            'Le cobrancas e pagamentos', false),
  ('financeiro.registrar', 'financeiro', 'Registrar pagamentos',            'Cria e confirma cobrancas', false),
  ('financeiro.estornar',  'financeiro', 'Realizar estornos',               'Estorna pagamentos confirmados', true),

  ('ecommerce.administrar','ecommerce',  'Administrar e-commerce',          'Configura loja, banners e promocoes', false),
  ('produtos.administrar', 'ecommerce',  'Administrar produtos',            'Cria e edita produtos e pacotes', false),
  ('pedidos.administrar',  'ecommerce',  'Administrar pedidos',             'Gerencia pedidos e status', false),

  ('scraper.administrar',  'importacao', 'Administrar conectores',          'Configura conectores de importacao', true),
  ('importacoes.executar', 'importacao', 'Executar importacoes',            'Dispara coletas e importacoes', false),
  ('importacoes.aprovar',  'importacao', 'Aprovar importacoes',             'Aprova a previa antes de sincronizar', false),

  ('campanhas.administrar','campanhas',  'Administrar campanhas',           'Cria campanhas comerciais', false),
  ('campanhas.aprovar',    'campanhas',  'Aprovar campanhas',               'Aprova o envio das campanhas', false),

  ('usuarios.administrar', 'admin',      'Administrar usuarios',            'Convida, bloqueia e edita usuarios', true),
  ('permissoes.administrar','admin',     'Administrar permissoes',          'Altera papeis e permissoes', true),
  ('whitelabel.configurar','admin',      'Configurar white label',          'Edita marca e dados da empresa', false),
  ('integracoes.configurar','admin',     'Configurar integracoes',          'Configura provedores externos', true),
  ('logs.ver',             'admin',      'Visualizar logs',                 'Consulta auditoria e logs', true),
  ('lgpd.administrar',     'admin',      'Administrar LGPD',                'Trata solicitacoes de titulares', true)
on conflict (code) do update
  set module = excluded.module,
      name = excluded.name,
      description = excluded.description,
      is_sensitive = excluded.is_sensitive;
