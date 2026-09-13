/**
 * Intervalo entre horarios da agenda, em minutos.
 *
 * A clinica mudou de ideia duas vezes: 10 minutos em 27/08, 5 em 11/09, e de
 * volta para 10 em 13/09. O numero estava solto em quatro arquivos, e uma das
 * trocas pegou so tres deles -- a tela de editar agendamento ficou divergente
 * da tela de criar, sem ninguem perceber.
 *
 * Por isso existe este arquivo. Quando mudar de novo, muda aqui.
 *
 * O valor real vem de Configuracoes (`agenda.intervalo_minutos`); isto e o
 * que vale enquanto ninguem configurou nada.
 */
export const INTERVALO_PADRAO_MINUTOS = 10;

/**
 * Le o intervalo configurado, caindo no padrao quando nao houver.
 *
 * Zero, negativo, texto e nulo caem todos no padrao: um passo de zero minuto
 * geraria uma grade infinita de horarios.
 */
export function intervaloConfigurado(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : INTERVALO_PADRAO_MINUTOS;
}
