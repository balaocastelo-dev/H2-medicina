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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
