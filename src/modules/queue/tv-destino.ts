/**
 * A qual painel de TV cada chamada pertence.
 *
 * A clinica tem duas telas em lugares diferentes: a da sala de espera, que
 * so precisa mostrar quem e chamado para a recepcao e para a triagem, e a
 * do corredor interno, com as salas de exame e os consultorios. Mostrar
 * tudo nas duas confunde quem espera na entrada.
 */

export type PainelTv = 'recepcao' | 'salas';

/** Valores gravados em tv_calls.destination. */
export type Destino = 'recepcao' | 'triagem' | 'sala';

/** O tipo da sala decide o destino da chamada. */
export function destinoDaSala(kind: string | null | undefined): Destino {
  if (kind === 'recepcao' || kind === 'guiche') return 'recepcao';
  if (kind === 'triagem') return 'triagem';
  return 'sala';
}

/** Quais destinos cada TV exibe. */
export const DESTINOS_DO_PAINEL: Record<PainelTv, Destino[]> = {
  recepcao: ['recepcao', 'triagem'],
  salas: ['sala'],
};

/**
 * A chamada aparece nesta TV?
 *
 * Chamada antiga pode ter vindo sem destino gravado. Nesse caso ela conta
 * como chamada de sala, que era o unico comportamento antes da separacao —
 * assim o historico nao some da tela do corredor.
 */
export function apareceNoPainel(destino: string | null | undefined, painel: PainelTv): boolean {
  const efetivo = (destino ?? 'sala') as Destino;
  return DESTINOS_DO_PAINEL[painel].includes(efetivo);
}

export const TITULO_PAINEL: Record<PainelTv, string> = {
  recepcao: 'Recepção e triagem',
  salas: 'Salas de exame e consultórios',
};

export function ehPainelValido(valor: string | undefined): valor is PainelTv {
  return valor === 'recepcao' || valor === 'salas';
}
