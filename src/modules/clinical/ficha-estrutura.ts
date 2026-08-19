/**
 * Estrutura da ficha clinica.
 *
 * A doutora pediu que a consulta seja preenchida por caixa de selecao, com
 * texto livre so na observacao. Definir os blocos aqui, e nao no JSX, permite
 * gerar formulario, PDF e resumo a partir da mesma fonte — e mudar uma pergunta
 * sem tocar em tela nem em banco.
 */

export type TipoCampo = 'sim_nao' | 'normal_alterado' | 'opcoes' | 'texto';

export interface CampoFicha {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  opcoes?: string[];
}

export interface BlocoFicha {
  chave: 'antecedentes_profissionais' | 'antecedentes_pessoais' | 'estilo_vida' | 'exame_fisico';
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
  for (const bloco of BLOCOS_FICHA) {
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
