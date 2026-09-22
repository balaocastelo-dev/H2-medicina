/**
 * Leitura de vinculo embutido do PostgREST, sem depender da forma.
 *
 * O PostgREST devolve ARRAY quando o vinculo e um-para-muitos e OBJETO
 * quando existe unicidade na coluna de ligacao. `triages` e
 * `medical_consultations` tem `unique (attendance_id)`: para o PostgREST
 * sao um-para-um, e o embed vem como objeto.
 *
 * Ler `.triages?.[0]` de um objeto devolve `undefined`. Sem erro, sem
 * aviso, sem nada no log. Foi assim que a tela do medico passou a dizer
 * "Sem triagem registrada" para um paciente recem-triado, e que o A.S.O.
 * passou a recusar a emissao alegando falta da conclusao de aptidao que
 * estava preenchida na tela ao lado.
 *
 * Aceitar as duas formas nao e remendo: e nao depender de um detalhe de
 * versao do servidor de API para uma coisa que decide se o documento sai.
 */
export function umDo<T>(valor: T | T[] | null | undefined): T | undefined {
  if (valor === null || valor === undefined) return undefined;
  return Array.isArray(valor) ? valor[0] : valor;
}

/** A mesma ideia, quando a tela precisa iterar. */
export function todosDe<T>(valor: T | T[] | null | undefined): T[] {
  if (valor === null || valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/** Forma aceita para um vinculo que o PostgREST pode entregar dos dois jeitos. */
export type Embutido<T> = T | T[] | null;
