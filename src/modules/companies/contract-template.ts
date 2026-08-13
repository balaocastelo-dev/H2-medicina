/**
 * Contrato de prestacao de servicos e gestao em saude ocupacional.
 *
 * O texto segue o modelo em uso na clinica. Os valores que mudam por
 * cliente — numero de funcionarios, mensalidade, dia de vencimento, cota
 * de exames — saem do cadastro do contrato; o resto e clausula fixa.
 *
 * Logica pura: monta os paragrafos, nao grava nada.
 */

export interface ItemDoContrato {
  kind: string;
  name: string;
  quantity_included: number;
  unit_price: number | null;
  extra_price: number | null;
}

export interface DadosDoContrato {
  contratanteRazaoSocial: string;
  contratanteCnpj: string | null;
  contratanteEndereco: string | null;
  contratanteResponsavel: string | null;

  contratadaRazaoSocial: string;
  contratadaCnpj: string | null;
  contratadaEndereco: string | null;
  contratadaRepresentante: string | null;

  coordenadorNome: string | null;
  coordenadorCrm: string | null;

  numeroFuncionarios: number | null;
  valorMensal: number | null;
  valorTotal: number | null;
  diaVencimento: number | null;
  indiceReajuste: string | null;
  multaAtraso: number | null;
  jurosAtraso: number | null;
  horaTecnica: number | null;

  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  renovacaoAutomatica: boolean;
  esocialAtivo: boolean;

  emailAgendamento: string | null;
  emailFinanceiro: string | null;

  itens: ItemDoContrato[];
  cidade: string | null;
  dataEmissao: Date;
}

function dinheiro(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '____________';
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

function ou(valor: string | number | null | undefined, tamanho = 20): string {
  if (valor === null || valor === undefined || valor === '') return '_'.repeat(tamanho);
  return String(valor);
}

function dataBR(iso: string | null): string {
  if (!iso) return '__/__/____';
  const [a, m, d] = iso.split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

/**
 * Monta o contrato completo em paragrafos.
 *
 * Campo nao preenchido vira lacuna visivel em vez de sumir: contrato com
 * linha para completar a mao ainda serve; contrato com frase truncada, nao.
 */
export function paragrafosDoContrato(d: DadosDoContrato): string[] {
  const exames = d.itens.filter((i) => i.kind === 'exame');
  const servicos = d.itens.filter((i) => i.kind === 'servico');

  const linhaItem = (i: ItemDoContrato) => {
    const cota = i.quantity_included > 0 ? `${i.quantity_included} incluído(s)` : 'sob demanda';
    const dentro = i.unit_price !== null ? ` · na cota ${dinheiro(i.unit_price)}` : '';
    const fora = i.extra_price !== null ? ` · excedente ${dinheiro(i.extra_price)}` : '';
    return `• ${i.name} — ${cota}${dentro}${fora}`;
  };

  return [
    'CONTRATO DE PRESTAÇÃO DE SERVIÇOS E GESTÃO EM SAÚDE OCUPACIONAL',
    '',
    `CONTRATANTE: ${ou(d.contratanteRazaoSocial, 50)}, inscrita no CNPJ ${ou(
      d.contratanteCnpj,
      20,
    )}, com sede em ${ou(d.contratanteEndereco, 50)}, neste ato representada por ${ou(
      d.contratanteResponsavel,
      40,
    )}.`,
    '',
    `CONTRATADA: ${d.contratadaRazaoSocial}, pessoa jurídica de direito privado, inscrita no CNPJ ${ou(
      d.contratadaCnpj,
      20,
    )}, com sede em ${ou(d.contratadaEndereco, 50)}, representada por ${ou(
      d.contratadaRepresentante,
      40,
    )}.`,
    '',
    'Por este instrumento particular de Contrato de Prestação de Serviços e Gestão em Saúde Ocupacional, as partes têm entre si justo e acordado as cláusulas e condições a seguir expostas, que aceitam e outorgam mutuamente:',
    '',
    'Cláusula 1ª – OBJETO DO CONTRATO',
    'Parágrafo 1º - Elaboração e implementação do PCMSO (Programa de Controle Médico e Saúde Ocupacional) de acordo com a NR-7 e os dispositivos técnicos e legais aplicáveis, para a promoção e preservação da saúde do conjunto dos trabalhadores da CONTRATANTE, bem como a realização dos exames ocupacionais.',
    d.esocialAtivo
      ? 'Parágrafo 2º - Prestação de serviços relacionados ao envio das informações ao sistema e-Social, delegando à CONTRATADA a responsabilidade de enviar, em seu nome, eventos para o ambiente nacional do e-Social, por meio de procuração eletrônica, com atribuição de perfis exclusivamente para envio dos eventos de saúde ocupacional.'
      : 'Parágrafo 2º - O envio das informações ao sistema e-Social não está incluído neste contrato.',
    '',
    'Cláusula 2ª – DOS BENEFICIÁRIOS',
    `Parágrafo 1º - São considerados beneficiários os funcionários, estagiários e aprendizes estabelecidos na CONTRATANTE, que neste ato declara possuir ${ou(
      d.numeroFuncionarios,
      6,
    )} beneficiários, bem como os novos funcionários a partir da data de admissão.`,
    'Parágrafo 2º - Obrigatoriamente todos os funcionários da CONTRATANTE deverão ser inscritos na CONTRATADA para realização dos exames ocupacionais, sob pena de a CONTRATADA não se responsabilizar pelos não inscritos.',
    '',
    'Cláusula 3ª - DAS OBRIGAÇÕES DA CONTRATADA',
    'Parágrafo 1º - Prestar à CONTRATANTE assistência na área de saúde ocupacional em observância às normas legais, em especial a Norma Regulamentadora nº 7 (NR-7).',
    `Parágrafo 2º - Todo o processo será coordenado por ${ou(
      d.coordenadorNome,
      40,
    )}${d.coordenadorCrm ? ` — ${d.coordenadorCrm}` : ''}, especializado(a) em Medicina do Trabalho e devidamente reconhecido(a) pelo CREMESP, CFM e ANAMT.`,
    'Parágrafo 3º - Adotar critérios para a realização de exames que atendam às necessidades dos funcionários expostos a agentes químicos, físicos, biológicos, ergonômicos e de acidentes, bem como monitorar a exposição ocupacional que represente risco à saúde.',
    'Parágrafo 4º - Solicitar os exames laboratoriais e complementares conforme os riscos apresentados no LTCAT e no PGR/GRO, necessários e previstos pela legislação vigente.',
    'Parágrafo 5º - Apresentar o relatório anual do PCMSO para discussão com a CIPA, quando existente na CONTRATANTE.',
    'Parágrafo 6º - Manter a guarda dos prontuários médicos dos funcionários atuais, demitidos e admitidos pelo prazo de 20 (vinte) anos após o desligamento do funcionário.',
    'Parágrafo 7º - Fornecer os Atestados de Saúde Ocupacional (ASO) em duas vias, uma para a CONTRATANTE e uma para o funcionário.',
    'Parágrafo 8º - Convocar os colaboradores da CONTRATANTE nos períodos de 60 (sessenta) e 30 (trinta) dias antes do vencimento dos exames, por meio do e-mail informado pela CONTRATANTE.',
    '',
    'Cláusula 4ª - DAS OBRIGAÇÕES DA CONTRATANTE',
    'Parágrafo 1º - Garantir a elaboração e a efetiva implementação do PCMSO, zelando pela sua eficácia.',
    'Parágrafo 2º - Fornecer dados e condições indispensáveis ao desenvolvimento do PCMSO e à realização dos exames.',
    'Parágrafo 3º - Encaminhar seus funcionários para os exames médicos exigidos nas épocas previstas pelo PCMSO.',
    'Parágrafo 4º - Nos exames de retorno ao trabalho, encaminhar o funcionário na data imediatamente posterior à alta do INSS.',
    'Parágrafo 5º - Disponibilizar o cadastro dos funcionários com as informações obrigatórias para o ASO: nome, RG, CPF, CTPS, data de admissão, data de nascimento, sexo, NIT (PIS/PASEP), CBO, setor, função e número da matrícula no e-Social.',
    'Parágrafo 6º - Informar por escrito à CONTRATADA as mudanças no quadro de funcionários e nos dados cadastrais, mantendo atualizada a listagem para as convocações.',
    'Parágrafo 7º - Cumprir os pagamentos nas datas previstas, assim como o pagamento de todos os exames já realizados, independentemente do prazo de cobrança.',
    `Parágrafo 8º - É de responsabilidade exclusiva da CONTRATANTE o agendamento pelo e-mail ${ou(
      d.emailAgendamento,
      30,
    )}, onde deverão ser inseridas corretamente todas as informações do colaborador, função e setor constantes no LTCAT, PGR e PCMSO.`,
    '',
    'Cláusula 5ª – DOS PROCEDIMENTOS SEM COBERTURA CONTRATUAL',
    'Está excluído todo atendimento assistencial que não seja em Medicina do Trabalho – Saúde Ocupacional.',
    '',
    'Cláusula 6ª – DO PROGRAMA DE ENGENHARIA E SEGURANÇA DO TRABALHO',
    'Parágrafo 1º - A CONTRATANTE é responsável pela elaboração do LTCAT e do PGR com a empresa de engenharia de sua escolha, a qual responde pelas informações neles constantes.',
    'Parágrafo 2º - A CONTRATADA elaborará o PCMSO mediante apresentação do LTCAT e do PGR, não tendo responsabilidade sobre estes documentos.',
    'Parágrafo 3º - A vigência do PCMSO é de 12 (doze) meses. A renovação depende da apresentação do cronograma de ações devidamente preenchido e cumprido, assinado por representante legal da CONTRATANTE.',
    '',
    'Cláusula 7ª – DO PAGAMENTO DOS SERVIÇOS PRESTADOS',
    `Parágrafo 1º - A CONTRATANTE declara possuir ${ou(
      d.numeroFuncionarios,
      6,
    )} funcionários e o valor mensal deste contrato é de ${dinheiro(d.valorMensal)}${
      d.valorTotal ? `, totalizando ${dinheiro(d.valorTotal)} no período de vigência` : ''
    }.`,
    'Parágrafo 2º - Os valores acima correspondem à realização dos seguintes exames e serviços:',
    ...(exames.length > 0
      ? exames.map(linhaItem)
      : ['• (nenhum exame cadastrado neste contrato)']),
    ...(servicos.length > 0 ? ['', 'Serviços incluídos:', ...servicos.map(linhaItem)] : []),
    '',
    'Parágrafo 3º - Os exames que excederem as quantidades incluídas serão cobrados pelo valor de excedente indicado acima. Quando não contemplados neste contrato, serão cobrados de acordo com a tabela de valores da CONTRATADA.',
    ...(d.horaTecnica !== null
      ? [
          `Parágrafo 4º - O valor da hora técnica do Médico do Trabalho é de ${dinheiro(
            d.horaTecnica,
          )}. Compreende-se hora técnica o tempo despendido para orientação à empresa por telefone ou presencial, visita à empresa e acompanhamento em inspeção.`,
        ]
      : []),
    `Parágrafo 5º - O vencimento das despesas deste contrato será todo dia ${ou(
      d.diaVencimento,
      2,
    )} de cada mês, referente aos atendimentos realizados entre o primeiro e o último dia útil do mês anterior, com apresentação de Nota Fiscal de Prestação de Serviços e boleto bancário${
      d.emailFinanceiro ? `, encaminhados para ${d.emailFinanceiro}` : ''
    }.`,
    `Parágrafo 6º - O atraso no pagamento incidirá multa moratória de ${
      d.multaAtraso ?? 2
    }% sobre o valor do débito, bem como juros de ${d.jurosAtraso ?? 1}% ao mês.`,
    'Parágrafo 7º - Em atraso superior a 15 (quinze) dias, a CONTRATADA poderá, a seu critério, suspender temporariamente o atendimento à CONTRATANTE, sem prejuízo das obrigações contratuais.',
    `Parágrafo 8º - Os valores deste contrato serão reajustados anualmente pelo índice ${
      d.indiceReajuste ?? 'IGP-M'
    }, ou por outro que venha a substituí-lo, independentemente de comunicação, na renovação do presente instrumento.`,
    '',
    'Cláusula 8ª – DA VIGÊNCIA',
    `O presente contrato vigora de ${dataBR(d.vigenciaInicio)} a ${dataBR(d.vigenciaFim)}${
      d.renovacaoAutomatica
        ? ', renovando-se automaticamente por iguais períodos caso não haja manifestação em contrário de qualquer das partes com 30 (trinta) dias de antecedência.'
        : ', sem renovação automática.'
    }`,
    '',
    'Cláusula 9ª – DA RESCISÃO',
    'Em caso de rescisão contratual, fica a CONTRATANTE obrigada a retirar da CONTRATADA os documentos legais (prontuários, laudos e demais documentos) no prazo de até 30 (trinta) dias, em nome do novo Médico Coordenador da empresa, devidamente autorizado.',
    '',
    'E por estarem assim justas e contratadas, as partes assinam o presente instrumento.',
    '',
    `${d.cidade ? `${d.cidade}, ` : ''}${d.dataEmissao.getDate()} de ${
      [
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
      ][d.dataEmissao.getMonth()]
    } de ${d.dataEmissao.getFullYear()}`,
  ];
}

/**
 * Dias que faltam para o contrato vencer.
 * Negativo significa vencido — a tela usa o sinal para escolher a cor.
 */
export function diasAteVencer(ends_on: string | null, hoje = new Date()): number | null {
  if (!ends_on) return null;
  const fim = new Date(`${ends_on}T00:00:00`);
  if (Number.isNaN(fim.getTime())) return null;
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((fim.getTime() - base.getTime()) / 86400000);
}

export type SituacaoContrato = 'vencido' | 'critico' | 'atencao' | 'em_dia' | 'sem_prazo';

/**
 * Classifica o contrato pela proximidade do vencimento.
 *
 * Os cortes seguem a propria clausula de convocacao: 60 e 30 dias. Se a
 * clinica precisa avisar o funcionario com 60 dias, precisa saber do
 * contrato antes disso.
 */
export function situacaoDoContrato(dias: number | null): SituacaoContrato {
  if (dias === null) return 'sem_prazo';
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'critico';
  if (dias <= 60) return 'atencao';
  return 'em_dia';
}

export const CORES_SITUACAO: Record<SituacaoContrato, { cor: string; rotulo: string }> = {
  vencido: { cor: '#EF4444', rotulo: 'vencido' },
  critico: { cor: '#F97316', rotulo: 'vence em 30 dias' },
  atencao: { cor: '#EAB308', rotulo: 'vence em 60 dias' },
  em_dia: { cor: '#22C55E', rotulo: 'em dia' },
  sem_prazo: { cor: '#94A3B8', rotulo: 'sem prazo definido' },
};
