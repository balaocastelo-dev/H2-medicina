'use client';

import { useState, useTransition } from 'react';
import { LogOut, User } from 'lucide-react';
import { signOut } from '@/modules/auth/actions';

export function Topbar({
  userName,
  roleLabel,
  tenantName,
}: {
  userName: string;
  roleLabel: string;
  tenantName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      <div className="pl-10 lg:pl-0">
        <p className="text-sm font-medium text-slate-800">{tenantName}</p>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200">
            <User className="h-4 w-4 text-slate-600" />
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm leading-tight font-medium text-slate-800">
              {userName}
            </span>
            <span className="block text-xs leading-tight text-slate-500">{roleLabel}</span>
          </span>
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => void signOut())}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              {pending ? 'Saindo...' : 'Sair'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
