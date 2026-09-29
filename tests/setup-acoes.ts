/**
 * Substitui o que so existe dentro do Next, para que as server actions
 * possam ser chamadas de um teste sem nenhuma alteracao no codigo delas.
 *
 * A lista e curta de proposito. Tudo que NAO esta aqui roda de verdade:
 * `assertPermission` le as permissoes do banco pelo RLS, `audit` grava na
 * tabela de auditoria, os PDFs sao montados de verdade. Quanto menos coisa
 * substituida, mais o teste prova.
 */
import { vi } from 'vitest';

/**
 * Valores de faz-de-conta para as variaveis publicas.
 *
 * Precisam existir ANTES de qualquer import que leia `@/lib/env`, porque o
 * modulo le `process.env` no carregamento. Sem eles, metade do modulo de
 * documentos recusa a emissao com "Configuracao do Supabase incompleta" --
 * e o teste acusaria um defeito que e so ambiente faltando.
 *
 * Nao sao credenciais: nada aqui fala com servidor nenhum. O acesso ao
 * banco e substituido logo abaixo.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chave-de-faz-de-conta-para-teste-local';
process.env.NEXT_PUBLIC_APP_URL ||= 'http://localhost:3000';
process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ||= 'h2';

import { clienteDoMomento } from './integration/banco-vivo';

// O acesso ao banco: em producao monta um cliente Supabase a partir do
// cookie de sessao; aqui devolve o cliente ligado ao Postgres do teste.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => clienteDoMomento(),
}));

// `revalidatePath` e `revalidateTag` so fazem sentido dentro do Next.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

// `cookies()` e `headers()` nao sao usados pelas acoes depois da troca do
// cliente, mas algum modulo pode importa-los em cadeia.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Map(),
}));

// `redirect` lanca no Next para interromper o render. As server actions usam
// `assertPermission`, que lanca por conta propria; isto cobre os poucos
// caminhos que chamam `requireSession` fora de uma pagina.
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect(${destino})`);
  },
  notFound: () => {
    throw new Error('notFound()');
  },
}));

// `cache()` do React memoriza por requisicao. Fora do Next nao ha
// requisicao, e a memoria viraria global: o contexto do primeiro usuario
// valeria para todos os outros, e o teste de papeis provaria o contrario do
// que quer provar.
vi.mock('react', async (original) => {
  const react = (await original()) as Record<string, unknown>;
  return { ...react, cache: <T,>(fn: T) => fn };
});
