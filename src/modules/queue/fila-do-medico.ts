/**
 * Ordem de chamada da fila do medico.
 *
 * A mesma regra das salas de exame: prioridade primeiro, empate resolvido
 * por quem chegou antes. Fica aqui, e nao dentro da tela ou da Server
 * Action, porque as duas precisam concordar — se a lista mostrasse uma
 * ordem e o botao chamasse outra pessoa, a recepcao perderia a confianca
 * na fila.
 */

/** Menor peso e chamado primeiro. */
const PESO: Record<string, number> = { prioritario: 0, encaixe: 1, normal: 2 };

export interface EsperandoMedico {
  priority: string;
  checkin_at: string;
}

export function pesoDaPrioridade(prioridade: string): number {
  return PESO[prioridade] ?? PESO.normal!;
}

/** Devolve uma nova lista na ordem de chamada, sem alterar a original. */
export function ordenarFilaDoMedico<T extends EsperandoMedico>(fila: readonly T[]): T[] {
  return [...fila].sort(
    (a, b) =>
      pesoDaPrioridade(a.priority) - pesoDaPrioridade(b.priority) ||
      new Date(a.checkin_at).getTime() - new Date(b.checkin_at).getTime(),
  );
}

/** Quem a proxima chamada leva, ou null com a fila vazia. */
export function proximoDaFilaDoMedico<T extends EsperandoMedico>(fila: readonly T[]): T | null {
  return ordenarFilaDoMedico(fila)[0] ?? null;
}
