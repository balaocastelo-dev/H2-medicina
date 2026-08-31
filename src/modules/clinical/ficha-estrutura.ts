/**
 * Estrutura da ficha clinica.
 *
 * A doutora pediu que a consulta seja preenchida por caixa de selecao, com
 * texto livre so na observacao. Definir os blocos aqui, e nao no JSX, permite
 * gerar formulario, PDF e resumo a partir da mesma fonte — e mudar uma pergunta
 * sem tocar em tela nem em banco.
 */

export type TipoCampo =
  | 'sim_nao'
  | 'normal_alterado'
  | 'opcoes'
  /** Sim / às vezes / não, como na ficha de risco psicossocial. */
  | 'psicossocial'
  | 'texto';

export interface CampoFicha {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  opcoes?: string[];
}

export interface BlocoFicha {
  chave:
    | 'antecedentes_profissionais'
    | 'antecedentes_pessoais'
    | 'estilo_vida'
    | 'exame_fisico'
    | 'psicossocial';
  titulo: string;
  descricao?: string;
  campos: CampoFicha[];
}

/** Sistemas do exame fisico, na ordem da ficha em papel da clinica. */
export const SISTEMAS_EXAME_FISICO: CampoFicha[] = [
  { chave: 'abdome', rotulo: 'Abdome', tipo: 'normal_alterado' },
  { chave: 'cardiovascular', rotulo: 'Aparelho cardiovascular', tipo: 'normal_alterado' },
  { chave: 'genitourinario', rotulo: 'Aparelho genitourinário', tipo: 'normal_alterado' },
  { chave: 'respiratorio', rotulo: 'Aparelho respiratório', tipo: 'normal_alterado' },
  { chave: 'membros_superiores', rotulo: 'Braços, antebraços, mãos e punhos', tipo: 'normal_alterado' },
  { chave: 'cabeca_pescoco', rotulo: 'Cabeça e pescoço', tipo: 'normal_alterado' },
  { chave: 'coluna', rotulo: 'Coluna', tipo: 'normal_alterado' },
  { chave: 'membros_inferiores', rotulo: 'Membros inferiores', tipo: 'normal_alterado' },
  { chave: 'pele_mucosas', rotulo: 'Pele e mucosas', tipo: 'normal_alterado' },
];

export const BLOCOS_FICHA: BlocoFicha[] = [
  {
    chave: 'antecedentes_profissionais',
    titulo: 'Antecedentes profissionais',
    campos: [
      { chave: 'doenca_ocupacional', rotulo: 'Doença ocupacional', tipo: 'sim_nao' },
      { chave: 'acidente_trabalho', rotulo: 'Acidente de trabalho', tipo: 'sim_nao' },
      { chave: 'auxilio_previdenciario', rotulo: 'Auxílio previdenciário', tipo: 'sim_nao' },
      { chave: 'exposicao_ruido', rotulo: 'Exposição a ruído', tipo: 'sim_nao' },
      { chave: 'exposicao_quimicos', rotulo: 'Exposição a agentes químicos', tipo: 'sim_nao' },
      { chave: 'uso_epi', rotulo: 'Usa EPI regularmente', tipo: 'sim_nao' },
    ],
  },
  {
    chave: 'antecedentes_pessoais',
    titulo: 'Antecedentes pessoais',
    campos: [
      { chave: 'doencas_traumatismos', rotulo: 'Doenças ou traumatismos', tipo: 'sim_nao' },
      { chave: 'cirurgias', rotulo: 'Cirurgias', tipo: 'sim_nao' },
      { chave: 'internacoes', rotulo: 'Internações', tipo: 'sim_nao' },
      { chave: 'alergias', rotulo: 'Alergias', tipo: 'sim_nao' },
      { chave: 'medicacao_continua', rotulo: 'Medicação de uso contínuo', tipo: 'sim_nao' },
    ],
  },
  {
    chave: 'estilo_vida',
    titulo: 'Estilo de vida',
    campos: [
      {
        chave: 'alcool',
        rotulo: 'Faz uso de álcool',
        tipo: 'opcoes',
        opcoes: ['Não', 'Fins de semana', '3x por semana', 'Diariamente'],
      },
      {
        chave: 'tabagismo',
        rotulo: 'Tabagismo',
        tipo: 'opcoes',
        opcoes: ['Não', 'Sim', 'Ex-fumante'],
      },
      {
        chave: 'atividade_fisica',
        rotulo: 'Atividade física',
        tipo: 'opcoes',
        opcoes: ['Não', 'Fins de semana', '3x por semana', 'Diariamente'],
      },
      {
        chave: 'emocional',
        rotulo: 'Emocional',
        tipo: 'opcoes',
        opcoes: ['Calmo', 'Ansioso', 'Deprimido', 'Estressado'],
      },
      { chave: 'vacinas_em_dia', rotulo: 'Vacinas em dia', tipo: 'sim_nao' },
      { chave: 'lentes_corretivas', rotulo: 'Lentes corretivas', tipo: 'sim_nao' },
    ],
  },
  {
    chave: 'exame_fisico',
    titulo: 'Exame físico',
    descricao: 'Marque cada sistema. Descreva no campo abaixo apenas o que estiver alterado.',
    campos: SISTEMAS_EXAME_FISICO,
  },
];

/**
 * Avaliacao de fatores de risco psicossocial.
 *
 * "incluir perguntas de exame psicossocial, caso essa opcao tenha sido
 *  flegada na aba recepcao" — por isso este bloco fica fora de BLOCOS_FICHA
 *  e so entra na tela quando o exame esta na lista do paciente.
 *
 * As perguntas sao as da ficha em papel da clinica.
 */
export const BLOCO_PSICOSSOCIAL: BlocoFicha = {
  chave: 'psicossocial',
  titulo: 'Avaliação de fatores de risco psicossocial',
  descricao: 'Incluída porque a recepção marcou este exame para o paciente.',
  campos: [
    { chave: 'clareza', rotulo: 'Tem dificuldade de pensar com clareza?', tipo: 'psicossocial' },
    { chave: 'triste', rotulo: 'Tem se sentido triste ultimamente?', tipo: 'psicossocial' },
    { chave: 'chorado', rotulo: 'Tem chorado sem motivo?', tipo: 'psicossocial' },
    {
      chave: 'sofrimento_trabalho',
      rotulo: 'O trabalho lhe causa sofrimento?',
      tipo: 'psicossocial',
    },
    { chave: 'interesse', rotulo: 'Tem perdido interesse pelas coisas?', tipo: 'psicossocial' },
    { chave: 'ideacao', rotulo: 'Já teve ideias de acabar com a vida?', tipo: 'psicossocial' },
    { chave: 'cansaco', rotulo: 'Sente-se cansado o tempo todo?', tipo: 'psicossocial' },
    { chave: 'antecedente_psi', rotulo: 'Possui antecedente psiquiátrico?', tipo: 'psicossocial' },
    {
      chave: 'familiar_psi',
      rotulo: 'Possui familiares com antecedentes psiquiátricos?',
      tipo: 'psicossocial',
    },
    { chave: 'drogas', rotulo: 'Faz uso de alguma droga?', tipo: 'psicossocial' },
    {
      chave: 'psicotropicos',
      rotulo: 'Faz uso de antidepressivo, antipsicótico ou calmante?',
      tipo: 'psicossocial',
    },
    { chave: 'alcool', rotulo: 'Faz uso de bebida alcoólica diariamente?', tipo: 'psicossocial' },
    {
      chave: 'vozes',
      rotulo: 'Costuma ouvir vozes de pessoas que não estão presentes?',
      tipo: 'psicossocial',
    },
    { chave: 'vultos', rotulo: 'Enxerga vultos ou tem visões?', tipo: 'psicossocial' },
    { chave: 'medo_altura', rotulo: 'Tem medo de altura?', tipo: 'psicossocial' },
    { chave: 'medo_espaco_fechado', rotulo: 'Tem medo de espaço fechado?', tipo: 'psicossocial' },
    { chave: 'medo_escuro', rotulo: 'Tem medo do escuro?', tipo: 'psicossocial' },
    {
      chave: 'orientacao',
      rotulo: 'Localiza-se no tempo e no espaço?',
      tipo: 'sim_nao',
    },
    {
      chave: 'aparencia',
      rotulo: 'Apresentação e postura adequadas na consulta?',
      tipo: 'sim_nao',
    },
    {
      chave: 'encaminhamento',
      rotulo: 'Necessita encaminhamento psicológico ou psiquiátrico?',
      tipo: 'sim_nao',
    },
  ],
};

/**
 * Respostas que pedem atencao do medico ao fechar a aptidao.
 * A ideacao suicida entra mesmo quando a resposta e "às vezes".
 */
const ALERTA_PSICOSSOCIAL: Record<string, string[]> = {
  clareza: ['sim'],
  triste: ['sim'],
  chorado: ['sim'],
  sofrimento_trabalho: ['sim'],
  interesse: ['sim'],
  ideacao: ['sim', 'às vezes'],
  cansaco: ['sim'],
  antecedente_psi: ['sim'],
  drogas: ['sim'],
  psicotropicos: ['sim'],
  alcool: ['sim'],
  vozes: ['sim', 'às vezes'],
  vultos: ['sim', 'às vezes'],
  encaminhamento: ['sim'],
  orientacao: ['não'],
  aparencia: ['não'],
};

/** Perguntas do psicossocial que merecem destaque na tela e no PDF. */
export function alertasPsicossociais(
  respostas: RespostasBloco | null | undefined,
): { rotulo: string; valor: string }[] {
  const dados = respostas ?? {};
  return BLOCO_PSICOSSOCIAL.campos
    .filter((campo) => (ALERTA_PSICOSSOCIAL[campo.chave] ?? []).includes(dados[campo.chave] ?? ''))
    .map((campo) => ({ rotulo: campo.rotulo, valor: dados[campo.chave] ?? '' }));
}

export type RespostasBloco = Record<string, string>;

/** Valor padrao de um bloco: nada marcado. */
export function respostasVazias(bloco: BlocoFicha): RespostasBloco {
  return Object.fromEntries(bloco.campos.map((c) => [c.chave, '']));
}

/** Lista apenas o que foi respondido, para o PDF e o resumo. */
export function respondidos(
  bloco: BlocoFicha,
  respostas: RespostasBloco | null | undefined,
): { rotulo: string; valor: string }[] {
  const dados = respostas ?? {};
  return bloco.campos
    .map((c) => ({ rotulo: c.rotulo, valor: (dados[c.chave] ?? '').trim() }))
    .filter((r) => r.valor !== '');
}

/** Sistemas marcados como alterados — o que o medico precisa detalhar. */
export function sistemasAlterados(exame: RespostasBloco | null | undefined): string[] {
  const dados = exame ?? {};
  return SISTEMAS_EXAME_FISICO.filter((s) => dados[s.chave] === 'alterado').map((s) => s.rotulo);
}

/**
 * Reune os campos "bloco.campo" do formulario de volta em jsonb por bloco.
 *
 * Vive aqui, e nao no componente, porque quem chama e a Server Action — e um
 * arquivo 'use client' nao pode ser importado pelo servidor.
 */
export function lerBlocos(formData: FormData): Record<string, RespostasBloco> {
  const saida: Record<string, RespostasBloco> = {};
  // O psicossocial entra junto: quando o bloco nao esta na tela, nenhum
  // campo chega no FormData e ele fica vazio, sem apagar nada.
  for (const bloco of [...BLOCOS_FICHA, BLOCO_PSICOSSOCIAL]) {
    // Bloco que nao apareceu na tela nao manda campo nenhum. Sem esta
    // verificacao, salvar a consulta apagaria o psicossocial ja respondido.
    const apareceuNaTela = bloco.campos.some((c) => formData.has(`${bloco.chave}.${c.chave}`));
    if (!apareceuNaTela) continue;

    const respostas: RespostasBloco = {};
    for (const campo of bloco.campos) {
      const valor = formData.get(`${bloco.chave}.${campo.chave}`);
      if (typeof valor === 'string' && valor.trim() !== '') {
        respostas[campo.chave] = valor.trim();
      }
    }
    saida[bloco.chave] = respostas;
  }
  return saida;
}
