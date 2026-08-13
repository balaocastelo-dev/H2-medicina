/**
 * Roteiro dos baloes que ensinam a usar cada tela.
 *
 * Escrito na ordem em que a pessoa realmente trabalha, e nao na ordem em
 * que os campos aparecem no HTML. Cada passo responde a uma pergunta que a
 * equipe faria em voz alta na primeira semana.
 *
 * Logica pura: da para testar o roteiro sem abrir o navegador.
 */

export interface PassoDoGuia {
  /**
   * Elemento destacado, via `data-guia="..."`. Sem alvo, o balao aparece
   * centralizado — usado para abrir e fechar o roteiro.
   */
  alvo?: string;
  titulo: string;
  texto: string;
}

export interface Roteiro {
  chave: string;
  /** Rota exata da tela. */
  rota: string;
  titulo: string;
  passos: PassoDoGuia[];
}

export const ROTEIROS: Roteiro[] = [
  {
    chave: 'dashboard',
    rota: '/dashboard',
    titulo: 'Primeiros passos',
    passos: [
      {
        titulo: 'Bem-vinda ao sistema',
        texto:
          'Vou mostrar o caminho que o paciente faz aqui dentro, tela por tela. Leva menos de um minuto e você pode parar quando quiser.',
      },
      {
        alvo: 'menu-lateral',
        titulo: 'O menu segue a esteira',
        texto:
          'A ordem do menu é a ordem do atendimento: Recepção, Triagem, Filas, Médico, Pagamentos e Documentos. Se estiver perdida, siga o menu de cima para baixo.',
      },
      {
        alvo: 'menu-contador',
        titulo: 'As bolinhas vermelhas',
        texto:
          'O número ao lado de cada tela é quanta gente está parada ali esperando. Bolinha alta em uma etapa é onde a fila está travando.',
      },
      {
        alvo: 'busca-paciente',
        titulo: 'Perdeu alguém? Procure aqui',
        texto:
          'Digite o nome ou o CPF e o sistema responde onde a pessoa está agora, por onde já passou e quanto tempo ficou em cada etapa.',
      },
      {
        alvo: 'botao-ajuda',
        titulo: 'Este guia fica sempre à mão',
        texto:
          'Em qualquer tela, clique em Ajuda para rever as explicações daquela tela. Ele não vai aparecer sozinho de novo.',
      },
    ],
  },

  {
    chave: 'recepcao',
    rota: '/recepcao',
    titulo: 'Como usar a Recepção',
    passos: [
      {
        titulo: 'A recepção é o primeiro filtro',
        texto:
          'O paciente tira a senha no totem e cai nesta fila. É aqui que você decide por onde ele vai andar dentro da clínica.',
      },
      {
        alvo: 'fila-recepcao',
        titulo: 'A fila de quem chegou',
        texto:
          'Todos que fizeram check-in hoje aparecem aqui, na ordem de chegada. Clique no nome para abrir a ficha ao lado.',
      },
      {
        alvo: 'procedencia',
        titulo: 'De onde vem este paciente?',
        texto:
          'Esta é a escolha mais importante da tela. P é empresa ou particular; E é Estado; S é SISPER; I é ingresso escolar. O sistema encaminha o paciente sozinho a partir dela.',
      },
      {
        alvo: 'autorizacao',
        titulo: 'Autorização da empresa',
        texto:
          'Só aparece para paciente particular. Sem este termo assinado, o prontuário não pode ser entregue ao RH. O paciente pode assinar na tela ou você imprime para ele assinar no papel.',
      },
      {
        alvo: 'exames',
        titulo: 'Confirme o que ele vai fazer',
        texto:
          'Marque os exames. Para Estado, SISPER e ingresso isso é opcional: eles vão direto ao médico.',
      },
      {
        alvo: 'cobranca',
        titulo: 'Cobrança, só para particular',
        texto:
          'Gere o Pix aqui e confirme quando o dinheiro cair. Estado, SISPER e ingresso não pagam nada no balcão — nem aparece cobrança para eles.',
      },
      {
        alvo: 'liberar',
        titulo: 'Libere o paciente',
        texto:
          'O botão diz para onde ele vai de verdade: triagem, exames ou direto ao médico. Depois de clicar, ele sai desta fila e aparece na tela seguinte.',
      },
    ],
  },

  {
    chave: 'triagem',
    rota: '/triagem',
    titulo: 'Como usar a Triagem',
    passos: [
      {
        titulo: 'Quem chega aqui',
        texto:
          'Todo paciente que a recepção encaminhou para triagem. Estado costuma pular esta etapa e ir direto ao médico.',
      },
      {
        alvo: 'fila-triagem',
        titulo: 'A fila da triagem',
        texto: 'Escolha o paciente na lista e o formulário abre ao lado.',
      },
      {
        alvo: 'formulario-triagem',
        titulo: 'Sinais vitais e alertas',
        texto:
          'Preencha o que mediu. Você pode salvar sem concluir e voltar depois — nada se perde.',
      },
      {
        alvo: 'concluir-triagem',
        titulo: 'Concluir move o paciente',
        texto:
          'Ao concluir, o sistema encaminha sozinho: particular com exame marcado vai para as filas de exame; os demais vão direto ao médico.',
      },
    ],
  },

  {
    chave: 'filas',
    rota: '/filas',
    titulo: 'Como usar as Filas e salas',
    passos: [
      {
        titulo: 'Uma fila por sala',
        texto:
          'Cada sala chama o próximo da sua própria fila. O painel da TV anuncia a senha e o nome em voz alta.',
      },
      {
        alvo: 'chamar-proximo',
        titulo: 'Chamar o próximo',
        texto:
          'A sala só chama quem está liberado para exames. Se disser que não há ninguém, o sistema explica onde os pacientes estão parados.',
      },
      {
        alvo: 'concluir-exame',
        titulo: 'Concluir libera o paciente',
        texto:
          'Quando o último exame do paciente é concluído, ele vai automaticamente para a fila do médico. Não precisa mover nada à mão.',
      },
    ],
  },

  {
    chave: 'medico',
    rota: '/medico',
    titulo: 'Como usar o Módulo médico',
    passos: [
      {
        titulo: 'Sua fila do dia',
        texto:
          'Aqui chegam os pacientes que terminaram exames, e também os do Estado, SISPER e ingresso, que vêm direto.',
      },
      {
        alvo: 'fila-medico',
        titulo: 'Escolha o paciente',
        texto: 'Clique no nome para abrir a ficha com triagem, exames e histórico.',
      },
      {
        alvo: 'conclusao-medica',
        titulo: 'Aptidão e validade',
        texto:
          'A conclusão de aptidão é obrigatória para finalizar. É ela que vai para o ASO e para os documentos do paciente.',
      },
      {
        alvo: 'finalizar-consulta',
        titulo: 'Finalizar segue para o caixa',
        texto:
          'Ao finalizar, o paciente vai para Pagamentos e depois para Documentos. Você não precisa avisar ninguém: as telas se atualizam sozinhas.',
      },
    ],
  },

  {
    chave: 'pagamentos',
    rota: '/pagamentos',
    titulo: 'Como usar os Pagamentos',
    passos: [
      {
        titulo: 'A conta fecha antes do papel',
        texto:
          'Nenhum documento sai com valor em aberto. Esta tela existe para fechar a conta antes de liberar os documentos.',
      },
      {
        alvo: 'gerar-pix',
        titulo: 'Pix na hora',
        texto: 'Gere o QR Code e confirme o recebimento quando o dinheiro cair.',
      },
      {
        alvo: 'liberar-documentos',
        titulo: 'Liberar documentos',
        texto:
          'Com a conta zerada, libere. Faturamento empresarial passa direto — a cobrança é da empresa, não do paciente.',
      },
    ],
  },

  {
    chave: 'documentos',
    rota: '/documentos',
    titulo: 'Como usar os Documentos',
    passos: [
      {
        titulo: 'A última parada',
        texto: 'É daqui que o paciente sai com os papéis na mão.',
      },
      {
        alvo: 'kit-saida',
        titulo: 'Kit de saída',
        texto:
          'Emite de uma vez o comprovante de comparecimento, o recibo e o comprovante de agendamento. Vale para as quatro procedências.',
      },
      {
        alvo: 'encerrar-atendimento',
        titulo: 'Encerrar o atendimento',
        texto:
          'Encerrar já emite o kit de saída sozinho e tira o paciente do quadro do dia. Use quando ele estiver indo embora.',
      },
    ],
  },

  {
    chave: 'crm',
    rota: '/crm',
    titulo: 'Como usar o CRM do dia',
    passos: [
      {
        titulo: 'Todo mundo, numa tela só',
        texto:
          'Cada coluna é uma etapa e cada cartão é uma pessoa. É a visão de quem quer bater o olho e saber como está o dia.',
      },
      {
        alvo: 'coluna-crm',
        titulo: 'As colunas são a esteira',
        texto:
          'Da esquerda para a direita: recepção, triagem, exames, médico, pagamento, documentos. Coluna cheia é gargalo.',
      },
      {
        alvo: 'cartao-crm',
        titulo: 'Clique no cartão',
        texto:
          'Abre a trilha do paciente: por onde passou, quanto tempo em cada etapa e qual é o próximo passo.',
      },
      {
        alvo: 'arrastar-crm',
        titulo: 'Arrastar é a exceção',
        texto:
          'Dá para arrastar o cartão para outra coluna, mas evite: o normal é o próprio fluxo mover o paciente. Todo arraste fica registrado como manual.',
      },
    ],
  },

  {
    chave: 'agenda',
    rota: '/agenda',
    titulo: 'Como usar a Agenda',
    passos: [
      {
        titulo: 'O que está marcado',
        texto: 'O calendário mostra o volume por dia. Clique no dia para ver a lista.',
      },
      {
        alvo: 'novo-agendamento',
        titulo: 'Agendar uma pessoa',
        texto: 'Para um paciente por vez, com exames e horário.',
      },
      {
        alvo: 'agendamento-avulso',
        titulo: 'Agendar a lista do RH',
        texto:
          'Quando a empresa manda vários funcionários de uma vez, use Agendamento avulso: cadastra e agenda todo mundo numa tela só.',
      },
    ],
  },

  {
    chave: 'importacao-planilhas',
    rota: '/importacao/planilhas',
    titulo: 'Como importar planilhas',
    passos: [
      {
        titulo: 'SISPER, Estado e ingresso',
        texto:
          'Em vez de digitar um por um, jogue a planilha aqui. O sistema cria os pacientes e agenda todos.',
      },
      {
        alvo: 'origem-planilha',
        titulo: 'Diga de onde vem',
        texto: 'A procedência escolhida aqui define o caminho de todos os pacientes do arquivo.',
      },
      {
        alvo: 'arquivo-planilha',
        titulo: 'Selecione o arquivo',
        texto:
          'A leitura acontece no seu computador. Nada é gravado antes de você conferir na tela.',
      },
      {
        alvo: 'conferencia-planilha',
        titulo: 'Confira antes de gravar',
        texto:
          'Linha com problema aparece marcada em amarelo, com o motivo. As demais são importadas normalmente — uma linha ruim não derruba o arquivo inteiro.',
      },
    ],
  },

  {
    chave: 'contratos',
    rota: '/empresas/contratos',
    titulo: 'Como usar os Contratos',
    passos: [
      {
        titulo: 'O contrato de cada empresa',
        texto: 'Vigência, valor, cota de exames e alerta de vencimento, tudo num lugar só.',
      },
      {
        alvo: 'alerta-vencimento',
        titulo: 'Quem está vencendo',
        texto:
          'O sistema avisa com 60 e 30 dias — os mesmos prazos da cláusula de convocação do contrato.',
      },
      {
        alvo: 'itens-contrato',
        titulo: 'Cota de exames',
        texto:
          'Cadastre quantos exames estão inclusos e quanto custa o excedente. O consumo é descontado sozinho conforme os exames são concluídos.',
      },
      {
        alvo: 'gerar-contrato',
        titulo: 'Contrato em PDF',
        texto: 'Gera o contrato já preenchido com os dados da empresa, pronto para assinar.',
      },
    ],
  },

  {
    chave: 'jornada',
    rota: '/jornada',
    titulo: 'Onde está cada um',
    passos: [
      {
        titulo: 'O mapa do dia',
        texto:
          'Todos os pacientes de hoje, agrupados pela etapa em que estão. Serve para responder “cadê o fulano?” sem procurar de tela em tela.',
      },
      {
        alvo: 'grupos-jornada',
        titulo: 'Agrupado por etapa',
        texto:
          'Cada bloco é uma etapa, com quem está nela e há quanto tempo. Tempo alto é sinal de alguém esquecido.',
      },
      {
        alvo: 'busca-paciente',
        titulo: 'Procurar uma pessoa',
        texto: 'Para achar alguém específico, use a busca no alto da tela.',
      },
    ],
  },
];

const POR_ROTA = new Map(ROTEIROS.map((r) => [r.rota, r]));

/**
 * Roteiro da rota atual.
 *
 * Casa pelo caminho exato: `/agenda/novo` nao deve disparar o guia de
 * `/agenda`, que fala de coisas que nao estao naquela tela.
 */
export function roteiroDaRota(pathname: string | null | undefined): Roteiro | null {
  if (!pathname) return null;
  const limpo = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return POR_ROTA.get(limpo) ?? null;
}

export function roteiroPorChave(chave: string): Roteiro | null {
  return ROTEIROS.find((r) => r.chave === chave) ?? null;
}
