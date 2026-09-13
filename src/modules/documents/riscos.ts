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
 * E a frase do proprio modelo da clinica. Deixar em branco seria pior:
 * campo vazio num A.S.O. sugere que a avaliacao nao foi feita, e nao que
 * nao havia risco relevante.
 */
export const SEM_RISCO_RELEVANTE = 'Não foram encontradas fontes significativas do risco.';

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

/** Preenche as cinco categorias, completando o que faltar. */
export function montarRiscos(perfil: PerfilDeRisco | null): Riscos {
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
