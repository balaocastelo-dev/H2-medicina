/** Chaves dos contadores de pendência exibidos no menu. */
export type ContadorChave =
  | 'recepcao'
  | 'triagem'
  | 'filas'
  | 'medico'
  | 'pagamentos'
  | 'documentos'
  | 'crm';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: string;
  module?: string;
  /** Mostra uma bolinha com quantas operações aguardam nesta tela. */
  badge?: ContadorChave;
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
    title: 'Operação',
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
        badge: 'crm',
      },
      {
        href: '/recepcao',
        label: 'Recepção',
        icon: 'ClipboardCheck',
        permission: 'recepcao.operar',
        module: 'recepcao',
        badge: 'recepcao',
      },
      {
        href: '/triagem',
        label: 'Triagem',
        icon: 'HeartPulse',
        permission: 'triagem.preencher',
        module: 'triagem',
        badge: 'triagem',
      },
      {
        href: '/filas',
        label: 'Filas e salas',
        icon: 'ListOrdered',
        permission: 'filas.operar',
        module: 'filas',
        badge: 'filas',
      },
      {
        href: '/medico',
        label: 'Módulo médico',
        icon: 'Stethoscope',
        permission: 'medico.atender',
        module: 'medico',
        badge: 'medico',
      },
      {
        href: '/pagamentos',
        label: 'Pagamentos',
        icon: 'Wallet',
        permission: 'financeiro.ver',
        module: 'financeiro',
        badge: 'pagamentos',
      },
      {
        href: '/documentos',
        label: 'Documentos',
        icon: 'FileText',
        permission: 'documentos.emitir',
        module: 'documentos',
        badge: 'documentos',
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
        label: 'Próximo dia',
        icon: 'CalendarClock',
        permission: 'agenda.ver',
        module: 'agenda',
      },
      { href: '/pacientes', label: 'Pacientes', icon: 'Users', permission: 'pacientes.ver' },
      { href: '/empresas', label: 'Empresas', icon: 'Building2', permission: 'empresas.ver' },
    ],
  },
  {
    title: 'Financeiro',
    items: [
      {
        href: '/financeiro',
        label: 'Financeiro',
        icon: 'Wallet',
        permission: 'financeiro.ver',
        module: 'financeiro',
      },
    ],
  },
  // Grupos abaixo aparecem somente quando o modulo correspondente esta
  // habilitado para o tenant (Configuracoes da empresa -> Modulos).
  // Hoje ecommerce, scraper e campanhas vem desligados por padrao.
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
    title: 'Automação',
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
        label: 'Execuções',
        icon: 'RefreshCw',
        permission: 'importacoes.executar',
        module: 'scraper',
      },
      {
        href: '/importacao/revisao',
        label: 'Revisão de importação',
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
    title: 'Administração',
    items: [
      {
        href: '/relatorios',
        label: 'Relatórios',
        icon: 'BarChart3',
        permission: 'relatorios.ver',
        module: 'relatorios',
      },
      {
        href: '/usuarios',
        label: 'Usuários e permissões',
        icon: 'UserCog',
        permission: 'usuarios.administrar',
      },
      {
        href: '/configuracoes',
        label: 'Configurações da empresa',
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
