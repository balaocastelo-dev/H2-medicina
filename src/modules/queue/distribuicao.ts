/**
 * Reparte os exames da fila entre as salas.
 *
 * Um exame aparece na sala quando foi atribuido a ela (`room_id`) ou quando o
 * tipo de exame tem aquela sala como padrao. Se nenhuma das duas coisas for
 * verdade, ele nao aparece em cartao nenhum.
 *
 * Esse era o defeito relatado pela clinica em 13/09: o topo da tela dizia
 * "5 exames na fila" e todas as salas diziam "fila vazia". Os cinco pacientes
 * existiam, estavam esperando, e nao havia como chama-los -- nenhum botao da
 * tela alcancava aquele exame.
 *
 * Por isso esta funcao devolve tambem `semSala`. Exame que nao cabe em lugar
 * nenhum precisa aparecer em algum lugar: some da tela e o paciente fica
 * esperando na clinica sem que ninguem saiba.
 */

export interface ExameDistribuivel {
  id: string;
  status: string;
  room_id: string | null;
  exam_types: { default_room_id: string | null } | null;
}

export interface SalaDistribuivel {
  id: string;
}

/** Status que ainda ocupam lugar na fila ou na sala. */
export const NA_FILA = ['pendente', 'em_fila'];
export const EM_ATENDIMENTO = ['chamado', 'em_andamento'];

export interface Distribuicao<E> {
  /** Exames de cada sala, pela chave do id da sala. */
  porSala: Map<string, E[]>;
  /** Exames que nao pertencem a nenhuma sala da lista. */
  semSala: E[];
}

export function distribuirExames<E extends ExameDistribuivel>(
  salas: SalaDistribuivel[],
  exames: E[],
): Distribuicao<E> {
  const ids = new Set(salas.map((s) => s.id));
  const porSala = new Map<string, E[]>();
  for (const s of salas) porSala.set(s.id, []);

  const semSala: E[] = [];

  for (const e of exames) {
    // `room_id` manda: foi uma escolha explicita de alguem na operacao.
    // A sala padrao do tipo de exame e so o palpite inicial.
    const alvo = e.room_id ?? e.exam_types?.default_room_id ?? null;

    if (alvo !== null && ids.has(alvo)) {
      porSala.get(alvo)!.push(e);
    } else {
      // Cai aqui tanto o exame sem sala nenhuma quanto o que aponta para uma
      // sala inativa ou apagada -- os dois somem da tela do mesmo jeito.
      semSala.push(e);
    }
  }

  return { porSala, semSala };
}

/**
 * Quantos exames a tela consegue realmente mostrar em alguma sala.
 *
 * O numero do topo passou a sair daqui. Antes ele contava a fila inteira,
 * incluindo o que nenhum cartao mostrava, e a conta nao fechava com a tela --
 * que foi exatamente o que a clinica viu.
 */
export function contarNaFila<E extends ExameDistribuivel & { status: string }>(
  distribuicao: Distribuicao<E>,
): { emSalas: number; semSala: number } {
  let emSalas = 0;
  for (const lista of distribuicao.porSala.values()) {
    emSalas += lista.filter((e) => NA_FILA.includes(e.status)).length;
  }
  return {
    emSalas,
    semSala: distribuicao.semSala.filter((e) => NA_FILA.includes(e.status)).length,
  };
}
