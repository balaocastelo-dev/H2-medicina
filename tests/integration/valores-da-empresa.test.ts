/**
 * Tabela de valores por empresa.
 *
 * "aba empresa, na hora de colocar os valores para cada exame da empresa,
 *  esta dando erro e nao ta salvando" -- Isabella, 25/09.
 *
 * A causa esta no encontro de duas decisoes que, cada uma sozinha, estava
 * certa:
 *
 *   - o indice unico da tabela e sobre uma EXPRESSAO,
 *     `(company_id, exam_type_id, coalesce(contract_id, '000...'))`,
 *     escolhida porque em Postgres dois NULOS nao sao iguais entre si:
 *     sem o coalesce, a mesma empresa poderia ter o mesmo exame gravado
 *     duas vezes sem contrato;
 *
 *   - a gravacao pedia `on conflict (company_id, exam_type_id,
 *     contract_id)` -- tres colunas simples.
 *
 * O Postgres nao casa uma coisa com a outra e recusa a instrucao inteira,
 * com o erro 42P10. Nao e "nao gravou uma linha": nao grava nada.
 *
 * Este teste fixa as duas pontas: que o caminho antigo realmente falha, e
 * que o novo grava, atualiza e apaga como a tela promete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarAmbiente, type Ambiente } from './ambiente';

let amb: Ambiente;
let usuario = '';
let empresa = '';

const um = <T,>(sql: string) => amb.um<T>(sql);
const linhas = async <T,>(sql: string): Promise<T[]> => (await amb.db.query<T>(sql)).rows;

const examePor = async (codigo: string): Promise<string> =>
  (
    await um<{ id: string }>(
      `select id from public.exam_types where tenant_id = '${amb.tenant}' and code = '${codigo}'`,
    )
  ).id;

/** O que a tela grava hoje: apaga o que saiu e insere o que ficou. */
async function gravarValores(valores: { exame: string; preco: number | null }[]): Promise<void> {
  const ids = valores.map((v) => `'${v.exame}'`).join(',');

  // So os exames que vieram no formulario. Apagar tudo levaria junto o
  // preco de um exame desativado, que a tela nem mostra.
  await amb.db.exec(`
    delete from public.company_exam_prices
     where company_id = '${empresa}' and contract_id is null
       and exam_type_id in (${ids})`);

  const comPreco = valores.filter((v) => v.preco !== null);
  if (comPreco.length === 0) return;

  const linhasSql = comPreco
    .map(
      (v) =>
        `('${amb.tenant}', '${empresa}', '${v.exame}', null, ${v.preco}, '${usuario}', '${usuario}')`,
    )
    .join(',');

  await amb.db.exec(`
    insert into public.company_exam_prices
      (tenant_id, company_id, exam_type_id, contract_id, price, created_by, updated_by)
    values ${linhasSql}`);
}

const precoDe = async (exame: string): Promise<string | null> => {
  const r = await linhas<{ price: string }>(`
    select price::text from public.company_exam_prices
     where company_id = '${empresa}' and exam_type_id = '${exame}' and contract_id is null`);
  return r[0]?.price ?? null;
};

beforeAll(async () => {
  amb = await montarAmbiente();
  usuario = await amb.criarUsuario('Administradora', 'valores@teste.com');
  empresa = (
    await um<{ id: string }>(`
      insert into public.companies (tenant_id, legal_name, document)
      values ('${amb.tenant}', 'Metalurgica Aurora Ltda', '11222333000181')
      returning id`)
  ).id;
}, 180_000);

afterAll(async () => {
  await amb?.fechar();
});

describe('o caminho antigo, que a clínica encontrou', () => {
  it('o índice único é sobre uma expressão, não sobre três colunas', async () => {
    const r = await linhas<{ definicao: string }>(`
      select indexdef as definicao from pg_indexes
       where tablename = 'company_exam_prices' and indexdef ilike '%unique%'`);
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((x) => x.definicao.toLowerCase().includes('coalesce'))).toBe(true);
  });

  it('"on conflict" em três colunas é recusado pelo Postgres', async () => {
    const exame = await examePor('AUDIO');
    let erro: string | null = null;
    try {
      await amb.db.exec(`
        insert into public.company_exam_prices
          (tenant_id, company_id, exam_type_id, contract_id, price)
        values ('${amb.tenant}', '${empresa}', '${exame}', null, 70.00)
        on conflict (company_id, exam_type_id, contract_id) do update set price = excluded.price`);
    } catch (e) {
      erro = (e as Error).message;
    }

    // 42P10: there is no unique or exclusion constraint matching the ON
    // CONFLICT specification. E o erro que a tela mostrava.
    expect(erro).not.toBeNull();
    expect(String(erro).toLowerCase()).toContain('conflict');
  });
});

describe('o caminho novo', () => {
  it('grava os valores da empresa', async () => {
    const audio = await examePor('AUDIO');
    const ecg = await examePor('ECG');

    await gravarValores([
      { exame: audio, preco: 70 },
      { exame: ecg, preco: 95.5 },
    ]);

    expect(Number(await precoDe(audio))).toBe(70);
    expect(Number(await precoDe(ecg))).toBe(95.5);
  });

  it('salvar de novo atualiza em vez de duplicar', async () => {
    const audio = await examePor('AUDIO');
    await gravarValores([{ exame: audio, preco: 80 }]);

    const todos = await linhas(`
      select id from public.company_exam_prices
       where company_id = '${empresa}' and exam_type_id = '${audio}' and contract_id is null`);
    expect(todos).toHaveLength(1);
    expect(Number(await precoDe(audio))).toBe(80);
  });

  it('campo em branco volta ao preço de tabela', async () => {
    const audio = await examePor('AUDIO');
    await gravarValores([{ exame: audio, preco: null }]);
    expect(await precoDe(audio)).toBeNull();
  });

  it('zero é preço válido — exame de cortesia existe', async () => {
    const ecg = await examePor('ECG');
    await gravarValores([{ exame: ecg, preco: 0 }]);
    expect(Number(await precoDe(ecg))).toBe(0);
    // E diferente de "sem preço próprio": a linha existe.
    expect(await precoDe(ecg)).not.toBeNull();
  });

  it('não mexe no preço de um exame que não veio no formulário', async () => {
    const audio = await examePor('AUDIO');
    const eeg = await examePor('EEG');

    await gravarValores([{ exame: eeg, preco: 200 }]);
    await gravarValores([{ exame: audio, preco: 60 }]);

    // O EEG não estava no segundo envio: o preço dele continua lá.
    expect(Number(await precoDe(eeg))).toBe(200);
    expect(Number(await precoDe(audio))).toBe(60);
  });

  it('a tabela inteira de uma vez', async () => {
    const codigos = ['AUDIO', 'ECG', 'EEG', 'ESPIRO', 'LAB', 'CLINICO'];
    const exames = await Promise.all(codigos.map(examePor));
    await gravarValores(exames.map((exame, i) => ({ exame, preco: (i + 1) * 10 })));

    for (const [i, exame] of exames.entries()) {
      expect(Number(await precoDe(exame))).toBe((i + 1) * 10);
    }
  });

  it('preço negativo continua sendo recusado pelo banco', async () => {
    const audio = await examePor('AUDIO');
    let recusou = false;
    try {
      await amb.db.exec(`
        insert into public.company_exam_prices
          (tenant_id, company_id, exam_type_id, contract_id, price)
        values ('${amb.tenant}', '${empresa}', '${audio}', null, -5)`);
    } catch {
      recusou = true;
    }
    expect(recusou).toBe(true);
  });
});

/**
 * A ligacao entre a acao e o banco nao tem como ser exercitada aqui: ela
 * passa pelo cliente do Supabase. Esta leitura do codigo-fonte e feia de
 * proposito — foi exatamente essa juncao que falhou.
 */
describe('a ação não volta a usar o conflito que não existe', () => {
  it('salvarValoresDaEmpresa não pede on conflict com contract_id', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(
      join(process.cwd(), 'src/modules/companies/empresa-actions.ts'),
      'utf8',
    );
    expect(fonte).not.toContain("onConflict: 'company_id,exam_type_id,contract_id'");
  });
});
