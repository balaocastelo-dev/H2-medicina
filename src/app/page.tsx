import Link from 'next/link';
import { CalendarCheck, FileSearch, LogIn, Stethoscope } from 'lucide-react';
import { marcaPublica } from '@/modules/settings/marca-publica';
import { RedeViva } from '@/components/scene/rede-viva';

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

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#01080e]">
      {/* A rede fica atras de tudo e nao intercepta clique: os botoes
          continuam clicaveis, e o efeito responde pela janela inteira. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <RedeViva />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
          <div className="text-center">
            {marca?.logoUrl ? (
              // Versao para fundo escuro: mesma marca, com o azul-petroleo
              // levantado, que no quase preto sumia.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/marca/h2-logo-escuro.png"
                alt={nome}
                className="mx-auto h-28 object-contain drop-shadow-[0_0_35px_rgba(0,229,255,0.35)]"
              />
            ) : (
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[#00A896] text-2xl font-bold text-white">
                {nome.slice(0, 2).toUpperCase()}
              </span>
            )}

            <p className="mt-5 text-sm font-bold tracking-[0.35em] text-[#00E5FF] uppercase drop-shadow-[0_0_20px_rgba(0,229,255,0.6)]">
              Medicina Ocupacional
            </p>
            {/* "Exame" nao cobre pericia, licenca e junta medica, que sao
                boa parte do que a clinica atende. "Atendimento" cobre tudo. */}
            <p className="mt-2 text-xs tracking-[0.2em] text-white/50 uppercase">
              Atendimento com hora marcada
            </p>
          </div>

          <div className="mt-10 space-y-3">
            <Cartao
              href="/agendar"
              destaque
              icone={<CalendarCheck className="h-7 w-7 shrink-0" />}
              titulo="Fazer agendamento"
              descricao="Escolha o dia e o horário e receba o comprovante"
            />
            <Cartao
              href="/agendar/comprovante"
              icone={<FileSearch className="h-6 w-6 shrink-0" />}
              titulo="Já agendei"
              descricao="Consulte ou baixe o comprovante pelo código"
            />
            <Cartao
              href="/meu"
              icone={<Stethoscope className="h-6 w-6 shrink-0" />}
              titulo="Meus documentos"
              descricao="Resultados, recibos e atestados de quem já foi atendido"
            />
          </div>
        </main>

        <footer className="pb-8 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#00E5FF]/25 bg-[#01080e]/70 px-4 py-2 text-xs tracking-widest text-[#00E5FF]/80 uppercase backdrop-blur transition hover:border-[#00E5FF]/50 hover:text-[#00E5FF]"
          >
            <LogIn className="h-3.5 w-3.5" /> Área da equipe
          </Link>
        </footer>
      </div>
    </div>
  );
}

/** Cartao de vidro sobre a rede: legivel sem tapar o efeito. */
function Cartao({
  href,
  icone,
  titulo,
  descricao,
  destaque = false,
}: {
  href: string;
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  destaque?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-4 rounded-2xl border p-5 backdrop-blur-md transition ${
        destaque
          ? 'border-[#00E5FF]/40 bg-[#00A896]/20 text-white shadow-[0_0_30px_rgba(0,229,255,0.15)] hover:border-[#00E5FF]/70 hover:bg-[#00A896]/30'
          : 'border-white/10 bg-white/[0.04] text-white/90 hover:border-[#00E5FF]/40 hover:bg-white/[0.08]'
      }`}
    >
      <span className={destaque ? 'text-[#00E5FF]' : 'text-[#00E5FF]/60'}>{icone}</span>
      <span>
        <span className="block text-base font-semibold">{titulo}</span>
        <span className="block text-sm text-white/60">{descricao}</span>
      </span>
    </Link>
  );
}
