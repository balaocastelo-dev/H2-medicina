/**
 * Quem tem direito a ficha clinica.
 *
 * "Documentos: emitir ficha clinica exceto para pericia, acl, sisper e
 *  empresa agape"
 *
 * Os tres motivos vem de lugares diferentes, e por isso a regra mora aqui e
 * nao espalhada pelas telas:
 *
 *   - o procedimento (pericia, junta medica, ACL) e escolhido na recepcao;
 *   - a procedencia SISPER vem do convenio que custeia o atendimento;
 *   - a Agape e uma empresa que contratou so o A.S.O.
 *
 * Nenhum deles esta escrito como nome no codigo: procedimento e empresa tem
 * a propria marca no cadastro, e a procedencia e um dado do atendimento.
 * Quando a clinica cadastrar o ACL, basta desmarcar a caixa.
 */

/** Procedencias que nao geram ficha clinica. */
const PROCEDENCIAS_SEM_FICHA = ['sisper'];

export interface AtendimentoParaFicha {
  /** Procedencia do atendimento: particular, estado, sisper, ingresso. */
  origin_kind?: string | null;
  /** Marca do procedimento escolhido na recepcao. */
  procedimentoEmiteFicha?: boolean | null;
  /** Marca do cadastro da empresa do colaborador. */
  empresaEmiteFicha?: boolean | null;
}

export interface MotivoSemFicha {
  emite: boolean;
  /** Explicacao curta para a tela, vazia quando emite. */
  motivo: string | null;
}

export function avaliarFichaClinica(atendimento: AtendimentoParaFicha): MotivoSemFicha {
  if (atendimento.procedimentoEmiteFicha === false) {
    return { emite: false, motivo: 'O procedimento escolhido na recepção não gera ficha clínica.' };
  }

  if (PROCEDENCIAS_SEM_FICHA.includes(atendimento.origin_kind ?? '')) {
    return { emite: false, motivo: 'Atendimento SISPER não gera ficha clínica.' };
  }

  if (atendimento.empresaEmiteFicha === false) {
    return {
      emite: false,
      motivo: 'A empresa do colaborador está cadastrada para receber apenas o A.S.O.',
    };
  }

  return { emite: true, motivo: null };
}

/** Atalho para quem so precisa do sim ou nao. */
export function emiteFichaClinica(atendimento: AtendimentoParaFicha): boolean {
  return avaliarFichaClinica(atendimento).emite;
}
