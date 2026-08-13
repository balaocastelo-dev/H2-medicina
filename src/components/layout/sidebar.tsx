'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavIcon } from './icon';
import type { Contadores } from './contadores';
import type { NavGroup, NavItem } from './nav-config';

export function Sidebar({
  groups,
  fullscreenLinks,
  systemName,
  logoUrl,
  footerText,
  contadores = {},
}: {
  groups: NavGroup[];
  fullscreenLinks: NavItem[];
  systemName: string;
  logoUrl: string | null;
  footerText: string | null;
  /** Quantas operações aguardam em cada etapa. */
  contadores?: Contadores;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/dashboard'
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const content = (
    <nav className="flex h-full flex-col" data-guia="menu-lateral">
      <div className="flex items-center gap-3 px-4 py-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={systemName} className="h-8 max-w-[150px] object-contain" />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            {systemName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="truncate text-sm font-semibold text-white">{systemName}</span>
      </div>

      <div className="flex-1 scrollbar-thin overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                      isActive(item.href)
                        ? 'bg-white/10 font-medium text-white'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span data-guia={item.badge ? 'menu-contador' : undefined}>
                      <Contador valor={item.badge ? contadores[item.badge] : undefined} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {fullscreenLinks.length > 0 && (
          <div className="mb-4 border-t border-white/10 pt-3">
            <p className="px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Telas dedicadas
            </p>
            <ul className="space-y-0.5">
              {fullscreenLinks.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
                  >
                    <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {footerText && (
        <p className="border-t border-white/10 px-4 py-3 text-[11px] text-slate-400">
          {footerText}
        </p>
      )}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-40 rounded-lg bg-white p-2 shadow lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <aside className="bg-sidebar hidden w-64 shrink-0 lg:block">{content}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="bg-sidebar absolute top-0 left-0 h-full w-72">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-4 right-3 text-slate-300"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * Bolinha com o número de pendências.
 *
 * Vermelho e circular, como notificação de aplicativo: é o padrão que as
 * pessoas já leem sem precisar aprender. O anel escuro separa a bolinha do
 * fundo do menu. Só aparece quando há algo a fazer — um zero permanente vira
 * ruído e a pessoa para de olhar.
 */
function Contador({ valor }: { valor?: number }) {
  if (!valor || valor <= 0) return null;
  const texto = valor > 99 ? '99+' : String(valor);
  return (
    <span
      aria-label={`${texto} aguardando`}
      className="ml-auto flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] leading-none font-bold text-white tabular-nums ring-2 ring-[color:var(--brand-sidebar)]"
    >
      {texto}
    </span>
  );
}
