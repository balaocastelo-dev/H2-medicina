/**
 * Busca por nome no totem, para quem foi agendado sem CPF.
 *
 * A lista de pericias que a clinica recebe do orgao nao traz CPF — so
 * matricula e nome. Essas pessoas nao conseguiriam passar do totem pela
 * busca por documento.
 *
 * O totem fica numa area publica, entao a busca tem tres travas:
 * exige um termo minimo, so enxerga quem tem agendamento hoje, e devolve
 * o nome abreviado. Assim ninguem usa a tela de entrada para vasculhar o
 * cadastro de pacientes da clinica.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

/** Minimo de letras para a busca comecar. Menos que isso lista meio mundo. */
export const MINIMO_LETRAS = 3;

/** Teto de sugestoes na tela do totem. */
export const MAXIMO_SUGESTOES = 8;

export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function termoValido(texto: string): boolean {
  return normalizarBusca(texto).replace(/\s/g, '').length >= MINIMO_LETRAS;
}

/**
 * Nome abreviado para a tela publica: primeiro nome inteiro e a inicial de
 * cada sobrenome. "MARLENE DIAS SABINO" vira "Marlene D. S.".
 *
 * Quem se procura se reconhece; quem esta de fora nao leva nome completo.
 */
export function nomeAbreviado(nomeCompleto: string): string {
  const partes = normalizarNomeVisivel(nomeCompleto).split(' ').filter(Boolean);
  const primeiro = partes[0];
  if (!primeiro) return '';
  if (partes.length === 1) return primeiro;
  const iniciais = partes.slice(1).map((p) => `${p.charAt(0)}.`);
  return [primeiro, ...iniciais].join(' ');
}

function normalizarNomeVisivel(nome: string): string {
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return nome
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

export interface CandidatoBusca {
  patientId: string;
  nomeCompleto: string;
  scheduledAt: string | null;
}

export interface SugestaoBusca {
  patientId: string;
  /** Nome abreviado, o unico que vai para a tela. */
  nome: string;
  scheduledAt: string | null;
}

/**
 * Ordena os candidatos pelo que a pessoa digitou.
 *
 * Quem comeca com o termo vem antes de quem so o contem no meio; empate
 * desempata pelo horario agendado, que e a ordem em que a sala de espera
 * enche. Nome mais curto sobe: quem digitou "maria" quer Maria Silva
 * antes de Maria das Gracas Fernandes de Oliveira.
 */
export function ordenarSugestoes(
  candidatos: CandidatoBusca[],
  termo: string,
): SugestaoBusca[] {
  const busca = normalizarBusca(termo);
  const palavras = busca.split(' ').filter(Boolean);

  const pontuar = (nome: string): number => {
    const alvo = normalizarBusca(nome);
    if (alvo.startsWith(busca)) return 0;
    // Termo bate no comeco de algum sobrenome.
    if (alvo.split(' ').some((p) => p.startsWith(palavras[0] ?? ''))) return 1;
    if (alvo.includes(busca)) return 2;
    return 3;
  };

  return candidatos
    .filter((c) => {
      const alvo = normalizarBusca(c.nomeCompleto);
      // Todas as palavras digitadas precisam aparecer: "maria silva" nao
      // pode trazer todas as Marias da agenda.
      return palavras.every((p) => alvo.includes(p));
    })
    .map((c) => ({ candidato: c, peso: pontuar(c.nomeCompleto) }))
    .sort((a, b) => {
      if (a.peso !== b.peso) return a.peso - b.peso;
      const ha = a.candidato.scheduledAt ?? '';
      const hb = b.candidato.scheduledAt ?? '';
      if (ha !== hb) return ha.localeCompare(hb);
      return a.candidato.nomeCompleto.length - b.candidato.nomeCompleto.length;
    })
    .slice(0, MAXIMO_SUGESTOES)
    .map(({ candidato }) => ({
      patientId: candidato.patientId,
      nome: nomeAbreviado(candidato.nomeCompleto),
      scheduledAt: candidato.scheduledAt,
    }));
}
