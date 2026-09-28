/**
 * Regras de quem pode mexer em sala e em tipo de exame.
 *
 * "no futuro a gente quiser fazer outro tipo de exame, ou entao se no
 *  futuro a gente for trocar a ordem das salas... sera que tem como a
 *  gente colocar no sistema um jeito da gente ter mais autonomia sobre
 *  isso? tipo assim, a minha sala 3, que e a audiometria, mudar para fazer
 *  outra coisa" -- Isabella, 25/09.
 *
 * Ate aqui toda troca de sala e todo exame novo passavam por comando
 * escrito a mao no banco. Este modulo e a parte que decide o que a clinica
 * pode fazer sozinha sem quebrar atendimento em andamento.
 *
 * Logica pura de proposito: as travas sao a razao de a tela existir com
 * seguranca, e travas que so existem dentro de uma tela ninguem consegue
 * conferir.
 */

export interface Veredito {
  pode: boolean;
  /** Frase pronta para a tela, dizendo o que impede. */
  motivo: string | null;
}

const LIBERADO: Veredito = { pode: true, motivo: null };

/**
 * Codigo do exame ou da sala, como o sistema usa internamente.
 *
 * Maiusculas, sem acento, sem espaco. O codigo e a unica coisa que o
 * sistema reconhece pelo nome -- CLINICO decide quem vai ao medico, RAIOX
 * sai em guia -- entao ele nao pode virar "Raio X " com espaco no fim.
 */
export function normalizarCodigo(bruto: string): string {
  return (bruto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
}

/**
 * Codigos que o sistema trata de forma especial.
 *
 * Renomear ou apagar um destes muda o comportamento do atendimento em
 * lugares que nao tem nada a ver com a tela de cadastro: CLINICO e PSICO
 * decidem quem vai ao medico, RAIOX e LAB decidem o que sai em guia. A
 * clinica pode mudar o NOME que aparece na tela; o codigo, nao.
 */
export const CODIGOS_DO_SISTEMA = new Set(['CLINICO', 'PSICO', 'RAIOX', 'LAB']);

export interface ExameQueUsaASala {
  nome: string;
}

/**
 * Desativar uma sala.
 *
 * Duas coisas impedem, e as duas ja aconteceram nesta clinica:
 *
 *  - sala que e a sala padrao de um exame ativo. Foi o defeito do primeiro
 *    seed: as dinamometrias apontavam para uma sala desativada e nunca
 *    apareciam em fila nenhuma;
 *  - sala com paciente dentro. Desativar ali some com o cartao da tela e o
 *    paciente fica sentado esperando uma chamada que nao vem.
 */
export function podeDesativarSala(estado: {
  examesQueUsam: ExameQueUsaASala[];
  temPacienteDentro: boolean;
}): Veredito {
  if (estado.temPacienteDentro) {
    return {
      pode: false,
      motivo:
        'Esta sala está com um paciente em atendimento. Conclua ou libere o atendimento antes de desativá-la.',
    };
  }

  if (estado.examesQueUsam.length > 0) {
    const nomes = estado.examesQueUsam.map((e) => e.nome).join(', ');
    return {
      pode: false,
      motivo:
        `Esta sala é a sala de ${nomes}. Mude ${
          estado.examesQueUsam.length > 1 ? 'esses exames' : 'esse exame'
        } para outra sala antes de desativá-la — ` +
        'sem sala, o exame não aparece em fila nenhuma.',
    };
  }

  return LIBERADO;
}

/**
 * Desativar um tipo de exame.
 *
 * Exame com pedido em aberto nao pode sumir: o paciente ja esta na
 * clinica, o exame esta na lista dele, e desativar tiraria da tela sem
 * tirar da vida dele.
 */
export function podeDesativarExame(estado: { pedidosEmAberto: number }): Veredito {
  if (estado.pedidosEmAberto > 0) {
    return {
      pode: false,
      motivo:
        `Há ${estado.pedidosEmAberto} atendimento(s) em aberto com este exame pedido. ` +
        'Conclua ou cancele esses pedidos antes de desativar o exame.',
    };
  }
  return LIBERADO;
}

/**
 * Trocar a sala de um exame.
 *
 * Exame que nao ocupa sala nao tem sala para trocar: consulta clinica e
 * psicossocial sao respondidos pelo medico, e raio X e feito fora. Deixar
 * escolher sala para eles daria a entender que passariam a ser chamados
 * numa fila -- e nao passariam.
 */
export function podeTrocarSala(exame: { ocupaSala: boolean; nome: string }): Veredito {
  if (!exame.ocupaSala) {
    return {
      pode: false,
      motivo: `${exame.nome} não é feito numa sala de fila: não há sala para escolher.`,
    };
  }
  return LIBERADO;
}

/**
 * Mudar o codigo de um exame ja cadastrado.
 *
 * O nome que aparece na tela pode mudar quando a clinica quiser. O codigo,
 * nao: ele e a unica coisa pela qual o sistema reconhece o exame em
 * decisoes que acontecem longe desta tela.
 */
export function podeMudarCodigo(atual: string, novo: string): Veredito {
  if (normalizarCodigo(atual) === normalizarCodigo(novo)) return LIBERADO;

  if (CODIGOS_DO_SISTEMA.has(atual)) {
    return {
      pode: false,
      motivo:
        `O código ${atual} é usado pelo sistema para decidir o caminho do paciente. ` +
        'O nome que aparece na tela pode ser mudado; o código, não.',
    };
  }

  return LIBERADO;
}
