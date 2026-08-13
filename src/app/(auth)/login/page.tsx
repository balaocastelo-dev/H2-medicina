import Link from 'next/link';
import { marcaPublica } from '@/modules/settings/marca-publica';
import { LoginForm } from './login-form';


export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await searchParams;

  // Lido com a chave de servico: `tenants` e `tenant_branding` estao sob
  // RLS e o visitante da tela de login ainda nao tem sessao. Sem isso o
  // logo nunca aparecia aqui.
  const marca = await marcaPublica();
  const systemName = marca?.systemName ?? 'Plataforma Clínica';
  const cor = marca?.colorPrimary ?? '#0F766E';

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 text-center">
        {marca?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={marca.logoUrl} alt={systemName} className="mx-auto h-14 object-contain" />
        ) : (
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-white"
            style={{ backgroundColor: cor }}
          >
            {systemName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <h1 className="mt-3 text-xl font-semibold text-slate-900">{systemName}</h1>
        <p className="text-sm text-slate-500">Acesse com suas credenciais</p>
      </div>

      <LoginForm next={proximo} primaryColor={cor} />

      <div className="mt-4 text-center text-sm">
        <Link href="/esqueci-senha" className="text-slate-600 underline-offset-2 hover:underline">
          Esqueci minha senha
        </Link>
      </div>

      {marca?.footerText && (
        <p className="mt-8 text-center text-xs text-slate-400">{marca.footerText}</p>
      )}
    </div>
  );
}
