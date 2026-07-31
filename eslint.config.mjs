import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const config = [
  ...(Array.isArray(next) ? next : [next]),
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'supabase/**',
      'playwright-report/**',
      'test-results/**',
      'scripts/*.mjs',
    ],
  },
  {
    rules: {
      // Tipagem explicita e obrigatoria em todo o projeto.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
]

export default config;
