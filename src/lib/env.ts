import { z } from 'zod';

/** Variaveis publicas (podem ir ao navegador). */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL invalida'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY ausente'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_DEFAULT_TENANT_SLUG: z.string().default('h2'),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  NEXT_PUBLIC_DEFAULT_TENANT_SLUG: process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ?? 'h2',
});

/**
 * Segredos. Só pode ser chamado em codigo server-side.
 * Nunca importe este helper em componentes client.
 */
export function serverEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() nao pode ser usado no navegador.');
  }
  return {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL ?? '',
    SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY ?? '',
    SCRAPER_WORKER_TOKEN: process.env.SCRAPER_WORKER_TOKEN ?? '',
  };
}
