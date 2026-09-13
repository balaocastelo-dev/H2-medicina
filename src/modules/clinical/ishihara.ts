/**
 * Teste de cores de Ishihara, no modelo que a clinica usa.
 *
 * A clinica enviou o proprio material em 13/09: seis laminas, com as
 * respostas 12, 74, 2, 26, 45 e 3. A figura 1 e lamina de controle -- todo
 * mundo enxerga o 12, com ou sem discromatopsia. Errar a figura 1 nao indica
 * daltonismo: indica que o paciente nao entendeu a instrucao, nao esta
 * enxergando o cartao, ou nao colaborou. Por isso ela e contada a parte.
 *
 * "no caso do teste nos precisamos informar quantas imagens foram
 *  identificadas os numeros corretos" -- Isabella, 13/09.
 *
 * Guardar o que o paciente respondeu em cada lamina, e nao so o total de
 * acertos, permite reconferir depois sem repetir o exame no paciente.
 */

export interface Lamina {
  /** Numero da figura, como aparece no material impresso. */
  figura: number;
  /** Chave do campo na ficha do exame. */
  chave: string;
  /** Resposta correta. */
  esperado: string;
  /** Lamina que todos enxergam, usada para validar a aplicacao do teste. */
  controle?: boolean;
}

export const LAMINAS: Lamina[] = [
  { figura: 1, chave: 'figura_1', esperado: '12', controle: true },
  { figura: 2, chave: 'figura_2', esperado: '74' },
  { figura: 3, chave: 'figura_3', esperado: '2' },
  { figura: 4, chave: 'figura_4', esperado: '26' },
  { figura: 5, chave: 'figura_5', esperado: '45' },
  { figura: 6, chave: 'figura_6', esperado: '3' },
];

/** Laminas que valem para o resultado (todas menos a de controle). */
export const LAMINAS_VALIDAS = LAMINAS.filter((l) => !l.controle);

export interface Conferencia {
  /** Acertos entre as laminas que valem, ignorando a de controle. */
  acertos: number;
  /** Quantas laminas valendo foram aplicadas (tiveram resposta). */
  aplicadas: number;
  /** Total de laminas que valem no material. */
  total: number;
  /** Resposta da lamina de controle bateu. */
  controleOk: boolean;
  /** A lamina de controle chegou a ser respondida. */
  controleRespondido: boolean;
  detalhe: { figura: number; respondido: string; esperado: string; certo: boolean }[];
}

/**
 * Normaliza a resposta antes de comparar.
 *
 * O examinador digita o que o paciente falou, e isso chega como " 74 ",
 * "74." ou "nao identifica". Comparar texto cru marcaria erro em resposta
 * certa, o que aqui significa apontar daltonismo em quem enxerga bem.
 */
function normalizar(valor: string | undefined | null): string {
  return String(valor ?? '')
    .trim()
    .replace(/[.,;]+$/, '')
    .toLowerCase();
}

export function conferirIshihara(respostas: Record<string, string | undefined>): Conferencia {
  const detalhe = LAMINAS.map((l) => {
    const respondido = normalizar(respostas[l.chave]);
    return {
      figura: l.figura,
      respondido,
      esperado: l.esperado,
      certo: respondido === l.esperado,
    };
  });

  const controle = detalhe.find((d) => d.figura === 1)!;
  const valendo = detalhe.filter((d) => d.figura !== 1);

  return {
    acertos: valendo.filter((d) => d.certo).length,
    aplicadas: valendo.filter((d) => d.respondido !== '').length,
    total: LAMINAS_VALIDAS.length,
    controleOk: controle.certo,
    controleRespondido: controle.respondido !== '',
    detalhe,
  };
}

/**
 * Texto do resultado, para a ficha e para o documento.
 *
 * Nao conclui diagnostico: descreve o que foi observado e sinaliza quando o
 * achado precisa de avaliacao oftalmologica. Quem conclui e o medico.
 */
export function descreverIshihara(c: Conferencia): string {
  if (!c.controleRespondido && c.aplicadas === 0) return 'Teste não aplicado.';

  if (!c.controleOk) {
    return (
      `Identificou ${c.acertos} de ${c.total} lâminas. ` +
      'A lâmina de controle não foi identificada corretamente, o que invalida a ' +
      'leitura: repetir o teste conferindo iluminação, distância e compreensão da ' +
      'instrução pelo paciente.'
    );
  }

  if (c.acertos === c.total) {
    return `Identificou as ${c.total} lâminas corretamente. Visão de cores sem alterações.`;
  }

  const erradas = c.detalhe
    .filter((d) => d.figura !== 1 && !d.certo)
    .map((d) => d.figura)
    .join(', ');

  return (
    `Identificou ${c.acertos} de ${c.total} lâminas. ` +
    `Não identificou corretamente: figura ${erradas}. ` +
    'Achado compatível com alteração na visão de cores — encaminhar para avaliação ' +
    'oftalmológica.'
  );
}
