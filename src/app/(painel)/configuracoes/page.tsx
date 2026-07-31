import { requirePermission } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { SettingsTabs } from './tabs';

export const dynamic = 'force-dynamic';

const MODULES = [
  'agenda',
  'totem',
  'painel_tv',
  'recepcao',
  'triagem',
  'exames',
  'filas',
  'crm',
  'medico',
  'documentos',
  'financeiro',
  'ecommerce',
  'scraper',
  'campanhas',
  'relatorios',
  'pwa',
  'lgpd',
];

export default async function ConfiguracoesPage() {
  const ctx = await requirePermission('whitelabel.configurar');

  return (
    <div>
      <PageHeader
        title="Configuracoes da empresa"
        description="Tudo que identifica a operacao — marca, dados, textos, prefixos e modulos"
      />
      <SettingsTabs
        branding={ctx.branding}
        settings={ctx.settings}
        modules={Array.from(ctx.modules)}
        allModules={MODULES}
        tenantName={ctx.tenant.trade_name}
      />
    </div>
  );
}
