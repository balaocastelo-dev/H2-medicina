import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/** Rotas publicas (nao exigem autenticacao). */
const PUBLIC_PREFIXES = [
  '/login',
  '/esqueci-senha',
  '/redefinir-senha',
  '/aceitar-convite',
  '/loja',
  '/meu',
  // Agendamento pelo site e consulta do comprovante: quem chega aqui nao
  // tem login, e e justamente esse o ponto.
  '/agendar',
  '/verificar',
  '/api/public',
  '/api/health',
  '/api/webhooks',
  '/manifest.webmanifest',
];

/**
 * Rotas publicas de caminho exato.
 *
 * A raiz precisa ficar aqui, e nao na lista de prefixos: `startsWith('/')`
 * casa com tudo e abriria o sistema inteiro.
 */
const PUBLIC_EXACT = ['/'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let response = NextResponse.next({ request });
  let user = null;

  // Em produção, qualquer falha transitória do Supabase/Auth na borda não deve
  // derrubar o deploy com MIDDLEWARE_INVOCATION_FAILED.
  try {
    if (!isPublic || pathname === '/' || pathname === '/login') {
      const session = await updateSession(request);
      response = session.response;
      user = session.user;
    }
  } catch {
    if (isPublic) {
      return response;
    }
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('proximo', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/')) {
    // `sessao=sem-perfil` quebra o pingue-pongue.
    //
    // O proxy conhece o cookie de autenticacao; nao conhece o PERFIL. Um
    // usuario autenticado no Supabase mas sem `profiles`, sem papel, com
    // `tenant_id` nulo, inativo ou bloqueado tem sessao valida e
    // `getSessionContext()` nulo — entao `/dashboard` mandava para `/login`,
    // o proxy via a sessao e mandava de volta para `/dashboard`:
    // ERR_TOO_MANY_REDIRECTS, tela branca do navegador, nenhuma mensagem.
    //
    // Acontece em dois momentos reais: no primeiro acesso, se o INSERT do
    // perfil sair errado; e quando um usuario e bloqueado com a aba aberta,
    // porque bloquear nao encerra a sessao no Supabase Auth.
    //
    // Com a marca na URL, `/login` sabe que veio de volta por falta de
    // perfil e mostra o motivo em vez de redirecionar de novo.
    if (request.nextUrl.searchParams.get('sessao') === 'sem-perfil') {
      return response;
    }
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
