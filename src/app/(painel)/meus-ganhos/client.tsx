'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function SeletorDeCompetencia({ competencia }: { competencia: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <label className="text-sm font-medium text-slate-600" htmlFor="competencia">
        Competência
      </label>
      <input
        id="competencia"
        type="month"
        value={competencia}
        onChange={(e) => {
          const proximo = new URLSearchParams(params.toString());
          proximo.set('competencia', e.target.value);
          router.replace(`${pathname}?${proximo.toString()}`);
        }}
        className="h-9 rounded-lg border border-slate-300 px-3 text-sm"
      />
    </div>
  );
}
