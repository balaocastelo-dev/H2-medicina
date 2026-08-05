import Link from 'next/link';
import { PackageOpen } from 'lucide-react';
import { Button, Card } from '@/components/ui';

const NOMES: Record<string, string> = {
  ecommerce: 'Loja',
  scraper: 'Importação automatizada',
  campanhas: 'Campanhas comerciais',
  pwa: 'Aplicativo do paciente',
  lgpd: 'LGPD',
};

export default async function ModuloIndisponivelPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const nome = m ? (NOMES[m] ?? m) : 'Este módulo';

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md p-8 text-center">
        <PackageOpen className="mx-auto mb-3 h-10 w-10 text-slate-400" />
        <h1 className="text-lg font-semibold">{nome} esta desativado</h1>
        <p className="mt-2 text-sm text-slate-600">
          Este modulo nao esta habilitado para a sua empresa no momento. Um administrador pode
          liga-lo em Configuracoes da empresa &rarr; Modulos, sem precisar de nova instalacao.
        </p>
        <Link href="/dashboard" className="mt-5 inline-block">
          <Button variant="outline">Voltar ao início</Button>
        </Link>
      </Card>
    </main>
  );
}
