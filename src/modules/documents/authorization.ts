/**
 * Termo de autorizacao para entrega do prontuario a empresa contratante.
 *
 * O texto reproduz os artigos do Codigo de Etica Medica que sustentam a
 * entrega — sem a autorizacao escrita do paciente, o Art. 89 veda liberar
 * copia do prontuario. E por isso que o termo existe: nao e formalidade,
 * e a condicao legal da entrega.
 *
 * Logica pura, sem banco: da para testar o texto montado.
 */

export interface DadosDoTermo {
  pacienteNome: string;
  pacienteRg: string | null;
  pacienteCpf: string | null;
  empresaNome: string | null;
  coordenadorNome: string | null;
  coordenadorConselho: string | null;
  clinicaRazaoSocial: string;
  cidade: string | null;
  data: Date;
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function dataPorExtenso(data: Date, cidade: string | null): string {
  const local = cidade ? `${cidade}, ` : '';
  return `${local}${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`;
}

/** Artigos citados no termo, na redacao do Codigo de Etica Medica. */
export const ARTIGOS_CEM = [
  'É vedado ao médico:',
  'Art. 85. Permitir o manuseio e o conhecimento dos prontuários por pessoas não obrigadas ao sigilo profissional quando sob sua responsabilidade.',
  'Art. 89. Liberar cópias do prontuário sob sua guarda, salvo quando autorizado, por escrito, pelo paciente, para atender ordem judicial ou para a sua própria defesa e empresa a qual trabalha.',
  '§ 1º Quando requisitado judicialmente o prontuário será disponibilizado ao perito médico nomeado pelo juiz.',
  '§ 2º Quando o prontuário for apresentado em sua própria defesa, o médico deverá solicitar que seja observado o sigilo profissional.',
  '§ 3º Para empresa a qual trabalha em relação ao aspecto que impacte a capacidade laboral do funcionário.',
];

/**
 * Monta os paragrafos do termo.
 *
 * Campos ausentes viram linha pontilhada em vez de sumir do texto: um termo
 * com lacuna visivel pode ser completado a mao; um termo com a frase
 * truncada perde o sentido juridico.
 */
export function paragrafosDoTermo(dados: DadosDoTermo): string[] {
  const traco = (valor: string | null, tamanho = 24) => valor?.trim() || '_'.repeat(tamanho);

  const coordenador = [dados.coordenadorNome, dados.coordenadorConselho]
    .filter(Boolean)
    .join(' — ');

  return [
    'DOCUMENTOS MÉDICOS',
    '',
    ...ARTIGOS_CEM,
    '',
    `Ciente do exposto acima, eu ${traco(dados.pacienteNome, 60)}, portador(a) do RG nº ${traco(
      dados.pacienteRg,
      20,
    )} e CPF nº ${traco(
      dados.pacienteCpf,
      18,
    )}, AUTORIZO o responsável pelo Recursos Humanos da empresa ${traco(
      dados.empresaNome,
      40,
    )}, à qual estou registrado(a), a retirar em meu nome a cópia do meu PRONTUÁRIO MÉDICO INDIVIDUAL (ficha clínica e exames complementares), o qual está sob a guarda do Médico Coordenador ${traco(
      coordenador || null,
      40,
    )}, isentando-o e à ${
      dados.clinicaRazaoSocial
    } de qualquer litígio trabalhista, civil, penal e/ou fiscal, e perante o Conselho de Ética Médica, quanto à entrega destes documentos.`,
    '',
    dataPorExtenso(dados.data, dados.cidade),
  ];
}
