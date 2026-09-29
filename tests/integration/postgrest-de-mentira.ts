/**
 * Um PostgREST de mentira sobre um Postgres de verdade.
 *
 * ---------------------------------------------------------------------
 * Por que isto existe
 * ---------------------------------------------------------------------
 * Todos os testes do projeto falavam SQL direto com o banco. Mas os defeitos
 * que a clinica vem encontrando nao estao no SQL nem nas funcoes puras --
 * estao na camada entre a tela e o banco, que e a unica que nenhum teste
 * exercitava:
 *
 *   - o exame de bancada que nunca mudava de status (21/09);
 *   - o `finished_at` que desassinava uma consulta ja assinada (22/09);
 *   - o embed que volta OBJETO e era lido como array (23/09, tres queixas
 *     de uma causa so);
 *   - o `on conflict` que o banco recusa inteiro (28/09);
 *   - a gravacao barrada pelo RLS que afeta zero linhas em silencio (29/09);
 *   - a sala que so e liberada por codigo da aplicacao.
 *
 * Nenhum deles aparece num teste de SQL, porque nenhum deles esta no SQL.
 *
 * Com este modulo os testes chamam as SERVER ACTIONS de verdade -- o mesmo
 * codigo que roda quando alguem clica na tela -- contra um Postgres real,
 * com o RLS ligado e com o papel real do usuario. E a unica forma de provar
 * que os modulos funcionam juntos, e nao so cada um sozinho.
 *
 * ---------------------------------------------------------------------
 * O que ele imita, e por que a fidelidade importa
 * ---------------------------------------------------------------------
 * Nao basta "buscar no banco". O PostgREST tem comportamentos proprios que
 * ja produziram defeito em producao, e sao justamente esses que precisam ser
 * reproduzidos com exatidao:
 *
 *   - EMBED UM-PARA-UM volta objeto, nao array. `triages(*)` devolve `{...}`
 *     quando ha unique em `attendance_id`, e `[{...}]` quando nao ha. Ler
 *     `?.[0]` de um objeto devolve `undefined` em silencio -- foi isso que
 *     apagou a triagem da tela do medico.
 *   - `.single()` levanta erro quando o resultado nao tem exatamente uma
 *     linha; `.maybeSingle()` levanta com mais de uma. Um `maybeSingle` que
 *     encontra duas linhas devolve erro, e codigo que ignora o erro conclui
 *     "nao existe" justamente quando existe demais.
 *   - INSERT barrado pelo RLS LEVANTA erro; UPDATE barrado apenas nao
 *     encontra linha nenhuma, sem erro. Os dois casos precisam continuar
 *     diferentes aqui, senao o teste nao reproduz o silencio.
 *   - `upsert` com `onConflict` vira `on conflict (cols) do update`, que o
 *     Postgres recusa por inteiro quando nao ha indice correspondente.
 */
import type { PGlite } from '@electric-sql/pglite';

/* ------------------------------------------------------------------ */
/* Mapa de relacionamentos, para saber a forma de cada embed           */
/* ------------------------------------------------------------------ */

interface Ligacao {
  /** Tabela do outro lado. */
  destino: string;
  /** Coluna da tabela de origem usada na juncao. */
  colunaLocal: string;
  /** Coluna da tabela de destino usada na juncao. */
  colunaRemota: string;
  /** Verdadeiro quando o PostgREST devolve objeto em vez de array. */
  umSo: boolean;
}

export interface Esquema {
  /** origem -> nome do embed -> ligacao */
  ligacoes: Map<string, Map<string, Ligacao>>;
  /** tabela -> colunas */
  colunas: Map<string, Set<string>>;
  /** "tabela.coluna" -> tipo do Postgres, para serializar como JSON. */
  tipos: Map<string, string>;
}

/**
 * Converte o valor do driver para o que chegaria pela rede.
 *
 * O PostgREST devolve JSON. Uma coluna `date` vira a string "1985-11-25", e
 * nao um objeto Date; `numeric` vira numero. O driver do Postgres devolve
 * objetos e strings, e essa diferenca nao e detalhe: o sistema trata data de
 * nascimento com operacoes de texto, e um Date ali quebraria o A.S.O.
 *
 * Sem esta conversao o simulador acusaria defeitos que nao existem em
 * producao -- e um simulador que mente e pior que nenhum.
 */
function comoJson(valor: unknown, tipo: string | undefined): unknown {
  if (valor === null || valor === undefined) return null;

  if (valor instanceof Date) {
    // `date` nao tem hora nem fuso: a data pura, como o PostgREST manda.
    if (tipo === 'date') {
      const a = valor.getUTCFullYear();
      const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
      const d = String(valor.getUTCDate()).padStart(2, '0');
      return `${a}-${m}-${d}`;
    }
    return valor.toISOString();
  }

  // `numeric` chega como texto do driver e como numero pelo PostgREST.
  if (typeof valor === 'string' && (tipo === 'numeric' || tipo === 'int8')) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : valor;
  }

  return valor;
}

/**
 * Le as chaves estrangeiras e os indices unicos do banco.
 *
 * A forma do embed nao e escolha do programador: ela sai do esquema. Por
 * isso e lida daqui, e nao declarada a mao -- uma declaracao a mao teria o
 * mesmo defeito que o codigo de producao tinha.
 */
export async function lerEsquema(db: PGlite): Promise<Esquema> {
  const fks = await db.query<{
    origem: string;
    coluna_origem: string;
    destino: string;
    coluna_destino: string;
  }>(`
    select
      o.relname   as origem,
      ao.attname  as coluna_origem,
      d.relname   as destino,
      ad.attname  as coluna_destino
    from pg_constraint c
    join pg_class o on o.oid = c.conrelid
    join pg_class d on d.oid = c.confrelid
    join pg_namespace n on n.oid = o.relnamespace
    join lateral unnest(c.conkey)  with ordinality as ko(att, ord) on true
    join lateral unnest(c.confkey) with ordinality as kd(att, ord) on ko.ord = kd.ord
    join pg_attribute ao on ao.attrelid = o.oid and ao.attnum = ko.att
    join pg_attribute ad on ad.attrelid = d.oid and ad.attnum = kd.att
    where c.contype = 'f' and n.nspname = 'public'
      and array_length(c.conkey, 1) = 1`);

  // Uma coluna com indice unico de coluna unica: o lado "muitos" vira um so.
  const unicos = await db.query<{ tabela: string; coluna: string }>(`
    select t.relname as tabela, a.attname as coluna
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
     where i.indisunique and n.nspname = 'public'
       and i.indnatts = 1 and i.indpred is null and i.indexprs is null`);

  const ehUnico = new Set(unicos.rows.map((u) => `${u.tabela}.${u.coluna}`));

  const colunasRes = await db.query<{ tabela: string; coluna: string; tipo: string }>(`
    select table_name as tabela, column_name as coluna, udt_name as tipo
      from information_schema.columns where table_schema = 'public'`);
  const colunas = new Map<string, Set<string>>();
  const tipos = new Map<string, string>();
  for (const c of colunasRes.rows) {
    if (!colunas.has(c.tabela)) colunas.set(c.tabela, new Set());
    colunas.get(c.tabela)!.add(c.coluna);
    tipos.set(`${c.tabela}.${c.coluna}`, c.tipo);
  }

  const ligacoes = new Map<string, Map<string, Ligacao>>();
  const por = (t: string) => {
    if (!ligacoes.has(t)) ligacoes.set(t, new Map());
    return ligacoes.get(t)!;
  };

  for (const fk of fks.rows) {
    // Do lado de quem tem a coluna: e sempre UM so.
    // `patient_exams.exam_types(...)` -> objeto.
    por(fk.origem).set(fk.destino, {
      destino: fk.destino,
      colunaLocal: fk.coluna_origem,
      colunaRemota: fk.coluna_destino,
      umSo: true,
    });
    // O embed tambem pode ser pedido pelo NOME DA COLUNA, quando ha mais de
    // uma chave para a mesma tabela: `rooms:default_room_id(kind)`.
    por(fk.origem).set(fk.coluna_origem, {
      destino: fk.destino,
      colunaLocal: fk.coluna_origem,
      colunaRemota: fk.coluna_destino,
      umSo: true,
    });

    // Do lado de quem e apontado: sao MUITOS, a menos que a coluna do outro
    // lado seja unica -- e ai o PostgREST devolve objeto.
    //
    // Esta linha e o defeito de 23/09 escrito como regra.
    const jaTem = por(fk.destino).get(fk.origem);
    if (!jaTem) {
      por(fk.destino).set(fk.origem, {
        destino: fk.origem,
        colunaLocal: fk.coluna_destino,
        colunaRemota: fk.coluna_origem,
        umSo: ehUnico.has(`${fk.origem}.${fk.coluna_origem}`),
      });
    }
  }

  return { ligacoes, colunas, tipos };
}

/* ------------------------------------------------------------------ */
/* Leitura da lista de colunas pedida no select                        */
/* ------------------------------------------------------------------ */

interface Campo {
  /** Nome que sai no resultado. */
  apelido: string;
  /** Coluna simples, quando nao e embed. */
  coluna?: string;
  /** Embed: nome da relacao pedida e o que se quer dela. */
  relacao?: string;
  filhos?: Campo[];
  /** `!inner` exige que o embed exista. */
  obrigatorio?: boolean;
}

/**
 * Separa `a, b:c, rel(x, y), rel2!inner(*)` respeitando os parenteses.
 *
 * Escrito a mao de proposito: e o unico jeito de errar igual ao PostgREST
 * quando a sintaxe tem aninhamento.
 */
export function lerSelect(texto: string): Campo[] {
  const campos: Campo[] = [];
  let nivel = 0;
  let atual = '';
  const pedacos: string[] = [];

  for (const ch of texto) {
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (ch === ',' && nivel === 0) {
      pedacos.push(atual);
      atual = '';
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) pedacos.push(atual);

  for (const bruto of pedacos) {
    const pedaco = bruto.trim();
    if (!pedaco) continue;

    const abre = pedaco.indexOf('(');
    if (abre === -1) {
      // Coluna simples, com ou sem apelido: `nome` ou `apelido:coluna`.
      const [a, b] = pedaco.split(':').map((s) => s.trim());
      campos.push(b ? { apelido: a!, coluna: b } : { apelido: a!, coluna: a });
      continue;
    }

    let cabeca = pedaco.slice(0, abre).trim();
    const dentro = pedaco.slice(abre + 1, pedaco.lastIndexOf(')'));

    const obrigatorio = cabeca.includes('!inner');
    cabeca = cabeca.replace('!inner', '').replace('!left', '').trim();

    // `apelido:relacao(...)` ou `relacao(...)`
    const [a, b] = cabeca.split(':').map((s) => s.trim());
    const apelido = a!;
    const relacao = b ?? a!;

    campos.push({ apelido, relacao, obrigatorio, filhos: lerSelect(dentro) });
  }

  return campos;
}

/* ------------------------------------------------------------------ */
/* Valores para SQL                                                    */
/* ------------------------------------------------------------------ */

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ */
/* Erros com a forma que o cliente do Supabase devolve                 */
/* ------------------------------------------------------------------ */

export interface ErroPostgrest {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

function comoErro(e: unknown): ErroPostgrest {
  const err = e as { message?: string; code?: string; detail?: string; hint?: string };
  return {
    message: err?.message ?? String(e),
    code: err?.code ?? 'XX000',
    details: err?.detail ?? null,
    hint: err?.hint ?? null,
  };
}

export interface Resposta<T> {
  data: T | null;
  error: ErroPostgrest | null;
  count?: number | null;
}

/* ------------------------------------------------------------------ */
/* O construtor de consulta                                            */
/* ------------------------------------------------------------------ */

type Filtro = { sql: string };

class Construtor<T = unknown> implements PromiseLike<Resposta<T>> {
  private filtros: Filtro[] = [];
  private campos: Campo[] = [{ apelido: '*', coluna: '*' }];
  private ordens: string[] = [];
  private teto: number | null = null;
  private pulo = 0;
  private modo: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private carga: Record<string, unknown>[] = [];
  private conflito: string | null = null;
  private devolve = false;
  private unico: 'nao' | 'exatamente_um' | 'zero_ou_um' = 'nao';
  private contar = false;

  constructor(
    private db: PGlite,
    private esquema: Esquema,
    private tabela: string,
  ) {}

  /* ---------------- seleção ---------------- */

  select(cols = '*', opcoes?: { count?: string; head?: boolean }): this {
    this.campos = lerSelect(cols);
    if (opcoes?.count) this.contar = true;
    if (this.modo !== 'select') this.devolve = true;
    return this;
  }

  /* ---------------- filtros ---------------- */

  private add(sql: string): this {
    this.filtros.push({ sql });
    return this;
  }

  eq(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} = ${literal(v)}`);
  }
  neq(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} is distinct from ${literal(v)}`);
  }
  gt(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} > ${literal(v)}`);
  }
  gte(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} >= ${literal(v)}`);
  }
  lt(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} < ${literal(v)}`);
  }
  lte(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} <= ${literal(v)}`);
  }
  like(col: string, v: string) {
    return this.add(`${this.coluna(col)} like ${literal(v)}`);
  }
  ilike(col: string, v: string) {
    return this.add(`${this.coluna(col)} ilike ${literal(v)}`);
  }
  is(col: string, v: unknown) {
    const alvo = v === null ? 'null' : v === true ? 'true' : v === false ? 'false' : literal(v);
    return this.add(`${this.coluna(col)} is ${alvo}`);
  }
  in(col: string, vs: unknown[]) {
    if (vs.length === 0) return this.add('false');
    return this.add(`${this.coluna(col)} in (${vs.map(literal).join(',')})`);
  }
  contains(col: string, v: unknown) {
    return this.add(`${this.coluna(col)} @> ${literal(v)}`);
  }
  match(criterios: Record<string, unknown>) {
    for (const [k, v] of Object.entries(criterios)) this.eq(k, v);
    return this;
  }

  /**
   * `not('status', 'in', '("a","b")')` — a forma crua que o PostgREST aceita.
   */
  not(col: string, operador: string, valor: unknown): this {
    if (operador === 'in') {
      const lista = String(valor).replace(/^\(|\)$/g, '');
      const itens = lista
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      if (itens.length === 0) return this;
      return this.add(`${this.coluna(col)} not in (${itens.map(literal).join(',')})`);
    }
    if (operador === 'is') {
      const alvo = valor === null ? 'null' : literal(valor);
      return this.add(`${this.coluna(col)} is not ${alvo}`);
    }
    return this.add(`not (${this.coluna(col)} ${operador} ${literal(valor)})`);
  }

  /** `or('a.eq.1,b.is.null')` */
  or(expressao: string): this {
    const partes = expressao.split(',').map((p) => {
      const [col, op, ...resto] = p.split('.');
      const valor = resto.join('.');
      if (op === 'is') return `${this.coluna(col!)} is ${valor === 'null' ? 'null' : valor}`;
      if (op === 'eq') return `${this.coluna(col!)} = ${literal(valor)}`;
      if (op === 'neq') return `${this.coluna(col!)} is distinct from ${literal(valor)}`;
      if (op === 'gte') return `${this.coluna(col!)} >= ${literal(valor)}`;
      if (op === 'lte') return `${this.coluna(col!)} <= ${literal(valor)}`;
      if (op === 'gt') return `${this.coluna(col!)} > ${literal(valor)}`;
      if (op === 'lt') return `${this.coluna(col!)} < ${literal(valor)}`;
      if (op === 'ilike') return `${this.coluna(col!)} ilike ${literal(valor.replace(/\*/g, '%'))}`;
      throw new Error(`operador nao suportado em or(): ${op}`);
    });
    return this.add(`(${partes.join(' or ')})`);
  }

  filter(col: string, operador: string, valor: unknown): this {
    if (operador === 'eq') return this.eq(col, valor);
    if (operador === 'is') return this.is(col, valor);
    if (operador === 'in') return this.not(col, 'nada', valor), this;
    throw new Error(`operador nao suportado em filter(): ${operador}`);
  }

  private coluna(nome: string): string {
    return `"${nome.replace(/"/g, '')}"`;
  }

  /* ---------------- modificadores ---------------- */

  order(col: string, opcoes?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const dir = opcoes?.ascending === false ? 'desc' : 'asc';
    const nulos = opcoes?.nullsFirst ? 'nulls first' : 'nulls last';
    this.ordens.push(`${this.coluna(col)} ${dir} ${nulos}`);
    return this;
  }

  limit(n: number): this {
    this.teto = n;
    return this;
  }

  range(de: number, ate: number): this {
    this.pulo = de;
    this.teto = ate - de + 1;
    return this;
  }

  single(): this {
    this.unico = 'exatamente_um';
    return this;
  }

  maybeSingle(): this {
    this.unico = 'zero_ou_um';
    return this;
  }

  /** So tipagem no codigo de producao; aqui nao muda nada. */
  returns(): this {
    return this;
  }

  /* ---------------- escrita ---------------- */

  insert(linhas: Record<string, unknown> | Record<string, unknown>[]): this {
    this.modo = 'insert';
    this.carga = Array.isArray(linhas) ? linhas : [linhas];
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.modo = 'update';
    this.carga = [patch];
    return this;
  }

  upsert(
    linhas: Record<string, unknown> | Record<string, unknown>[],
    opcoes?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.modo = 'upsert';
    this.carga = Array.isArray(linhas) ? linhas : [linhas];
    this.conflito = opcoes?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this.modo = 'delete';
    return this;
  }

  /* ---------------- execução ---------------- */

  private get onde(): string {
    return this.filtros.length ? `where ${this.filtros.map((f) => f.sql).join(' and ')}` : '';
  }

  private async executar(): Promise<Resposta<T>> {
    try {
      const linhas = await this.rodar();
      return this.aplicarUnico(linhas);
    } catch (e) {
      return { data: null, error: comoErro(e) };
    }
  }

  private async rodar(): Promise<Record<string, unknown>[]> {
    if (this.modo === 'select') return this.selecionar();

    if (this.modo === 'insert' || this.modo === 'upsert') {
      if (this.carga.length === 0) return [];
      const cols = [...new Set(this.carga.flatMap((l) => Object.keys(l)))];
      const valores = this.carga
        .map((l) => `(${cols.map((c) => literal(l[c])).join(',')})`)
        .join(',');

      let conflito = '';
      if (this.modo === 'upsert') {
        const alvo = this.conflito ?? 'id';
        const chaves = alvo.split(',').map((s) => s.trim());
        const atualizaveis = cols.filter((c) => !chaves.includes(c));
        conflito = atualizaveis.length
          ? ` on conflict (${chaves.map((c) => this.coluna(c)).join(',')}) do update set ${atualizaveis
              .map((c) => `${this.coluna(c)} = excluded.${this.coluna(c)}`)
              .join(',')}`
          : ` on conflict (${chaves.map((c) => this.coluna(c)).join(',')}) do nothing`;
      }

      const sql = `insert into public.${this.tabela} (${cols.map((c) => this.coluna(c)).join(',')}) values ${valores}${conflito} returning *`;
      const r = await this.db.query<Record<string, unknown>>(sql);
      return this.devolve ? this.projetarTodas(r.rows) : [];
    }

    if (this.modo === 'update') {
      const patch = this.carga[0] ?? {};
      const sets = Object.entries(patch)
        .map(([k, v]) => `${this.coluna(k)} = ${literal(v)}`)
        .join(',');
      if (!sets) return [];
      const sql = `update public.${this.tabela} set ${sets} ${this.onde} returning *`;
      const r = await this.db.query<Record<string, unknown>>(sql);
      return this.devolve ? this.projetarTodas(r.rows) : [];
    }

    // delete
    const sql = `delete from public.${this.tabela} ${this.onde} returning *`;
    const r = await this.db.query<Record<string, unknown>>(sql);
    return this.devolve ? this.projetarTodas(r.rows) : [];
  }

  private async selecionar(): Promise<Record<string, unknown>[]> {
    const ordem = this.ordens.length ? `order by ${this.ordens.join(',')}` : '';
    const teto = this.teto !== null ? `limit ${this.teto}` : '';
    const pulo = this.pulo ? `offset ${this.pulo}` : '';
    const sql = `select * from public.${this.tabela} ${this.onde} ${ordem} ${teto} ${pulo}`;
    const r = await this.db.query<Record<string, unknown>>(sql);
    return this.projetarTodas(r.rows);
  }

  private async projetarTodas(
    linhas: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const saida: Record<string, unknown>[] = [];
    for (const linha of linhas) {
      const projetada = await this.projetar(this.tabela, linha, this.campos);
      if (projetada) saida.push(projetada);
    }
    return saida;
  }

  /** Monta uma linha do resultado: colunas simples e embeds. */
  private async projetar(
    tabela: string,
    linha: Record<string, unknown>,
    campos: Campo[],
  ): Promise<Record<string, unknown> | null> {
    const fora: Record<string, unknown> = {};

    const tipoDe = (col: string) => this.esquema.tipos.get(`${tabela}.${col}`);

    for (const campo of campos) {
      if (campo.coluna === '*') {
        for (const [k, v] of Object.entries(linha)) fora[k] = comoJson(v, tipoDe(k));
        continue;
      }

      if (!campo.relacao) {
        fora[campo.apelido] = comoJson(linha[campo.coluna!], tipoDe(campo.coluna!));
        continue;
      }

      const ligacao = this.esquema.ligacoes.get(tabela)?.get(campo.relacao);
      if (!ligacao) {
        throw new Error(
          `embed desconhecido: ${tabela} -> ${campo.relacao}. ` +
            'Se a relacao existe no banco, o PostgREST tambem a encontraria; ' +
            'se nao existe, o codigo de producao quebraria aqui.',
        );
      }

      const valor = linha[ligacao.colunaLocal];
      let filhas: Record<string, unknown>[] = [];
      if (valor !== null && valor !== undefined) {
        const r = await this.db.query<Record<string, unknown>>(
          `select * from public.${ligacao.destino} where "${ligacao.colunaRemota}" = ${literal(valor)}`,
        );
        filhas = r.rows;
      }

      if (campo.obrigatorio && filhas.length === 0) return null;

      const projetadas: Record<string, unknown>[] = [];
      for (const f of filhas) {
        const p = await this.projetar(ligacao.destino, f, campo.filhos ?? []);
        if (p) projetadas.push(p);
      }

      if (campo.obrigatorio && projetadas.length === 0) return null;

      // A regra que custou tres queixas num dia so: um-para-um vira OBJETO.
      fora[campo.apelido] = ligacao.umSo ? (projetadas[0] ?? null) : projetadas;
    }

    return fora;
  }

  private aplicarUnico(linhas: Record<string, unknown>[]): Resposta<T> {
    if (this.unico === 'nao') {
      return { data: linhas as T, error: null, count: this.contar ? linhas.length : null };
    }
    if (linhas.length === 1) return { data: linhas[0] as T, error: null };

    if (this.unico === 'zero_ou_um') {
      if (linhas.length === 0) return { data: null, error: null };
      // Mais de uma linha em maybeSingle E erro no PostgREST. Codigo que
      // ignora o erro conclui "nao existe" justamente quando existe demais
      // -- foi assim que a agenda colada duplicou.
      return {
        data: null,
        error: {
          message: 'JSON object requested, multiple (or no) rows returned',
          code: 'PGRST116',
          details: `Results contain ${linhas.length} rows`,
          hint: null,
        },
      };
    }

    return {
      data: null,
      error: {
        message: 'JSON object requested, multiple (or no) rows returned',
        code: 'PGRST116',
        details: `Results contain ${linhas.length} rows`,
        hint: null,
      },
    };
  }

  then<R1 = Resposta<T>, R2 = never>(
    aoCumprir?: ((v: Resposta<T>) => R1 | PromiseLike<R1>) | null,
    aoFalhar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.executar().then(aoCumprir, aoFalhar);
  }
}

/* ------------------------------------------------------------------ */
/* Armazenamento de mentira                                            */
/* ------------------------------------------------------------------ */

/**
 * O Storage guarda os arquivos em memoria.
 *
 * Nao e enfeite: o kit de saida e o A.S.O. gravam PDF e depois procuram o
 * caminho gravado em `documents.file_path`. Sem um armazenamento que aceite
 * e devolva, metade do modulo de documentos nao roda no teste.
 */
export class ArmazenamentoDeMentira {
  readonly arquivos = new Map<string, Uint8Array>();

  from(balde: string) {
    const chave = (caminho: string) => `${balde}/${caminho}`;
    return {
      upload: async (caminho: string, corpo: Blob | ArrayBuffer | Uint8Array) => {
        if (this.arquivos.has(chave(caminho))) {
          return { data: null, error: { message: 'The resource already exists' } };
        }
        let bytes: Uint8Array;
        if (corpo instanceof Uint8Array) bytes = corpo;
        else if (corpo instanceof ArrayBuffer) bytes = new Uint8Array(corpo);
        else bytes = new Uint8Array(await (corpo as Blob).arrayBuffer());
        this.arquivos.set(chave(caminho), bytes);
        return { data: { path: caminho }, error: null };
      },
      download: async (caminho: string) => {
        const b = this.arquivos.get(chave(caminho));
        if (!b) return { data: null, error: { message: 'Object not found' } };
        return { data: new Blob([new Uint8Array(b)]), error: null };
      },
      createSignedUrl: async (caminho: string) => {
        if (!this.arquivos.has(chave(caminho))) {
          return { data: null, error: { message: 'Object not found' } };
        }
        return { data: { signedUrl: `memoria://${chave(caminho)}` }, error: null };
      },
      remove: async (caminhos: string[]) => {
        for (const c of caminhos) this.arquivos.delete(chave(c));
        return { data: null, error: null };
      },
      getPublicUrl: (caminho: string) => ({
        data: { publicUrl: `memoria://${chave(caminho)}` },
      }),
    };
  }
}

/* ------------------------------------------------------------------ */
/* O cliente                                                           */
/* ------------------------------------------------------------------ */

export interface ClienteDeMentira {
  from(tabela: string): Construtor;
  rpc(nome: string, args?: Record<string, unknown>): PromiseLike<Resposta<unknown>>;
  auth: { getUser(): Promise<{ data: { user: { id: string; email: string } | null } }> };
  storage: ArmazenamentoDeMentira;
}

export function criarClienteDeMentira(
  db: PGlite,
  esquema: Esquema,
  storage: ArmazenamentoDeMentira,
  /** Quem esta logado. Null simula visitante sem sessao. */
  usuario: () => { id: string; email: string } | null,
): ClienteDeMentira {
  return {
    from: (tabela: string) => new Construtor(db, esquema, tabela),

    rpc(nome: string, args: Record<string, unknown> = {}) {
      const params = Object.entries(args)
        .map(([k, v]) => `${k} => ${literal(v)}`)
        .join(', ');
      const executar = async (): Promise<Resposta<unknown>> => {
        try {
          const r = await db.query<Record<string, unknown>>(
            `select public.${nome}(${params}) as resultado`,
          );
          return { data: r.rows[0]?.resultado ?? null, error: null };
        } catch (e) {
          return { data: null, error: comoErro(e) };
        }
      };
      return { then: (ok, falha) => executar().then(ok, falha) };
    },

    auth: {
      async getUser() {
        return { data: { user: usuario() } };
      },
    },

    storage,
  };
}
