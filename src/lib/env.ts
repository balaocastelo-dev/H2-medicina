import { z } from 'zod';

/**
 * Variaveis publicas (vao para o navegador).
 *
 * A validacao e preguicosa de proposito: se o schema fosse avaliado no import,
 * um build sem as variaveis definidas quebraria na fase de compilacao, antes de
 * qualquer pagina rodar. Aqui o build passa e o erro so aparece — com mensagem
 * clara — quando algo de fato tenta falar com o Supabase.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL ausente ou invalida'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY ausente'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_DEFAULT_TENANT_SLUG: z.string().min(1),
});

/**
 * Os nomes precisam aparecer literalmente para o Next substituir no bundle
 * do cliente. Nao troque por acesso dinamico a process.env.
 */
const raw = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    '',
  // Na Vercel, cai para a URL do deploy quando NEXT_PUBLIC_APP_URL nao esta definida.
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000',
  NEXT_PUBLIC_DEFAULT_TENANT_SLUG: process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ?? 'h2',
};

let cache: z.infer<typeof publicSchema> | null = null;

function readPublicEnv(): z.infer<typeof publicSchema> {
  if (cache) return cache;
  const parsed = publicSchema.safeParse(raw);
  if (!parsed.success) {
    const faltando = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Configuracao do Supabase incompleta (${faltando}). ` +
        'Defina as variaveis de ambiente no painel do host e refaca o deploy.',
    );
  }
  cache = parsed.data;
  return cache;
}

/** Acesso as variaveis publicas, validadas na primeira leitura. */
export const publicEnv = new Proxy({} as z.infer<typeof publicSchema>, {
  get(_target, prop: string) {
    return readPublicEnv()[prop as keyof z.infer<typeof publicSchema>];
  },
});

/** true quando o app tem o minimo para falar com o Supabase. */
export function isSupabaseConfigured(): boolean {
  return publicSchema.safeParse(raw).success;
}

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
