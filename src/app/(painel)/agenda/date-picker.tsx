'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui';

export function AgendaDatePicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Data
      <Input
        type="date"
        value={value}
        className="h-9 w-auto"
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('data', e.target.value);
          router.replace(`${pathname}?${next.toString()}`);
        }}
      />
    </label>
  );
}
