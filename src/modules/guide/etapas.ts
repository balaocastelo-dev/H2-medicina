/**
 * As etapas da jornada explicadas em linguagem de balcao.
 *
 * O sistema ja guardava o codigo da etapa (`aguardando_exames`), que serve
 * para a maquina e nao diz nada para quem esta atendendo. Aqui cada etapa
 * ganha tres frases: onde a pessoa esta, quem tem a bola agora e o que
 * acontece em seguida.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

export interface Etapa {
  code: string;
  /** Nome curto, para cracha e coluna. */
  rotulo: string;
  /** Onde o paciente esta fisicamente, na voz de quem atende. */
  onde: string;
  /** De quem e a vez de agir. */
  responsavel: string;
  /** O que acontece depois. */
  proximo: string;
  cor: string;
  /** Etapa encerrada: nao ha proximo passo. */
  terminal: boolean;
}

export const ETAPAS: Etapa[] = [
  {
    code: 'aguardando_recepcao',
    rotulo: 'Aguardando recepção',
    onde: 'na sala de espera, com a senha em mãos',
    responsavel: 'Recepção',
    proximo: 'a recepção chama a senha e confere os dados',
    cor: '#FB923C',
    terminal: false,
  },
  {
    code: 'na_recepcao',
    rotulo: 'Na recepção',
    onde: 'no balcão da recepção',
    responsavel: 'Recepção',
    proximo: 'definir a procedência, confirmar os exames e liberar',
    cor: '#3B82F6',
    terminal: false,
  },
  {
    code: 'aguardando_triagem',
    rotulo: 'Aguardando triagem',
    onde: 'esperando ser chamado para a triagem',
    responsavel: 'Triagem',
    proximo: 'a triagem registra sinais vitais e conclui',
    cor: '#FACC15',
    terminal: false,
  },
  {
    code: 'em_triagem',
    rotulo: 'Em triagem',
    onde: 'na sala de triagem',
    responsavel: 'Triagem',
    proximo: 'ao concluir a triagem, segue para exames ou direto ao médico',
    cor: '#EAB308',
    terminal: false,
  },
  {
    code: 'aguardando_exames',
    rotulo: 'Aguardando exames',
    onde: 'na fila de alguma sala de exame',
    responsavel: 'Filas e salas',
    proximo: 'uma sala chama a senha e inicia o exame',
    cor: '#A855F7',
    terminal: false,
  },
  {
    code: 'em_exames',
    rotulo: 'Em exames',
    onde: 'dentro da sala, fazendo exame',
    responsavel: 'Filas e salas',
    proximo: 'concluído o último exame, vai para o médico',
    cor: '#8B5CF6',
    terminal: false,
  },
  {
    code: 'aguardando_medico',
    rotulo: 'Aguardando médico',
    onde: 'esperando na porta do consultório',
    responsavel: 'Módulo médico',
    proximo: 'o médico abre o atendimento',
    cor: '#0EA5E9',
    terminal: false,
  },
  {
    code: 'em_consulta',
    rotulo: 'Em consulta',
    onde: 'no consultório, com o médico',
    responsavel: 'Módulo médico',
    proximo: 'o médico conclui a aptidão e finaliza',
    cor: '#0284C7',
    terminal: false,
  },
  {
    code: 'aguardando_pagamento',
    rotulo: 'Aguardando pagamento',
    onde: 'no caixa, fechando a conta',
    responsavel: 'Pagamentos',
    proximo: 'confirmar o recebimento libera os documentos',
    cor: '#F97316',
    terminal: false,
  },
  {
    code: 'aguardando_documentos',
    rotulo: 'Aguardando documentos',
    onde: 'esperando os papéis para ir embora',
    responsavel: 'Documentos',
    proximo: 'emitir o kit de saída e encerrar o atendimento',
    cor: '#14B8A6',
    terminal: false,
  },
  {
    code: 'finalizado',
    rotulo: 'Finalizado',
    onde: 'já foi embora, com os documentos',
    responsavel: '—',
    proximo: 'nada pendente',
    cor: '#22C55E',
    terminal: true,
  },
  {
    code: 'cancelado',
    rotulo: 'Cancelado',
    onde: 'atendimento cancelado',
    responsavel: '—',
    proximo: 'nada pendente',
    cor: '#4B5563',
    terminal: true,
  },
  {
    code: 'ausente',
    rotulo: 'Ausente',
    onde: 'foi chamado e não apareceu',
    responsavel: 'Recepção',
    proximo: 'se voltar, refaz o check-in no totem e entra de novo na fila',
    cor: '#EF4444',
    terminal: true,
  },
];

const POR_CODIGO = new Map(ETAPAS.map((e) => [e.code, e]));

export function etapaDe(code: string | null | undefined): Etapa {
  return (
    POR_CODIGO.get(code ?? '') ?? {
      code: code ?? 'desconhecida',
      rotulo: code ?? 'Etapa desconhecida',
      onde: 'etapa não reconhecida pelo sistema',
      responsavel: '—',
      proximo: 'verifique o cadastro de etapas do CRM',
      cor: '#94A3B8',
      terminal: false,
    }
  );
}

/** Ordem da esteira, para desenhar a trilha mesmo sem histórico. */
export const ORDEM_DA_ESTEIRA = [
  'aguardando_recepcao',
  'na_recepcao',
  'aguardando_triagem',
  'em_triagem',
  'aguardando_exames',
  'em_exames',
  'aguardando_medico',
  'em_consulta',
  'aguardando_pagamento',
  'aguardando_documentos',
  'finalizado',
];

/** Tempo em palavras, do jeito que se fala no balcão. */
export function duracaoEmPalavras(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || segundos < 0) return '—';
  if (segundos < 60) return 'menos de 1 min';
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
}

export interface MovimentoBruto {
  from_stage: string | null;
  to_stage: string;
  created_at: string;
  seconds_in_previous: number | null;
  is_manual: boolean;
}

export interface PassoDaTrilha {
  code: string;
  rotulo: string;
  cor: string;
  entrouEm: string;
  /** Quanto tempo o paciente ficou nesta etapa. Nulo enquanto ainda está nela. */
  segundos: number | null;
  /** Etapa alcançada por arraste no CRM, e não pelo fluxo normal. */
  manual: boolean;
}

export interface Trilha {
  passos: PassoDaTrilha[];
  atual: Etapa;
  /** Há quanto tempo está parado na etapa atual, em segundos. */
  segundosNaAtual: number;
  esperaTotalSegundos: number;
  encerrado: boolean;
  /** Frase pronta: onde está e o que falta. */
  resumo: string;
}

/**
 * Monta a trilha percorrida a partir dos movimentos registrados.
 *
 * O tempo de cada etapa vem do proprio movimento seguinte — e por isso que
 * a ultima etapa nao tem duracao fechada: ela ainda esta acontecendo.
 *
 * Atendimento sem nenhum movimento registrado nao fica sem trilha: o
 * check-in vale como primeiro passo.
 */
export function montarTrilha(input: {
  stageCode: string;
  checkinAt: string;
  stageChangedAt: string | null;
  finishedAt?: string | null;
  movimentos: MovimentoBruto[];
  agora?: Date;
}): Trilha {
  const agora = input.agora ?? new Date();
  const movimentos = [...input.movimentos].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const passos: PassoDaTrilha[] = [];

  const primeiroCodigo = movimentos[0]?.from_stage ?? 'aguardando_recepcao';
  const primeira = etapaDe(primeiroCodigo);
  passos.push({
    code: primeira.code,
    rotulo: primeira.rotulo,
    cor: primeira.cor,
    entrouEm: input.checkinAt,
    segundos: movimentos[0]
      ? Math.max(
          0,
          (new Date(movimentos[0].created_at).getTime() - new Date(input.checkinAt).getTime()) /
            1000,
        )
      : null,
    manual: false,
  });

  movimentos.forEach((m, indice) => {
    const etapa = etapaDe(m.to_stage);
    const seguinte = movimentos[indice + 1];
    passos.push({
      code: etapa.code,
      rotulo: etapa.rotulo,
      cor: etapa.cor,
      entrouEm: m.created_at,
      segundos: seguinte
        ? Math.max(
            0,
            (new Date(seguinte.created_at).getTime() - new Date(m.created_at).getTime()) / 1000,
          )
        : null,
      manual: m.is_manual,
    });
  });

  const atual = etapaDe(input.stageCode);
  const desde = input.stageChangedAt ?? movimentos.at(-1)?.created_at ?? input.checkinAt;
  const fim = input.finishedAt ? new Date(input.finishedAt) : agora;

  const segundosNaAtual = Math.max(0, (fim.getTime() - new Date(desde).getTime()) / 1000);
  const esperaTotalSegundos = Math.max(
    0,
    (fim.getTime() - new Date(input.checkinAt).getTime()) / 1000,
  );

  const encerrado = atual.terminal;
  const resumo = encerrado
    ? `${atual.rotulo} — ${atual.onde}. Permaneceu ${duracaoEmPalavras(esperaTotalSegundos)} na clínica.`
    : `Está ${atual.onde}, há ${duracaoEmPalavras(segundosNaAtual)}. Agora é a vez de: ${atual.responsavel}. Em seguida, ${atual.proximo}.`;

  return { passos, atual, segundosNaAtual, esperaTotalSegundos, encerrado, resumo };
}
