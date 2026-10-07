/**
 * Sigla do conselho profissional — CRM, CRO, COREN, CREFITO...
 *
 * ---------------------------------------------------------------------
 * O defeito que este arquivo tranca
 * ---------------------------------------------------------------------
 * No A.S.O. a sigla do conselho nao e um texto qualquer: ela e o ROTULO
 * da linha do registro. O gerador imprime
 *
 *     [conselho]: [numero] / [UF]
 *
 * entao o que estiver gravado em `conselho` vira o nome do campo no papel.
 * Alguem digitou "27786" no campo Conselho do cadastro da empresa e o
 * A.S.O. de 06/10 saiu assim:
 *
 *     27786: 79775 / SP
 *
 * O numero 79775 estava certo — e o CRM da responsavel tecnica. Errado
 * estava so o rotulo, e a clinica entregou o documento ao cliente sem a
 * palavra CRM, que e justamente o que da validade ao registro.
 *
 *     06/10 09:23 - Isa: no aso aqui ta saindo errado, deveria ser crm:
 *     06/10 10:03 - Thiago: O CRM esta certo? So nao ta saindo a palavra CRM?
 *     06/10 10:03 - Isa: isso
 *
 * Um campo de texto livre que vira rotulo de documento legal nao pode
 * confiar no que foi digitado. Esta funcao e a unica porta: se o valor nao
 * se parece com uma sigla de conselho, o documento sai com CRM, que e o
 * conselho de quem assina A.S.O. (medico do trabalho). Nunca sai um
 * numero, nunca sai em branco.
 */

/** Sigla usada quando nada aproveitavel foi cadastrado. */
export const CONSELHO_PADRAO = 'CRM';

/**
 * Normaliza o que foi digitado num campo de conselho.
 *
 * Aceita: so letras (e ponto/espaco, que sao removidos), de 2 a 10 letras.
 * Devolve sempre em maiusculas.
 *
 * Recusa — e cai no padrao: vazio, numero, "27786", "CRM 79775",
 * "123", uma letra so, frase inteira.
 */
export function siglaDoConselho(valor: string | null | undefined): string {
  const cru = (valor ?? '').trim();
  if (!cru) return CONSELHO_PADRAO;

  // Qualquer digito desqualifica: numero de registro nao e sigla, e
  // "CRM 79775" no campo errado duplicaria o numero na linha impressa.
  if (/\d/.test(cru)) return CONSELHO_PADRAO;

  // Ponto e espaco entram por digitacao ("C.R.M.", "crm "), nao mudam a sigla.
  const letras = cru.replace(/[.\s]/g, '');
  if (!/^[A-Za-zÀ-ÿ]{2,10}$/.test(letras)) return CONSELHO_PADRAO;

  return letras.toUpperCase();
}
