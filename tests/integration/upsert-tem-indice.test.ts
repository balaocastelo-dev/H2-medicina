/**
 * Todo `upsert` precisa de um indice unico que o Postgres saiba inferir.
 *
 * Em 25/09 a clinica nao conseguia salvar a tabela de valores por empresa.
 * A causa: a gravacao pedia
 *
 *     on conflict (company_id, exam_type_id, contract_id)
 *
 * e o indice unico da tabela era sobre uma EXPRESSAO,
 * `(company_id, exam_type_id, coalesce(contract_id, '000...'))`. O Postgres
 * nao casa as duas coisas e recusa a instrucao inteira, com o erro 42P10.
 * Nao era "uma linha nao gravou": nao gravava nada.
 *
 * Nada disso aparece em `tsc`, em lint ou nos testes das telas -- so
 * aparece na hora em que alguem clica em salvar. Este teste le TODOS os
 * `upsert` do codigo, pergunta ao banco de verdade se existe indice que
 * sirva, e falha antes de a clinica descobrir.
 *
 * As tres regras que o Postgres usa para inferir o indice:
 *   - o indice tem de ser unico;
 *   - as colunas tem de ser colunas mesmo, nao expressoes;
 *   - o indice nao pode ser parcial (ter `where`), porque a instrucao de
 *     gravacao nao tem como repetir o filtro.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;

beforeAll(async () => {
  amb = await montarAmbiente();
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

/** Todos os arquivos .ts/.tsx de src. */
function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

interface UsoDeUpsert {
  arquivo: string;
  tabela: string;
  colunas: string[];
}

/**
 * Acha os pares `from('tabela') ... onConflict: 'a,b'` no codigo.
 *
 * A distancia entre os dois e curta na pratica: o `onConflict` e o segundo
 * argumento do mesmo `upsert`. A busca olha no maximo 900 caracteres a
 * frente para nao casar com um `from` de outra consulta.
 */
function acharUsos(): UsoDeUpsert[] {
  const raiz = join(process.cwd(), 'src');
  const usos: UsoDeUpsert[] = [];

  for (const arquivo of arquivos(raiz)) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const m of fonte.matchAll(/onConflict:\s*'([^']+)'/g)) {
      const antes = fonte.slice(Math.max(0, (m.index ?? 0) - 900), m.index);
      const tabelas = [...antes.matchAll(/\.from\('([a-z_]+)'\)/g)];
      const tabela = tabelas[tabelas.length - 1]?.[1];
      if (!tabela) continue;

      usos.push({
        arquivo: arquivo.replace(raiz, 'src').replace(/\\/g, '/'),
        tabela,
        colunas: (m[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean),
      });
    }
  }
  return usos;
}

const USOS = acharUsos();

/** Conjuntos de colunas de cada indice unico simples (sem expressao, sem where). */
async function indicesUnicos(tabela: string): Promise<string[][]> {
  const r = await amb.db.query<{ colunas: string[] | null; expressao: boolean; parcial: boolean }>(`
    select array_agg(a.attname order by k.ord) as colunas,
           bool_or(k.attnum = 0) as expressao,
           (i.indpred is not null) as parcial
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      left join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
     where n.nspname = 'public' and c.relname = '${tabela}' and i.indisunique
     group by i.indexrelid, i.indpred`);

  return r.rows
    .filter((x) => !x.expressao && !x.parcial && x.colunas !== null)
    .map((x) => (x.colunas ?? []).filter((c): c is string => c !== null));
}

describe('os upsert do projeto', () => {
  it('foram encontrados no código', () => {
    // Se a busca parar de achar, o teste vira decoração silenciosa.
    expect(USOS.length).toBeGreaterThan(3);
  });

  it.each(USOS)(
    '$arquivo: upsert em $tabela por [$colunas] tem índice que serve',
    async ({ tabela, colunas }) => {
      const indices = await indicesUnicos(tabela);

      const serve = indices.some(
        (idx) =>
          idx.length === colunas.length && colunas.every((c) => idx.includes(c)),
      );

      if (!serve) {
        // A mensagem precisa dizer o que existe, senão quem lê o erro
        // repete a mesma busca que este teste já fez.
        const todos = await amb.db.query<{ definicao: string }>(
          `select indexdef as definicao from pg_indexes
            where schemaname = 'public' and tablename = '${tabela}'`,
        );
        throw new Error(
          `Não há índice único simples em ${tabela} (${colunas.join(', ')}). ` +
            `O Postgres recusaria o upsert inteiro com o erro 42P10.\n` +
            `Índices desta tabela:\n  ${todos.rows.map((x) => x.definicao).join('\n  ')}`,
        );
      }

      expect(serve).toBe(true);
    },
  );
});
