/**
 * Busca de endereco por CEP.
 *
 * Digitar rua, bairro e cidade a mao na recepcao com paciente esperando e
 * onde nascem os cadastros errados. O CEP resolve quase tudo sozinho.
 *
 * A consulta e feita no navegador, direto no ViaCEP. Se o servico estiver
 * fora do ar, o cadastro continua: os campos ficam livres para digitacao,
 * como sempre foram. Busca de CEP nunca pode impedir alguem de ser
 * atendido.
 */

export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Deixa so os digitos e corta no tamanho do CEP. */
export function limparCep(valor: string): string {
  return (valor ?? '').replace(/\D/g, '').slice(0, 8);
}

export function cepCompleto(valor: string): boolean {
  return limparCep(valor).length === 8;
}

/** 01310100 -> 01310-100 */
export function formatarCep(valor: string): string {
  const so = limparCep(valor);
  return so.length > 5 ? `${so.slice(0, 5)}-${so.slice(5)}` : so;
}

/** Resposta crua do ViaCEP, na forma que interessa. */
interface RespostaViaCep {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

/**
 * Traduz a resposta do servico.
 *
 * CEP inexistente volta com `erro: true` e status 200 — por isso a
 * checagem e do corpo, nao do codigo HTTP.
 */
export function lerRespostaCep(dados: unknown): EnderecoCep | null {
  if (!dados || typeof dados !== 'object') return null;
  const r = dados as RespostaViaCep;
  if (r.erro === true || r.erro === 'true') return null;
  if (!r.localidade && !r.logradouro) return null;

  return {
    logradouro: r.logradouro ?? '',
    bairro: r.bairro ?? '',
    cidade: r.localidade ?? '',
    uf: (r.uf ?? '').toUpperCase().slice(0, 2),
  };
}

/**
 * Consulta o CEP. Nunca lanca: devolve null quando nao da para responder.
 *
 * O sinal de abortar existe porque a pessoa continua digitando: uma busca
 * antiga que chegue atrasada nao pode sobrescrever o que ja foi preenchido.
 */
export async function buscarCep(
  cep: string,
  sinal?: AbortSignal,
): Promise<EnderecoCep | null> {
  const so = limparCep(cep);
  if (so.length !== 8) return null;

  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${so}/json/`, { signal: sinal });
    if (!resposta.ok) return null;
    return lerRespostaCep(await resposta.json());
  } catch {
    return null;
  }
}
