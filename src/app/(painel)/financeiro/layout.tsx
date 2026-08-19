import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { AbasFinanceiro } from './abas';

export default async function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('financeiro.ver');
  return (
    <div>
      <AbasFinanceiro />
      {children}
      <p className="mt-6 text-center text-xs text-slate-400">
        Precisa de um recibo ou comprovante?{' '}
        <Link href="/documentos" className="underline">
          Documentos
        </Link>
      </p>
    </div>
  );
}
