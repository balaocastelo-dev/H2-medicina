import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `tenants`, `tenant_branding` e `tenant_settings` estao sob RLS, e o
 * visitante sem sessao nao passa por ela. Ler essas tabelas com o cliente
 * anonimo numa tela publica nao da erro: devolve nulo, em silencio.
 *
 * Foi assim que a tela de agendamento nasceu dizendo "indisponivel", que o
 * comprovante em PDF respondia 404 para todo codigo valido, que o login
 * nunca mostrou o logo e que o portal do paciente recusava CPF e
 * nascimento corretos. Quatro sintomas sem relacao aparente, a mesma
 * causa, descobertos um de cada vez.
 *
 * Este teste existe para o quinto nao acontecer.
 */

const RAIZ = process.cwd();

/** Arquivos que rodam no servidor e podem ser alcancados sem login. */
const AREAS_PUBLICAS = [
  'src/app/page.tsx',
  'src/app/agendar',
  'src/app/meu',
  'src/app/(auth)',
  'src/app/api/public',
  'src/modules/scheduling/publico-actions.ts',
];

function arquivos(alvo: string): string[] {
  const caminho = join(RAIZ, alvo);
  try {
    if (statSync(caminho).isFile()) return [caminho];
  } catch {
    return [];
  }
  const saida: string[] = [];
  for (const item of readdirSync(caminho, { withFileTypes: true })) {
    const filho = join(caminho, item.name);
    if (item.isDirectory()) saida.push(...arquivos(join(alvo, item.name)));
    else if (/\.tsx?$/.test(item.name)) saida.push(filho);
  }
  return saida;
}

const TABELAS_PROTEGIDAS = ['tenants', 'tenant_branding', 'tenant_settings'];

describe('telas sem login e a leitura da marca', () => {
  const todos = AREAS_PUBLICAS.flatMap(arquivos);

  it('encontra os arquivos públicos que deveria vigiar', () => {
    expect(todos.length).toBeGreaterThan(5);
  });

  it('nenhuma tela pública lê tabela protegida com o cliente anônimo', () => {
    const culpados: string[] = [];

    for (const arquivo of todos) {
      const fonte = readFileSync(arquivo, 'utf8');

      // Usa o cliente anônimo (o de sessão) em algum lugar?
      const usaAnonimo = /from '@\/lib\/supabase\/server'/.test(fonte);
      if (!usaAnonimo) continue;

      const leProtegida = TABELAS_PROTEGIDAS.some((t) =>
        new RegExp(`\\.from\\('${t}'\\)`).test(fonte),
      );
      if (leProtegida) culpados.push(arquivo.replace(RAIZ, '').replace(/\\/g, '/'));
    }

    expect(
      culpados,
      `estes arquivos leem tabela sob RLS com o cliente anônimo e vão receber nulo em silêncio:\n  ${culpados.join('\n  ')}\nUse marcaPublica() de @/modules/settings/marca-publica.`,
    ).toEqual([]);
  });

  it('marcaPublica só devolve campos de vitrine', () => {
    const fonte = readFileSync(join(RAIZ, 'src/modules/settings/marca-publica.ts'), 'utf8');

    // Nada de paciente, prontuário ou chave pode sair por esta porta.
    for (const proibido of ['patients', 'attendances', 'documents', 'payments', 'secret']) {
      expect(fonte.includes(`'${proibido}'`), `marca-publica não deve tocar ${proibido}`).toBe(
        false,
      );
    }
    // O tenant vem do ambiente, não de algo que o navegador possa escolher.
    expect(fonte).toContain('NEXT_PUBLIC_DEFAULT_TENANT_SLUG');
  });
});
