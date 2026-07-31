import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Button, Card } from '@/components/ui';

export default async function SemPermissaoPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-semibold">Acesso nao autorizado</h1>
        <p className="mt-2 text-sm text-slate-600">
          Seu perfil nao possui a permissao necessaria para acessar esta area.
        </p>
        {p && (
          <p className="mt-2 rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
            {p}
          </p>
        )}
        <Link href="/dashboard" className="mt-5 inline-block">
          <Button variant="outline">Voltar ao inicio</Button>
        </Link>
      </Card>
    </main>
  );
}
