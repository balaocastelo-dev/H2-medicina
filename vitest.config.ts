import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 120000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unidade-e-integracao',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
        },
      },
      {
        // Testes que exercitam as SERVER ACTIONS de verdade contra um
        // Postgres real. Ficam num projeto separado porque precisam de um
        // setup que substitui `@/lib/supabase/server` — e esse setup nao
        // pode valer para os testes que falam SQL direto.
        extends: true,
        test: {
          name: 'sistema',
          include: ['tests/sistema/**/*.test.ts'],
          setupFiles: ['tests/setup-acoes.ts'],
          testTimeout: 180000,
          hookTimeout: 300000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` existe para o bundler barrar import indevido no cliente.
      // Fora do Next isso vira erro em qualquer teste que toque um modulo de
      // servidor, entao aqui ele e neutralizado.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
