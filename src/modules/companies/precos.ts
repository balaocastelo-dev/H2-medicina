/**
 * Preco do exame para cada paciente.
 *
 * "nem todo paciente vai pagar o mesmo valor dos exames, o valor deve
 * estar de acordo com o cadastrado na parte de contrato de cada empresa."
 *
 * A ordem de precedencia e sempre a mesma: preco do contrato, preco da
 * empresa, preco de tabela. Quem paga particular cai direto no de tabela.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

export interface PrecoNegociado {
  exam_type_id: string;
  contract_id: string | null;
  price: number | string;
}

export interface ExameCobravel {
  id: string;
  nome: string;
  /** Preco de tabela, usado quando nao ha valor negociado. */
  precoPadrao: number | string;
}

export interface ItemDaCobranca {
  examTypeId: string;
  nome: string;
  valor: number;
  /** De onde veio o preco, para a recepcao entender a conta. */
  origem: 'contrato' | 'empresa' | 'tabela';
}

function numero(valor: number | string | null | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Preco de um exame para uma empresa (ou particular, quando nao ha).
 *
 * Preco de contrato ganha do preco geral da empresa, que ganha do preco de
 * tabela. Sem nenhum negociado, a clinica cobra o de tabela — que e o
 * comportamento de hoje, so que agora explicito.
 */
export function precoDoExame(
  exame: ExameCobravel,
  negociados: PrecoNegociado[],
  contratoId?: string | null,
): ItemDaCobranca {
  const doExame = negociados.filter((p) => p.exam_type_id === exame.id);

  if (contratoId) {
    const doContrato = doExame.find((p) => p.contract_id === contratoId);
    if (doContrato) {
      return {
        examTypeId: exame.id,
        nome: exame.nome,
        valor: numero(doContrato.price),
        origem: 'contrato',
      };
    }
  }

  const daEmpresa = doExame.find((p) => !p.contract_id);
  if (daEmpresa) {
    return {
      examTypeId: exame.id,
      nome: exame.nome,
      valor: numero(daEmpresa.price),
      origem: 'empresa',
    };
  }

  return {
    examTypeId: exame.id,
    nome: exame.nome,
    valor: numero(exame.precoPadrao),
    origem: 'tabela',
  };
}

export interface ResumoDaCobranca {
  itens: ItemDaCobranca[];
  total: number;
  /** Algum item caiu no preco de tabela por falta de negociacao. */
  usouTabela: boolean;
}

/** Monta a cobranca dos exames escolhidos na recepcao. */
export function montarCobranca(
  exames: ExameCobravel[],
  negociados: PrecoNegociado[],
  contratoId?: string | null,
): ResumoDaCobranca {
  const itens = exames.map((e) => precoDoExame(e, negociados, contratoId));
  return {
    itens,
    total: itens.reduce((soma, i) => soma + i.valor, 0),
    usouTabela: itens.some((i) => i.origem === 'tabela'),
  };
}

export const ROTULO_ORIGEM: Record<ItemDaCobranca['origem'], string> = {
  contrato: 'valor do contrato',
  empresa: 'valor da empresa',
  tabela: 'valor de tabela',
};
