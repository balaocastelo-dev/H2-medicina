'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Receipt, Stethoscope, Wallet } from 'lucide-react';

const ABAS = [
  { href: '/financeiro', rotulo: 'Cobranças', Icone: Receipt },
  { href: '/financeiro/calendario', rotulo: 'Calendário', Icone: CalendarDays },
  { href: '/financeiro/repasse', rotulo: 'Repasse médico', Icone: Stethoscope },
  { href: '/financeiro/contas', rotulo: 'Contas a pagar', Icone: Wallet },
];

export function AbasFinanceiro() {
  const caminho = usePathname();

  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {ABAS.map(({ href, rotulo, Icone }) => {
        const ativa = href === '/financeiro' ? caminho === href : caminho.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              ativa
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icone className="h-4 w-4" />
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
