/**
 * Le valor em dinheiro digitado por gente, do jeito que gente digita.
 *
 * ---------------------------------------------------------------------
 * Por que `<input type="number">` nao servia
 * ---------------------------------------------------------------------
 * O comportamento de `type="number"` com virgula depende do IDIOMA
 * CONFIGURADO NO NAVEGADOR de cada maquina:
 *
 *   Chrome em pt-BR  -> "36,5" e aceito, `.value` devolve "36.5". Funciona.
 *   Chrome em en-US  -> a virgula deixa o campo em `badInput` e `.value`
 *                       vira STRING VAZIA.
 *
 * PC montado, reinstalado ou com Windows em ingles cai no segundo caso — e
 * ninguem na clinica tem como saber disso. O estrago dependia do destino do
 * valor vazio:
 *
 *   - na triagem, temperatura e peso eram descartados em silencio, com a
 *     mensagem "Triagem salva.";
 *   - nos valores por empresa, vazio significa "usar o preco de tabela", e o
 *     valor NEGOCIADO da empresa era APAGADO, com "Valores salvos.".
 *
 * E havia o caso silencioso que acontece em qualquer idioma: "1.234"
 * querendo dizer mil duzentos e trinta e quatro era lido como 1,234 e
 * gravado como R$ 1,23.
 *
 * ---------------------------------------------------------------------
 * A regra
 * ---------------------------------------------------------------------
 * Aceita as duas notacoes e decide pelo ULTIMO separador, que e sempre o
 * decimal em qualquer uma das duas:
 *
 *   "1234"        -> 1234
 *   "1234,56"     -> 1234.56     (brasileiro)
 *   "1234.56"     -> 1234.56     (o que o `type=number` manda)
 *   "1.234,56"    -> 1234.56     (brasileiro com milhar)
 *   "1,234.56"    -> 1234.56     (americano com milhar)
 *   "1.234"       -> 1234        (milhar; ver abaixo)
 *   "R$ 1.234,56" -> 1234.56
 *   ""            -> null        (vazio de verdade e vazio)
 *   "abc"         -> NaN         (quem chamou decide o que fazer)
 *
 * "1.234" e o unico caso ambiguo: pode ser mil duzentos e trinta e quatro
 * (milhar) ou um inteiro com tres decimais. Vale milhar, porque preco com
 * tres casas nao existe na clinica e porque era esse o erro que gravava
 * R$ 1,23 no lugar de R$ 1.234,00.
 */
export function dinheiroDigitado(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;

  const texto = String(valor).trim();
  if (texto === '') return null;

  // Fora numeros, vírgula, ponto e o sinal: "R$", espaco fino, tudo sai.
  const limpo = texto.replace(/[^\d.,-]/g, '');
  if (limpo === '' || limpo === '-') return NaN;

  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');

  let normalizado: string;

  if (ultimaVirgula === -1 && ultimoPonto === -1) {
    normalizado = limpo;
  } else if (ultimaVirgula > ultimoPonto) {
    // Virgula e o decimal: todo ponto e milhar.
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else if (ultimoPonto > ultimaVirgula) {
    const depoisDoPonto = limpo.length - ultimoPonto - 1;
    const temVirgula = ultimaVirgula !== -1;
    // Tres digitos depois de um ponto unico, sem virgula nenhuma, e milhar:
    // "1.234" e mil duzentos e trinta e quatro.
    if (!temVirgula && depoisDoPonto === 3 && limpo.split('.').length === 2) {
      normalizado = limpo.replace('.', '');
    } else {
      normalizado = limpo.replace(/,/g, '');
    }
  } else {
    normalizado = limpo;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Mesma leitura, para campo em que vazio NAO pode virar nulo.
 *
 * Triagem e sinais vitais: vazio ali significa "nao medi", e nulo e a
 * resposta certa. Preco significa "usar a tabela". Quem chama escolhe.
 */
export function dinheiroOuZero(valor: unknown): number {
  const n = dinheiroDigitado(valor);
  return n === null || Number.isNaN(n) ? 0 : n;
}
