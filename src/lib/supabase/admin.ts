import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env';

/**
 * Cliente administrativo (service role). IGNORA RLS.
 *
 * Regras de uso:
 *  - somente em Route Handlers, Server Actions ou workers;
 *  - sempre valide permissao ANTES de usar;
 *  - jamais retorne o cliente ou a chave para o navegador.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada. Defina no ambiente do servidor.');
  }
  return createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
