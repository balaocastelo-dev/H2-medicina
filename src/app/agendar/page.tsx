import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { opcoesPublicas } from '@/modules/scheduling/publico-actions';
import { FormularioPublico } from './formulario';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Agendar exame',
  description: 'Escolha o dia e o horário do seu exame ocupacional.',
};

export default async function AgendarPage() {
  const supabase = await createClient();
  const { data: branding } = await supabase
    .from('tenant_branding')
    .select('system_name, logo_url, color_primary')
    .maybeSingle<{ system_name: string; logo_url: string | null; color_primary: string }>();

  const resultado = await opcoesPublicas();
  const opcoes = resultado.ok ? resultado.data : undefined;
  const cor = branding?.color_primary ?? '#0F766E';

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ ['--brand-primary' as string]: cor } as React.CSSProperties}
    >
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
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
            href="/agendar/comprovante"
            className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            Já agendei
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Agende seu exame</h1>
        <p className="mt-1 text-sm text-slate-600">
          Escolha o dia e o horário. Ao final você recebe um comprovante em PDF.
        </p>

        {!opcoes?.ativo ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            O agendamento pelo site está temporariamente indisponível. Entre em contato com a
            clínica por telefone.
          </div>
        ) : (
          <div className="mt-6">
            <FormularioPublico exames={opcoes.exames} dias={opcoes.dias} />
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-slate-400">
        <Link href={`${publicEnv.NEXT_PUBLIC_APP_URL}/login`} className="hover:text-slate-600">
          Área da equipe
        </Link>
      </footer>
    </div>
  );
}
