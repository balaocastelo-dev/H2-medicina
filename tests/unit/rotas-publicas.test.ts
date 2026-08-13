import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O proxy decide quem entra sem senha. Um erro aqui ou tranca a porta da
 * clinica ou abre o prontuario para a internet — nos dois casos em
 * silencio, sem erro de build. Daí o teste ler as listas do arquivo e
 * reproduzir a mesma decisão.
 */
const fonte = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');

function listaDe(nome: string): string[] {
  const bloco = fonte.match(new RegExp(`const ${nome} = \\[([\\s\\S]*?)\\];`));
  if (!bloco?.[1]) throw new Error(`Lista ${nome} não encontrada em src/proxy.ts`);
  return [...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const PREFIXOS = listaDe('PUBLIC_PREFIXES');
const EXATAS = listaDe('PUBLIC_EXACT');

/** Mesma regra do proxy. */
function ehPublica(pathname: string): boolean {
  return (
    EXATAS.includes(pathname) ||
    PREFIXOS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

describe('rotas abertas sem login', () => {
  it('deixa o visitante agendar e consultar o comprovante', () => {
    for (const rota of [
      '/',
      '/agendar',
      '/agendar/comprovante',
      '/api/public/comprovante/ABCD-2345',
      '/login',
      '/meu',
    ]) {
      expect(ehPublica(rota), `${rota} deveria ser pública`).toBe(true);
    }
  });

  it('mantém o painel e o prontuário atrás do login', () => {
    for (const rota of [
      '/dashboard',
      '/recepcao',
      '/medico',
      '/medico/123',
      '/pacientes',
      '/pacientes/123',
      '/documentos',
      '/financeiro',
      '/configuracoes',
      '/logs',
      '/jornada',
      '/agenda',
      '/agenda/avulso',
      '/empresas/contratos',
    ]) {
      expect(ehPublica(rota), `${rota} NÃO pode ser pública`).toBe(false);
    }
  });

  it('a raiz é exata, e não um prefixo que abriria tudo', () => {
    // '/' na lista de prefixos faria startsWith('/') casar com o sistema
    // inteiro. É o erro mais fácil de cometer e o mais caro.
    expect(PREFIXOS).not.toContain('/');
    expect(EXATAS).toContain('/');
  });

  it('a agenda pública não abre a agenda interna por semelhança de nome', () => {
    expect(ehPublica('/agendar')).toBe(true);
    expect(ehPublica('/agenda')).toBe(false);
  });
});
