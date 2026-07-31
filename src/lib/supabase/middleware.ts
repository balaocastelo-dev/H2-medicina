import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';

/** Renova a sessao e devolve o usuario para o middleware de rotas. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No primeiro preview local ou antes de configurar a Vercel, ainda nao existe
  // Supabase. Nessa fase, mantemos as rotas publicas acessiveis sem derrubar o app.
  if (!isSupabaseConfigured()) {
    return { response, user: null };
  }

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
