export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: string;
  module?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Menu do painel. Cada item pode exigir uma permissao e/ou um modulo
 * habilitado no tenant — nada aqui e fixo para uma empresa especifica.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operacao',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'LayoutDashboard',
        permission: 'dashboard.ver',
      },
      {
        href: '/crm',
        label: 'CRM do dia',
        icon: 'KanbanSquare',
        permission: 'agenda.ver',
        module: 'crm',
      },
      {
        href: '/recepcao',
        label: 'Recepcao',
        icon: 'ClipboardCheck',
        permission: 'recepcao.operar',
        module: 'recepcao',
      },
      {
        href: '/triagem',
        label: 'Triagem',
        icon: 'HeartPulse',
        permission: 'triagem.preencher',
        module: 'triagem',
      },
      {
        href: '/filas',
        label: 'Filas e salas',
        icon: 'ListOrdered',
        permission: 'filas.operar',
        module: 'filas',
      },
      {
        href: '/medico',
        label: 'Modulo medico',
        icon: 'Stethoscope',
        permission: 'medico.atender',
        module: 'medico',
      },
    ],
  },
  {
    title: 'Agenda e cadastros',
    items: [
      {
        href: '/agenda',
        label: 'Agenda',
        icon: 'CalendarDays',
        permission: 'agenda.ver',
        module: 'agenda',
      },
      {
        href: '/agenda/proximo-dia',
        label: 'Proximo dia',
        icon: 'CalendarClock',
        permission: 'agenda.ver',
        module: 'agenda',
      },
      { href: '/pacientes', label: 'Pacientes', icon: 'Users', permission: 'pacientes.ver' },
      { href: '/empresas', label: 'Empresas', icon: 'Building2', permission: 'empresas.ver' },
    ],
  },
  {
    title: 'Documentos e financeiro',
    items: [
      {
        href: '/documentos',
        label: 'Documentos',
        icon: 'FileText',
        permission: 'documentos.emitir',
        module: 'documentos',
      },
      {
        href: '/financeiro',
        label: 'Financeiro',
        icon: 'Wallet',
        permission: 'financeiro.ver',
        module: 'financeiro',
      },
    ],
  },
  {
    title: 'Loja',
    items: [
      {
        href: '/loja-admin/produtos',
        label: 'Produtos',
        icon: 'Package',
        permission: 'produtos.administrar',
        module: 'ecommerce',
      },
      {
        href: '/loja-admin/pedidos',
        label: 'Pedidos',
        icon: 'ShoppingCart',
        permission: 'pedidos.administrar',
        module: 'ecommerce',
      },
      {
        href: '/loja-admin/cupons',
        label: 'Cupons',
        icon: 'TicketPercent',
        permission: 'ecommerce.administrar',
        module: 'ecommerce',
      },
    ],
  },
  {
    title: 'Automacao',
    items: [
      {
        href: '/importacao/conectores',
        label: 'Conectores',
        icon: 'PlugZap',
        permission: 'scraper.administrar',
        module: 'scraper',
      },
      {
        href: '/importacao/execucoes',
        label: 'Execucoes',
        icon: 'RefreshCw',
        permission: 'importacoes.executar',
        module: 'scraper',
      },
      {
        href: '/importacao/revisao',
        label: 'Revisao de importacao',
        icon: 'CheckCheck',
        permission: 'importacoes.aprovar',
        module: 'scraper',
      },
      {
        href: '/campanhas',
        label: 'Campanhas',
        icon: 'Megaphone',
        permission: 'campanhas.administrar',
        module: 'campanhas',
      },
    ],
  },
  {
    title: 'Administracao',
    items: [
      {
        href: '/relatorios',
        label: 'Relatorios',
        icon: 'BarChart3',
        permission: 'relatorios.ver',
        module: 'relatorios',
      },
      {
        href: '/usuarios',
        label: 'Usuarios e permissoes',
        icon: 'UserCog',
        permission: 'usuarios.administrar',
      },
      {
        href: '/configuracoes',
        label: 'Configuracoes da empresa',
        icon: 'Settings',
        permission: 'whitelabel.configurar',
      },
      { href: '/logs', label: 'Logs e auditoria', icon: 'ScrollText', permission: 'logs.ver' },
    ],
  },
];

/** Atalhos de tela cheia (abrem fora do painel). */
export const FULLSCREEN_LINKS: NavItem[] = [
  {
    href: '/totem',
    label: 'Totem',
    icon: 'MonitorSmartphone',
    permission: 'totem.operar',
    module: 'totem',
  },
  {
    href: '/painel',
    label: 'Painel de TV',
    icon: 'Tv',
    permission: 'painel.operar',
    module: 'painel_tv',
  },
];
