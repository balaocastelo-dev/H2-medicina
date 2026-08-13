import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ConsultaDeComprovante } from './consulta';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Meu agendamento',
  description: 'Consulte seu agendamento pelo código do comprovante.',
};

export default async function ComprovantePage() {
  const supabase = await createClient();
  const { data: branding } = await supabase
    .from('tenant_branding')
    .select('system_name, logo_url, color_primary')
    .maybeSingle<{ system_name: string; logo_url: string | null; color_primary: string }>();

  const cor = branding?.color_primary ?? '#0F766E';

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ ['--brand-primary' as string]: cor } as React.CSSProperties}
    >
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            {branding?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logo_url}
                alt={branding.system_name}
                className="h-10 object-contain"
              />
            ) : (
              <span className="text-lg font-semibold text-slate-900">
                {branding?.system_name ?? 'Clínica'}
              </span>
            )}
          </Link>
          <Link
            href="/agendar"
            className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            Agendar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Meu agendamento</h1>
        <p className="mt-1 text-sm text-slate-600">
          Informe o código que você recebeu ao agendar.
        </p>
        <div className="mt-6">
          <ConsultaDeComprovante />
        </div>
      </main>
    </div>
  );
}
