'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui';

export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      {children}
    </Button>
  );
}

export function ExportCsvButton({
  rows,
  fileName,
}: {
  rows: Record<string, string>[];
  fileName: string;
}) {
  const download = () => {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0] ?? {});
    const escape = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      headers.join(';'),
      ...rows.map((r) => headers.map((h) => escape(r[h] ?? '')).join(';')),
    ].join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" onClick={download} disabled={rows.length === 0}>
      <Download className="h-4 w-4" /> Exportar CSV
    </Button>
  );
}
