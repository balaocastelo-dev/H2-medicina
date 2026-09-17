import { requireSession } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { NAV_GROUPS, FULLSCREEN_LINKS, DOWNLOADS } from '@/components/layout/nav-config';
import { carregarContadores } from '@/components/layout/contadores';
import { AutoRefresh } from '@/components/layout/auto-refresh';
import { GuiaProvider } from '@/components/guide/guia-provider';
import { guiasJaVistos } from '@/modules/guide/actions';

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const { branding, tenant, profile, permissions, modules } = ctx;
  const [contadores, vistos] = await Promise.all([
    carregarContadores(tenant.id),
    guiasJaVistos(),
  ]);

  const allowed = (perm?: string, mod?: string) =>
    (!perm || permissions.has(perm)) && (!mod || modules.has(mod));

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed(i.permission, i.module)),
  })).filter((g) => g.items.length > 0);

  const fullscreen = FULLSCREEN_LINKS.filter((i) => allowed(i.permission, i.module));
  const downloads = DOWNLOADS.filter((d) => allowed(d.permission));

  const themeVars = {
    ['--brand-primary' as string]: branding.color_primary,
    ['--brand-secondary' as string]: branding.color_secondary,
    ['--brand-accent' as string]: branding.color_accent,
    ['--brand-sidebar' as string]: branding.color_sidebar,
    ...Object.fromEntries(
      Object.entries(branding.status_colors ?? {}).map(([k, v]) => [`--status-${k}`, v]),
    ),
  } as React.CSSProperties;

  return (
    <GuiaProvider jaVistos={vistos}>
      <div className="flex min-h-screen" style={themeVars}>
        <Sidebar
          groups={groups}
          fullscreenLinks={fullscreen}
          downloads={downloads}
          systemName={branding.system_name}
          logoUrl={branding.logo_compact_url ?? branding.logo_url}
          footerText={branding.footer_text}
          contadores={contadores}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            userName={profile.full_name || (ctx.email ?? 'Usuario')}
            roleLabel={profile.job_title ?? ctx.roles[0] ?? 'Usuario'}
            tenantName={tenant.trade_name}
            podeBuscarPaciente={permissions.has('pacientes.ver')}
          />
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>

        {/* MantÃ©m os contadores do menu atualizados sem recarregar a pÃ¡gina. */}
        <AutoRefresh />

        {/* O assistente de Ctrl+K foi retirado a pedido da clÃ­nica (15/09). */}
      </div>
    </GuiaProvider>
  );
}
