/**
 * Perigos e fatores de risco do A.S.O.
 *
 * O bloco e exigido pela NR-7 e vem no modelo que a clinica usa. O risco
 * nao e do paciente: e do cargo dentro da empresa. Dois motoristas da mesma
 * transportadora correm o mesmo risco; o mesmo motorista em outra empresa
 * pode correr outro.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

export type CategoriaDeRisco =
  | 'fisicos'
  | 'quimicos'
  | 'biologicos'
  | 'ergonomicos'
  | 'acidentes';

export const CATEGORIAS: { chave: CategoriaDeRisco; rotulo: string }[] = [
  { chave: 'fisicos', rotulo: 'Físicos' },
  { chave: 'quimicos', rotulo: 'Químicos' },
  { chave: 'biologicos', rotulo: 'Biológicos' },
  { chave: 'ergonomicos', rotulo: 'Ergonômicos' },
  { chave: 'acidentes', rotulo: 'Acidentes' },
];

export type Riscos = Record<CategoriaDeRisco, string>;

/**
 * Texto usado quando a categoria nao foi preenchida.
 *
 * E exatamente o que a clinica imprime hoje, conferido no A.S.O. do Roberto
 * da Silva Oliveira (09/09). Deixar em branco seria pior: campo vazio num
 * A.S.O. sugere que a avaliacao nao foi feita, e nao que nao havia risco.
 */
export const SEM_RISCO_RELEVANTE = '"S.R.O.E" Sem riscos ocupacionais específicos';

export interface PerfilDeRisco {
  cargo: string | null;
  fisicos: string | null;
  quimicos: string | null;
  biologicos: string | null;
  ergonomicos: string | null;
  acidentes: string | null;
}

function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escolhe o perfil que vale para um cargo.
 *
 * Cargo exato ganha do perfil geral da empresa; sem nenhum dos dois,
 * devolve null e o A.S.O. sai com a frase padrao em todas as categorias.
 */
export function perfilParaCargo(
  perfis: PerfilDeRisco[],
  cargo: string | null | undefined,
): PerfilDeRisco | null {
  const alvo = normalizar(cargo);

  if (alvo) {
    const exato = perfis.find((p) => p.cargo && normalizar(p.cargo) === alvo);
    if (exato) return exato;
  }

  return perfis.find((p) => !p.cargo) ?? null;
}

/**
 * Preenche as cinco categorias, completando o que faltar.
 *
 * `doPaciente` e o risco anotado no cadastro daquele empregado, pedido pela
 * clinica em 15/09: "deve existir um campo onde podemos colocar o risco
 * ocupacional do empregado da empresa".
 *
 * Quando existe, ele vence o perfil do cargo em TODAS as categorias. E o
 * caso do empregado que faz algo diferente do resto do cargo dele -- quem
 * escreveu ali sabia mais do que a tabela da empresa sabe. Misturar os dois
 * produziria um A.S.O. que ninguem escreveu.
 */
export function montarRiscos(
  perfil: PerfilDeRisco | null,
  doPaciente?: string | null,
): Riscos {
  const especifico = (doPaciente ?? '').trim();
  if (especifico) {
    // A anotacao e um texto corrido, nao cinco campos. Vai inteira na
    // primeira categoria e as outras saem com a frase padrao -- e o que o
    // modelo em papel da clinica faz.
    return {
      fisicos: especifico,
      quimicos: SEM_RISCO_RELEVANTE,
      biologicos: SEM_RISCO_RELEVANTE,
      ergonomicos: SEM_RISCO_RELEVANTE,
      acidentes: SEM_RISCO_RELEVANTE,
    };
  }

  const valor = (bruto: string | null | undefined) => {
    const texto = (bruto ?? '').trim();
    return texto || SEM_RISCO_RELEVANTE;
  };

  return {
    fisicos: valor(perfil?.fisicos),
    quimicos: valor(perfil?.quimicos),
    biologicos: valor(perfil?.biologicos),
    ergonomicos: valor(perfil?.ergonomicos),
    acidentes: valor(perfil?.acidentes),
  };
}

/** Alguma categoria tem risco de verdade? Usado para destacar na tela. */
export function temRiscoRelevante(riscos: Riscos): boolean {
  return CATEGORIAS.some(({ chave }) => riscos[chave] !== SEM_RISCO_RELEVANTE);
}

/**
 * Idade em anos completos na data do exame.
 *
 * O A.S.O. imprime "40 ANOS", e a idade tem que ser a do dia do exame, nao
 * a de hoje: um documento reemitido meses depois nao pode envelhecer o
 * trabalhador.
 */
export function idadeNaData(nascimento: string | null | undefined, naData: Date): number | null {
  if (!nascimento) return null;
  const [ano, mes, dia] = nascimento.slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return null;

  const referencia = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(naData),
  );
  const anoRef = referencia.getUTCFullYear();
  const mesRef = referencia.getUTCMonth() + 1;
  const diaRef = referencia.getUTCDate();

  let idade = anoRef - ano;
  if (mesRef < mes || (mesRef === mes && diaRef < dia)) idade -= 1;
  return idade >= 0 && idade < 130 ? idade : null;
}
