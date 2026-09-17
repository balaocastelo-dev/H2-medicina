/**
 * Fichas de preenchimento de cada exame.
 *
 * "anexar fichas de cada exame respectivo nas abas para preenchimento manual
 *  durante realizacao do examinador"
 *
 * As perguntas vieram dos modelos em Word da clinica (Romberg, fadiga,
 * dinamometria, psicossocial, audiometria). Ficam descritas como dado, e nao
 * no JSX, pelo mesmo motivo da ficha clinica: a mesma definicao gera o
 * formulario da sala, o resumo do medico e o laudo em PDF.
 */

import { LAMINAS } from './ishihara';

export type TipoCampoExame = 'texto' | 'numero' | 'longo' | 'opcoes' | 'sim_nao' | 'titulo';

export interface CampoExame {
  chave: string;
  rotulo: string;
  tipo: TipoCampoExame;
  opcoes?: string[];
  unidade?: string;
  /** Respostas que o medico precisa ver destacadas. */
  alertaEm?: string[];
  /**
   * Valor que ja vem escrito quando a ficha abre em branco.
   *
   * Para dado que e sempre o mesmo -- o audiometro da clinica nao muda a
   * cada paciente. Continua editavel: e ponto de partida, nao trava.
   */
  padrao?: string;
}

/** Valores iniciais de uma ficha, a partir dos padroes dos campos. */
export function padroesDaFicha(ficha: FichaDeExame | null): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of ficha?.campos ?? []) {
    if (campo.padrao !== undefined) valores[campo.chave] = campo.padrao;
  }
  return valores;
}

export interface FichaDeExame {
  /** Codigo do exam_type correspondente. */
  codigo: string;
  titulo: string;
  campos: CampoExame[];
}

const SIM_NAO_AS_VEZES = ['sim', 'às vezes', 'não'];

const simNao = (chave: string, rotulo: string, alertaEm?: string[]): CampoExame => ({
  chave,
  rotulo,
  tipo: 'sim_nao',
  ...(alertaEm ? { alertaEm } : {}),
});

/** Sintomas do teste de fadiga, na ordem da ficha em papel. */
const SINTOMAS_FADIGA: { grupo: string; itens: [string, string][] }[] = [
  {
    grupo: 'Sintomas de mal-estar',
    itens: [
      ['peso_cabeca', 'Sensação de peso na cabeça'],
      ['cansaco_corpo', 'Cansaço no corpo todo'],
      ['cansaco_pernas', 'Cansaço nas pernas'],
      ['bocejo', 'Bocejo'],
      ['cerebro_quente', 'Sensação de cérebro quente'],
      ['sonolencia', 'Sonolência, falta de energia'],
      ['movimentos_duros', 'Movimentos duros e desajeitados'],
      ['instabilidade', 'Instabilidade ao ficar parado'],
      ['desejo_deitar', 'Desejo de se deitar'],
    ],
  },
  {
    grupo: 'Cansaço mental',
    itens: [
      ['dificuldade_pensar', 'Dificuldade em pensar'],
      ['cansaco_falar', 'Cansaço ao falar'],
      ['nervosismo', 'Nervosismo'],
      ['concentracao', 'Incapacidade de concentração'],
      ['esquecimento', 'Esquece-se com facilidade'],
      ['autoconfianca', 'Falta de autoconfiança'],
      ['ansiedade', 'Ansiedade constante'],
      ['paciencia', 'Sem paciência'],
    ],
  },
  {
    grupo: 'Sintomas específicos',
    itens: [
      ['dor_cabeca', 'Dor de cabeça'],
      ['rigidez_ombros', 'Rigidez nos ombros'],
      ['dor_barriga', 'Dor de barriga'],
      ['falta_ar', 'Falta de ar'],
      ['voz_rouca', 'Voz rouca'],
      ['tontura', 'Tontura'],
      ['tremores', 'Tremores nos membros ou pálpebras'],
      ['sensacao_doente', 'Sensação de estar doente'],
    ],
  },
];

const CAMPOS_FADIGA: CampoExame[] = [
  simNao('ansiedade_previa', 'Tem ansiedade?', ['sim']),
  simNao('radioterapia', 'Tratamento com radioterapia?', ['sim']),
  simNao('quimioterapia', 'Tratamento com quimioterapia?', ['sim']),
  { chave: 'tempo_tratamento', rotulo: 'Há quanto tempo?', tipo: 'texto' },
  simNao('medicamento', 'Faz uso de medicamento?'),
  { chave: 'quais_medicamentos', rotulo: 'Quais medicamentos?', tipo: 'texto' },
  ...SINTOMAS_FADIGA.flatMap((g): CampoExame[] => [
    { chave: `titulo_${g.grupo}`, rotulo: g.grupo, tipo: 'titulo' },
    ...g.itens.map(([chave, rotulo]) => simNao(chave, rotulo)),
  ]),
  { chave: 'atribuicao', rotulo: 'A que atribui esses sintomas?', tipo: 'longo' },
  { chave: 'alivio', rotulo: 'O que faz para aliviar?', tipo: 'longo' },
  { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
];

const FREQUENCIAS_AUDIO = ['250', '500', '1000', '2000', '3000', '4000', '6000', '8000'];
const rotuloFrequencia = (hz: string) =>
  Number(hz) >= 1000 ? `${Number(hz) / 1000} kHz` : `${hz} Hz`;

const CAMPOS_AUDIOMETRIA: CampoExame[] = [
  // A clinica pediu estes quatro no laudo: "aparelho utilizado, fabricante
  // do aparelho, calibracao do aparelho, tempo de repouso auditivo".
  //
  // Os quatro vem preenchidos: sao o equipamento da clinica, nao um dado do
  // paciente. Redigitar isso em todo exame so cria oportunidade de erro de
  // digitacao num campo que vai impresso no laudo. Continuam editaveis.
  { chave: 'repouso_auditivo', rotulo: 'Repouso auditivo', tipo: 'numero', unidade: 'h', padrao: '14' },
  { chave: 'aparelho', rotulo: 'Aparelho', tipo: 'texto', padrao: 'AUDIÔMETRO – A030' },
  { chave: 'fabricante', rotulo: 'Fabricante do aparelho', tipo: 'texto', padrao: 'ACÚSTICA ORLANDI' },
  { chave: 'calibracao', rotulo: 'Calibração', tipo: 'texto' },
  { chave: 'titulo_od', rotulo: 'Orelha direita — via aérea', tipo: 'titulo' },
  ...FREQUENCIAS_AUDIO.map(
    (hz): CampoExame => ({
      chave: `od_${hz}`,
      rotulo: rotuloFrequencia(hz),
      tipo: 'numero',
      unidade: 'dB',
    }),
  ),
  { chave: 'titulo_oe', rotulo: 'Orelha esquerda — via aérea', tipo: 'titulo' },
  ...FREQUENCIAS_AUDIO.map(
    (hz): CampoExame => ({
      chave: `oe_${hz}`,
      rotulo: rotuloFrequencia(hz),
      tipo: 'numero',
      unidade: 'dB',
    }),
  ),
  { chave: 'titulo_diagnostico', rotulo: 'Diagnóstico', tipo: 'titulo' },
  { chave: 'meatoscopia_od', rotulo: 'Meatoscopia O.D.', tipo: 'texto' },
  { chave: 'meatoscopia_oe', rotulo: 'Meatoscopia O.E.', tipo: 'texto' },
  { chave: 'nr7', rotulo: 'Classificação NR-7', tipo: 'texto' },
  { chave: 'conclusao', rotulo: 'Conclusão', tipo: 'longo' },
];

export const FICHAS_DE_EXAME: FichaDeExame[] = [
  {
    codigo: 'PSICO',
    titulo: 'Avaliação de fatores de risco psicossocial',
    campos: [
      {
        chave: 'clareza',
        rotulo: 'Tem dificuldade de pensar com clareza?',
        tipo: 'opcoes',
        opcoes: SIM_NAO_AS_VEZES,
        alertaEm: ['sim'],
      },
      {
        chave: 'triste',
        rotulo: 'Tem se sentido triste ultimamente?',
        tipo: 'opcoes',
        opcoes: SIM_NAO_AS_VEZES,
        alertaEm: ['sim'],
      },
      {
        chave: 'ideacao',
        rotulo: 'Já teve ideias de acabar com a vida?',
        tipo: 'opcoes',
        opcoes: SIM_NAO_AS_VEZES,
        alertaEm: ['sim', 'às vezes'],
      },
      {
        chave: 'vozes',
        rotulo: 'Ouve vozes de pessoas que não estão presentes?',
        tipo: 'opcoes',
        opcoes: SIM_NAO_AS_VEZES,
        alertaEm: ['sim', 'às vezes'],
      },
      { chave: 'observacao', rotulo: 'Observação do examinador', tipo: 'longo' },
    ],
  },
  {
    codigo: 'ROMBERG',
    titulo: 'Teste de Romberg',
    campos: [
      simNao('tontura', 'Tontura', ['sim']),
      { chave: 'tontura_tratamento', rotulo: 'Tontura — tratamento', tipo: 'texto' },
      simNao('zumbido', 'Zumbido', ['sim']),
      { chave: 'zumbido_tratamento', rotulo: 'Zumbido — tratamento', tipo: 'texto' },
      simNao('fobia', 'Fobia', ['sim']),
      simNao('desmaio', 'Desmaio ou convulsão', ['sim']),
      {
        chave: 'resultado',
        rotulo: 'Resultado',
        tipo: 'opcoes',
        opcoes: ['sem alteração', 'positivo'],
        alertaEm: ['positivo'],
      },
    ],
  },
  { codigo: 'FADIGA', titulo: 'Teste de fadiga', campos: CAMPOS_FADIGA },
  {
    codigo: 'DINAMO_PAL',
    titulo: 'Dinamometria palmar',
    campos: [
      { chave: 'palmar_direita', rotulo: 'Palmar direita', tipo: 'numero', unidade: 'kg' },
      { chave: 'palmar_esquerda', rotulo: 'Palmar esquerda', tipo: 'numero', unidade: 'kg' },
      { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
    ],
  },
  {
    codigo: 'DINAMO_ESC',
    titulo: 'Dinamometria escapular',
    campos: [
      { chave: 'escapular', rotulo: 'Escapular', tipo: 'numero', unidade: 'kg' },
      { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
    ],
  },
  {
    codigo: 'DINAMO_LOM',
    titulo: 'Dinamometria lombar',
    campos: [
      { chave: 'lombar', rotulo: 'Lombar', tipo: 'numero', unidade: 'kg' },
      { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
    ],
  },
  {
    codigo: 'ACUIDADE',
    titulo: 'Acuidade visual',
    campos: [
      { chave: 'od_sem_correcao', rotulo: 'O.D. sem correção', tipo: 'texto' },
      { chave: 'oe_sem_correcao', rotulo: 'O.E. sem correção', tipo: 'texto' },
      { chave: 'od_com_correcao', rotulo: 'O.D. com correção', tipo: 'texto' },
      { chave: 'oe_com_correcao', rotulo: 'O.E. com correção', tipo: 'texto' },
      simNao('lentes', 'Usa lentes corretivas?'),
      { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
    ],
  },
  {
    codigo: 'ISHIHARA',
    titulo: 'Teste de Ishihara (visão de cores)',
    // Uma linha por lamina do material da clinica. O examinador anota o que o
    // paciente respondeu; quem conta os acertos e compara com o gabarito e o
    // sistema (`conferirIshihara`). Antes havia um campo "placas acertadas"
    // digitado a mao: o numero ia para o prontuario sem nada que permitisse
    // reconferir depois, a nao ser repetir o exame no paciente.
    campos: [
      ...LAMINAS.map(
        (l): CampoExame => ({
          chave: l.chave,
          rotulo: l.controle
            ? `Figura ${l.figura} (controle) — o que o paciente leu`
            : `Figura ${l.figura} — o que o paciente leu`,
          tipo: 'texto',
        }),
      ),
      { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
    ],
  },
  { codigo: 'AUDIO', titulo: 'Audiometria tonal ocupacional', campos: CAMPOS_AUDIOMETRIA },
  {
    codigo: 'ECG',
    titulo: 'Eletrocardiograma',
    campos: [
      { chave: 'ritmo', rotulo: 'Ritmo', tipo: 'texto' },
      { chave: 'fc', rotulo: 'Frequência cardíaca', tipo: 'numero', unidade: 'bpm' },
      { chave: 'conclusao', rotulo: 'Conclusão', tipo: 'longo' },
    ],
  },
  {
    codigo: 'ESPIRO',
    titulo: 'Espirometria',
    campos: [
      { chave: 'cvf', rotulo: 'CVF', tipo: 'texto' },
      { chave: 'vef1', rotulo: 'VEF1', tipo: 'texto' },
      { chave: 'vef1_cvf', rotulo: 'VEF1/CVF', tipo: 'texto' },
      { chave: 'conclusao', rotulo: 'Conclusão', tipo: 'longo' },
    ],
  },
  {
    codigo: 'EEG',
    titulo: 'Eletroencefalograma',
    campos: [
      { chave: 'ritmo_base', rotulo: 'Ritmo de base', tipo: 'texto' },
      { chave: 'alteracoes', rotulo: 'Alterações observadas', tipo: 'longo' },
      { chave: 'conclusao', rotulo: 'Conclusão', tipo: 'longo' },
    ],
  },
  {
    codigo: 'LAB',
    titulo: 'Exames laboratoriais',
    campos: [
      { chave: 'analises', rotulo: 'Análises solicitadas', tipo: 'longo' },
      { chave: 'material', rotulo: 'Material coletado', tipo: 'texto' },
      { chave: 'observacao', rotulo: 'Observação', tipo: 'longo' },
    ],
  },
];

/**
 * Exames que nao tem ficha preenchida na sala.
 *
 * Pedido da clinica em 15/09:
 *  - "no exame de eletroencefalograma, eletrocardiograma e espirometria,
 *     nao devem ter ficha de exame" -- o resultado sai do proprio aparelho,
 *     em laudo separado; uma ficha em branco na tela so atrapalha.
 *  - "em exames laboratoriais coleta de exames nao deve aparecer ficha de
 *     exames, ela deve ser preenchida na recepcao" -- o que se pede ao
 *     laboratorio e decidido no balcao e sai na guia, nao na sala.
 */
export const SEM_FICHA_NA_SALA = new Set(['EEG', 'ECG', 'ESPIRO', 'LAB', 'RAIOX']);

export function fichaDoExame(codigo: string | null | undefined): FichaDeExame | null {
  if (!codigo) return null;
  if (SEM_FICHA_NA_SALA.has(codigo)) return null;
  return FICHAS_DE_EXAME.find((f) => f.codigo === codigo) ?? null;
}

/** Respostas que exigem atencao do medico, para destacar na consulta. */
export function alertasDaFicha(
  ficha: FichaDeExame,
  respostas: Record<string, unknown> | null | undefined,
): string[] {
  const dados = respostas ?? {};
  return ficha.campos
    .filter((campo) => {
      const valor = dados[campo.chave];
      return typeof valor === 'string' && (campo.alertaEm ?? []).includes(valor);
    })
    .map((campo) => `${campo.rotulo}: ${String(dados[campo.chave])}`);
}

/** Apenas o que foi preenchido, para o resumo e o laudo. */
export function preenchidos(
  ficha: FichaDeExame,
  respostas: Record<string, unknown> | null | undefined,
): { rotulo: string; valor: string }[] {
  const dados = respostas ?? {};
  return ficha.campos
    .filter((c) => c.tipo !== 'titulo')
    .map((c) => ({
      rotulo: c.rotulo,
      valor: `${String(dados[c.chave] ?? '').trim()}${
        dados[c.chave] && c.unidade ? ` ${c.unidade}` : ''
      }`,
    }))
    .filter((r) => r.valor !== '');
}
