'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useTransition, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Input } from '@/components/ui';

/** Busca com debounce que escreve na querystring (server-side filtering). */
export function SearchBox({ placeholder = 'Buscar...' }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set('q', value);
      else next.delete('q');
      next.delete('pagina');
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={placeholder}
      />
    </div>
  );
}

/** Filtro simples baseado em querystring. */
export function FilterSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(name) ?? '';

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      {label}
      <select
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          next.delete('pagina');
          router.replace(`${pathname}?${next.toString()}`);
        }}
        className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set('pagina', String(p));
    router.replace(`${pathname}?${next.toString()}`);
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Button>
        <span className="px-1">
          {page} / {lastPage}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => go(page + 1)}
        >
          Proxima <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Confirmacao para acoes criticas. */
export function ConfirmButton({
  onConfirm,
  question,
  children,
  variant = 'danger',
  size = 'sm',
}: {
  onConfirm: () => void | Promise<void>;
  question: string;
  children: React.ReactNode;
  variant?: 'danger' | 'outline' | 'primary' | 'secondary' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      loading={pending}
      onClick={() => {
        if (window.confirm(question)) {
          startTransition(() => void onConfirm());
        }
      }}
    >
      {children}
    </Button>
  );
}
