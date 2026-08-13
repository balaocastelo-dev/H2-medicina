import Link from 'next/link';
import { CalendarCheck, FileSearch, LogIn } from 'lucide-react';
import { marcaPublica } from '@/modules/settings/marca-publica';

export const dynamic = 'force-dynamic';

/**
 * Porta de entrada publica.
 *
 * Antes o endereco principal jogava direto no login, o que so faz sentido
 * para a equipe. Quem chega pelo WhatsApp ou pelo Instagram da clinica
 * quer agendar — e essa e a primeira coisa que ve.
 *
 * Quem ja tem sessao nem passa por aqui: o proxy manda para o painel.
 */
export default async function Home() {
  const marca = await marcaPublica();
  const nome = marca?.systemName ?? 'Medicina Ocupacional';
  const cor = marca?.colorPrimary ?? '#0F766E';

  return (
    <div
      className="flex min-h-screen flex-col bg-slate-50"
      style={{ ['--brand-primary' as string]: cor } as React.CSSProperties}
    >
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
        <div className="text-center">
          {marca?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={marca.logoUrl} alt={nome} className="mx-auto h-20 object-contain" />
          ) : (
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
              style={{ backgroundColor: cor }}
            >
              {nome.slice(0, 2).toUpperCase()}
            </span>
          )}
          <h1 className="mt-4 text-2xl font-bold text-slate-900">{nome}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Exames ocupacionais com hora marcada.
          </p>
        </div>

        <div className="mt-8 space-y-3">
          <Link
            href="/agendar"
            className="flex items-center gap-4 rounded-2xl p-5 text-white shadow-sm transition hover:opacity-95"
            style={{ backgroundColor: cor }}
          >
            <CalendarCheck className="h-7 w-7 shrink-0" />
            <span>
              <span className="block text-base font-semibold">Agendar meu exame</span>
              <span className="block text-sm opacity-90">
                Escolha o dia e o horário e receba o comprovante
              </span>
            </span>
          </Link>

          <Link
            href="/agendar/comprovante"
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
          >
            <FileSearch className="h-6 w-6 shrink-0 text-slate-400" />
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                Já agendei
              </span>
              <span className="block text-sm text-slate-500">
                Consulte ou baixe o comprovante pelo código
              </span>
            </span>
          </Link>

          <Link
            href="/meu"
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
          >
            <FileSearch className="h-6 w-6 shrink-0 text-slate-400" />
            <span>
              <span className="block text-sm font-semibold text-slate-800">
                Meus exames e documentos
              </span>
              <span className="block text-sm text-slate-500">
                Resultados, recibos e atestados de quem já foi atendido
              </span>
            </span>
          </Link>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <LogIn className="h-4 w-4" /> Área da equipe
        </Link>
      </footer>
    </div>
  );
}
