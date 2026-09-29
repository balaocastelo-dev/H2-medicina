import { fichaDoExame } from '@/modules/clinical/fichas-de-exame';

/**
 * Qual gerador de laudo atende cada exame.
 *
 * Existem dois. O DESENHADO e escrito a mao para um exame especifico -- hoje
 * so a audiometria, que e a unica com grafico de limiares. O de FICHA e
 * generico: monta o papel a partir dos campos que a sala preencheu, e serve
 * todo o resto (dinamometrias, Romberg, fadiga, psicossocial).
 *
 * A ordem importa, e ja custou caro. Ate 22/09 so existia o desenhado. Em
 * 23/09 o generico entrou para atender os exames que nunca viravam papel
 * ("Nao ta gerando a ficha da Dinamometria palmar..." -- Isabella), e a
 * escolha ficou escrita como "tem ficha? usa o generico". A audiometria TEM
 * ficha: passou a sair pelo generico, sem os dois audiogramas e com
 * "Diagnostico:" vazio -- no desenhado esse campo e a conclusao, no generico
 * e um titulo de secao.
 * "nao esta emitindo o laudo da audiometria correto" -- Isabella, 28/09.
 *
 * Por isso a decisao mora aqui, em um lugar so, e tem teste: um exame com
 * laudo proprio nunca pode cair no generico por ter ganhado uma ficha.
 */
export const COM_LAUDO_DESENHADO = new Set(['AUDIO']);

export type EscolhaDeLaudo = 'desenhado' | 'ficha' | 'nenhum';

export function qualLaudo(codigo: string): EscolhaDeLaudo {
  if (COM_LAUDO_DESENHADO.has(codigo)) return 'desenhado';
  return fichaDoExame(codigo) ? 'ficha' : 'nenhum';
}
