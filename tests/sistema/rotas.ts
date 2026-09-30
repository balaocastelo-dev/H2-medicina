/**
 * As rotas que um paciente pode percorrer no sistema.
 *
 * Nao sao "50 pacientes aleatorios": sao 50 CAMINHOS distintos, cada um
 * escolhido porque exercita um ponto onde o sistema pode errar. Cinquenta
 * pacientes iguais provariam uma coisa so, cinquenta vezes.
 *
 * O mapa que originou esta lista esta em `docs/o-que-se-espera-do-sistema.md`.
 *
 * Cada rota diz:
 *   - `nome`: como ela seria descrita no balcao;
 *   - `espera`: o que precisa ser verdade no fim. E a afirmacao que falha.
 */
import type { Perfil } from './percurso';

/** O que se espera de uma rota, conferido depois que ela termina. */
export interface Expectativa {
  /** Etapa final do atendimento. */
  etapa: 'finalizado' | 'cancelado' | 'ausente';
  /** Tem cobranca gerada? `null` quando tanto faz. */
  temCobranca?: boolean | null;
  /** Passou pelo medico e assinou? */
  temConsulta?: boolean;
  /** Saiu A.S.O.? */
  temAso?: boolean;
  /** Quantos laudos de exame, no minimo. */
  laudosMinimos?: number;
  /** Gerou repasse para o medico? */
  temRepasse?: boolean;
}

export interface Rota {
  nome: string;
  porque: string;
  perfil: Perfil;
  espera: Expectativa;
  /** Desvios aplicados durante o percurso, pelas acoes de verdade. */
  desvios?: Desvio[];
}

/**
 * Um desvio e uma acao fora do caminho feliz.
 *
 * Sao elas que quase nunca se testa -- e onde os defeitos moram.
 */
export type Desvio =
  | 'repetir_chamada_sala'
  | 'repetir_chamada_triagem'
  | 'devolver_exame_para_fila'
  | 'remanejar_sala_do_exame'
  | 'devolver_da_consulta_para_fila'
  | 'rascunho_de_triagem'
  | 'rascunho_de_consulta'
  | 'cobrar_duas_vezes'
  | 'pagar_no_balcao'
  | 'guia_de_exame'
  | 'termo_de_autorizacao'
  | 'anexar_laudo_depois'
  | 'voltar_etapa_no_crm'
  | 'marcar_ausente';

const PARTICULAR = 'particular';

/** Nome de pessoa, estavel por indice. */
const NOMES = [
  'Amanda Bezerra Quintal', 'Bernardo Achilles Fontoura', 'Clarice Modesto Aragão',
  'Danilo Verissimo Pacheco', 'Elaine Rocha Monteiro', 'Fabrício Delgado Arruda',
  'Giovana Paes de Barros', 'Hélio Camargo Bittencourt', 'Iara Nunes Sampaio',
  'Jonas Teixeira Vilalva', 'Kátia Moreira Lustosa', 'Leandro Bastos Chaves',
  'Mirela Antunes Rezende', 'Norberto Pinheiro Galvão', 'Olívia Cardoso Meneses',
  'Paulo Sérgio Drumond', 'Queila Barreto Assunção', 'Rogério Vasconcelos Pinto',
  'Sandra Lemos Figueiredo', 'Thiago Borges Andrade', 'Ubirajara Correia Neto',
  'Valéria Guimarães Sodré', 'Wellington Rosa Peçanha', 'Ximena Duarte Falcão',
  'Yasmin Portela Coelho', 'Zenon Ribeiro Mascarenhas', 'Alice Moura Tavares',
  'Benedito Farias Coutinho', 'Cristina Aguiar Belmonte', 'Douglas Sarmento Vieira',
  'Eunice Barbosa Trindade', 'Flávio Meireles Cunha', 'Gabriela Xavier Peixoto',
  'Horácio Brandão Lisboa', 'Isadora Freitas Malheiros', 'Juliano Castro Perdigão',
  'Késia Amaral Bragança', 'Lucas Ferraz Albuquerque', 'Marina Caldeira Rangel',
  'Nelson Otávio Vidigal', 'Ofélia Santiago Bulhões', 'Pedro Henrique Valadares',
  'Quitéria Lopes Sobral', 'Ricardo Nogueira Estrela', 'Simone Padilha Werneck',
  'Tobias Rezende Mascarenhas', 'Ursula Campos Linhares', 'Vinícius Prado Salomão',
  'Wanessa Lira Bonfim', 'Ygor Medeiros Guerreiro',
];

const NASCIMENTOS = [
  '1901-03-17', '1944-02-29', '1958-07-09', '1965-12-31', '1972-01-01',
  '1980-06-15', '1988-02-29', '1995-11-03', '2004-10-25', null,
];

function paciente(i: number, extra: Partial<Perfil>): Perfil {
  return {
    porque: extra.porque ?? '',
    nome: `${NOMES[i % NOMES.length]} ${i + 1}`,
    nascimento: NASCIMENTOS[i % NASCIMENTOS.length]!,
    sexo: i % 2 === 0 ? 'feminino' : 'masculino',
    exames: [],
    procedencia: PARTICULAR,
    triagem: false,
    prioridade: 'normal',
    ...extra,
  };
}

/**
 * As 50 rotas.
 *
 * `comEmpresa` recebe os ids das empresas criadas pelo teste, para que as
 * rotas que dependem de valor negociado possam apontar para elas.
 */
export function todasAsRotas(empresas: string[]): Rota[] {
  const comDesconto = empresas[0] ?? null;
  const semDesconto = empresas[1] ?? null;
  let i = 0;
  const p = (extra: Partial<Perfil>) => paciente(i++, extra);

  const rotas: Rota[] = [
    /* ---------------------------------------------------------------- */
    /* A. O caminho comum, em suas variações                            */
    /* ---------------------------------------------------------------- */
    {
      nome: 'A1 · admissional completo',
      porque: 'o percurso mais frequente: triagem, exames de sala e consulta',
      perfil: p({ exames: ['AUDIO', 'ACUIDADE', 'CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temCobranca: true, temConsulta: true, temAso: true, laudosMinimos: 2, temRepasse: true },
    },
    {
      nome: 'A2 · sem triagem, direto aos exames',
      porque: 'a recepção pode dispensar a triagem',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true, laudosMinimos: 1 },
    },
    {
      nome: 'A3 · só consulta, nenhum exame',
      porque: 'nada dispara a etapa seguinte: quem move o paciente é a própria consulta',
      perfil: p({ exames: ['CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
    },
    {
      nome: 'A4 · só exame, sem consulta',
      porque: 'termina no caixa sem passar pelo médico — e sem A.S.O.',
      perfil: p({ exames: ['AUDIO'], triagem: false }),
      espera: { etapa: 'finalizado', temCobranca: true, temConsulta: false, temAso: false, laudosMinimos: 1 },
    },
    {
      nome: 'A5 · nenhum exame marcado',
      porque: 'não pode sumir do sistema por não ter o que fazer',
      perfil: p({ exames: [], triagem: false }),
      espera: { etapa: 'finalizado' },
    },
    {
      nome: 'A6 · seis exames em cinco salas',
      porque: 'o percurso mais longo, com a fila cheia',
      perfil: p({ exames: ['AUDIO', 'ESPIRO', 'ECG', 'EEG', 'ACUIDADE', 'CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true, laudosMinimos: 2 },
    },
    {
      nome: 'A7 · três dinamometrias na mesma sala',
      porque: 'uma chamada só precisa trazer os três exames daquela sala',
      perfil: p({ exames: ['DINAMO_PAL', 'DINAMO_ESC', 'DINAMO_LOM', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, laudosMinimos: 3 },
    },

    /* ---------------------------------------------------------------- */
    /* B. Exames que não acontecem em sala                              */
    /* ---------------------------------------------------------------- */
    {
      nome: 'B1 · só raio X',
      porque: 'feito fora: não entra em fila nenhuma, sai como guia',
      perfil: p({ exames: ['RAIOX'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: false },
      desvios: ['guia_de_exame'],
    },
    {
      nome: 'B2 · só coleta laboratorial',
      porque: 'coleta é feita aqui, mas com guia impressa no balcão',
      perfil: p({ exames: ['LAB'], triagem: false }),
      espera: { etapa: 'finalizado' },
      desvios: ['guia_de_exame'],
    },
    {
      nome: 'B3 · raio X e coleta mais consulta',
      porque: 'dois de fora e um dentro: o paciente não pode ficar preso esperando os de fora',
      perfil: p({ exames: ['RAIOX', 'LAB', 'CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
      desvios: ['guia_de_exame'],
    },
    {
      nome: 'B4 · psicossocial, respondido pelo médico',
      porque: 'não ocupa sala e leva o paciente ao consultório',
      perfil: p({ exames: ['PSICO', 'CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
    },
    {
      nome: 'B5 · só Romberg',
      porque: 'desde 29/09 é do médico: vai ao consultório sem consulta marcada',
      perfil: p({ exames: ['ROMBERG'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, laudosMinimos: 1 },
    },
    {
      nome: 'B6 · Romberg com triagem',
      porque: 'sai da triagem devendo só um item do médico — o buraco de 22/09',
      perfil: p({ exames: ['ROMBERG'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true },
    },
    {
      nome: 'B7 · exames de bancada, sem consulta',
      porque: 'acuidade e Ishihara são feitos na triagem e terminam no caixa',
      perfil: p({ exames: ['ACUIDADE', 'ISHIHARA'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: false, laudosMinimos: 2 },
    },

    /* ---------------------------------------------------------------- */
    /* C. Procedências                                                   */
    /* ---------------------------------------------------------------- */
    {
      nome: 'C1 · perícia sem exame',
      porque: 'a avaliação médica é o motivo da visita; não gera cobrança',
      perfil: p({ exames: [], procedencia: 'estado', triagem: false, procedimento: 'pericia' }),
      espera: { etapa: 'finalizado', temCobranca: false, temConsulta: true, temRepasse: true },
    },
    {
      nome: 'C2 · perícia COM exame de sala',
      porque: 'o exame vem antes do médico — senão fica pendente para sempre',
      perfil: p({ exames: ['AUDIO'], procedencia: 'estado', triagem: false, procedimento: 'pericia' }),
      espera: { etapa: 'finalizado', temCobranca: false, temConsulta: true, laudosMinimos: 1 },
    },
    {
      nome: 'C3 · SISPER sem triagem',
      porque: 'vai direto ao médico',
      perfil: p({ exames: [], procedencia: 'sisper', triagem: false }),
      espera: { etapa: 'finalizado', temCobranca: false, temConsulta: true },
    },
    {
      nome: 'C4 · SISPER passando pela triagem',
      porque: 'é como acontece de verdade, e o encaminhamento pós-triagem já errou aqui',
      perfil: p({ exames: [], procedencia: 'sisper', triagem: true }),
      espera: { etapa: 'finalizado', temCobranca: false, temConsulta: true },
    },
    {
      nome: 'C5 · ingresso escolar',
      porque: 'termina em avaliação médica mesmo sem consulta marcada',
      perfil: p({ exames: ['ACUIDADE'], procedencia: 'ingresso', triagem: true, procedimento: 'ingresso' }),
      espera: { etapa: 'finalizado', temCobranca: false, temConsulta: true, temRepasse: true },
    },
    {
      nome: 'C6 · junta médica',
      porque: 'procedimento com repasse próprio e sem ficha clínica',
      perfil: p({ exames: [], procedencia: 'estado', triagem: false, procedimento: 'junta_medica' }),
      espera: { etapa: 'finalizado', temConsulta: true, temRepasse: true },
    },
    {
      nome: 'C7 · C.P.S.',
      porque: 'procedimento do catálogo que emite ficha clínica',
      perfil: p({ exames: ['CLINICO'], triagem: true, procedimento: 'cps' }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true, temRepasse: true },
    },
    {
      nome: 'C8 · SEDUC',
      porque: 'outro procedimento do catálogo, com valor diferente',
      perfil: p({ exames: ['CLINICO'], triagem: false, procedimento: 'seduc' }),
      espera: { etapa: 'finalizado', temConsulta: true, temRepasse: true },
    },

    /* ---------------------------------------------------------------- */
    /* D. Empresa e preço                                                */
    /* ---------------------------------------------------------------- */
    {
      nome: 'D1 · empresa com valor negociado',
      porque: 'o valor da aba Empresa tem de valer na cobrança',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], empresaId: comDesconto, triagem: true }),
      espera: { etapa: 'finalizado', temCobranca: true, temConsulta: true },
    },
    {
      nome: 'D2 · empresa sem valor negociado',
      porque: 'cai no preço de tabela, e a diferença entre as duas precisa aparecer',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], empresaId: semDesconto, triagem: true }),
      espera: { etapa: 'finalizado', temCobranca: true, temConsulta: true },
    },
    {
      nome: 'D3 · empresa com desconto e seis exames',
      porque: 'o desconto precisa valer em todos, não só no primeiro',
      perfil: p({ exames: ['AUDIO', 'ESPIRO', 'ECG', 'ACUIDADE', 'ISHIHARA', 'CLINICO'], empresaId: comDesconto, triagem: true }),
      espera: { etapa: 'finalizado', temCobranca: true, temConsulta: true },
    },
    {
      nome: 'D4 · particular sem vínculo',
      porque: 'sem empresa, preço de tabela',
      perfil: p({ exames: ['AUDIO'], triagem: false }),
      espera: { etapa: 'finalizado', temCobranca: true },
    },
    {
      nome: 'D5 · cobrança gerada duas vezes',
      porque: 'clicar de novo não pode empilhar lançamento',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temCobranca: true, temConsulta: true },
      desvios: ['cobrar_duas_vezes'],
    },
    {
      nome: 'D6 · pago no balcão',
      porque: 'confirmar o pagamento na recepção, e não só no caixa do fim',
      perfil: p({ exames: ['AUDIO'], triagem: false }),
      espera: { etapa: 'finalizado', temCobranca: true },
      desvios: ['pagar_no_balcao'],
    },

    /* ---------------------------------------------------------------- */
    /* E. Rotas de exceção — o que dá errado na clínica                  */
    /* ---------------------------------------------------------------- */
    {
      nome: 'E1 · repetir a chamada da senha',
      porque: 'o paciente não ouviu: chamar de novo não pode duplicar nada',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['repetir_chamada_sala'],
    },
    {
      nome: 'E2 · repetir a chamada da triagem',
      porque: 'mesma coisa, na outra tela',
      perfil: p({ exames: ['CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['repetir_chamada_triagem'],
    },
    {
      nome: 'E3 · devolver o exame para a fila',
      porque: 'chamou errado: volta a pendente e solta a sala',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, laudosMinimos: 1 },
      desvios: ['devolver_exame_para_fila'],
    },
    {
      nome: 'E4 · remanejar o exame de sala',
      porque: 'o equipamento mudou de lugar: a sala nova chama, a antiga para',
      perfil: p({ exames: ['ESPIRO', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['remanejar_sala_do_exame'],
    },
    {
      nome: 'E5 · exame não realizado',
      porque: 'o percurso segue sem ele, com o motivo gravado',
      perfil: p({ exames: ['AUDIO', 'ACUIDADE', 'CLINICO'], triagem: false, naoRealiza: 'AUDIO' }),
      espera: { etapa: 'finalizado', temConsulta: true },
    },
    {
      nome: 'E6 · devolver da consulta para a fila do médico',
      porque: 'chamou o paciente errado no consultório',
      perfil: p({ exames: ['CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['devolver_da_consulta_para_fila'],
    },
    {
      nome: 'E7 · triagem salva como rascunho e finalizada depois',
      porque: 'salvar de novo não pode desfazer o que já foi concluído',
      perfil: p({ exames: ['CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['rascunho_de_triagem'],
    },
    {
      nome: 'E8 · consulta salva como rascunho e assinada depois',
      porque: 'o defeito de 22/09: corrigir uma observação desassinava a consulta',
      perfil: p({ exames: ['CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
      desvios: ['rascunho_de_consulta'],
    },
    {
      nome: 'E9 · desiste no meio',
      porque: 'precisa sumir das filas e não gerar cobrança paga',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], triagem: false, desiste: true }),
      espera: { etapa: 'cancelado', temConsulta: false },
    },
    {
      nome: 'E10 · não compareceu',
      porque: 'ausente solta o paciente igual ao cancelado, com outro motivo',
      perfil: p({ exames: ['AUDIO'], triagem: false }),
      espera: { etapa: 'ausente' },
      desvios: ['marcar_ausente'],
    },
    {
      nome: 'E11 · volta a etapa pelo CRM',
      porque: 'voltar o cartão não pode deixar data de encerramento para trás',
      perfil: p({ exames: ['CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['voltar_etapa_no_crm'],
    },
    {
      nome: 'E12 · termo de autorização assinado na tela',
      porque: 'sem o registro de consentimento o termo não prova autorização',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], empresaId: comDesconto, triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['termo_de_autorizacao'],
    },
    {
      nome: 'E13 · laudo que chega dias depois',
      porque: 'anexar ao cadastro e acompanhar o paciente',
      perfil: p({ exames: ['RAIOX', 'CLINICO'], triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
      desvios: ['anexar_laudo_depois'],
    },

    /* ---------------------------------------------------------------- */
    /* F. Dados de borda                                                 */
    /* ---------------------------------------------------------------- */
    {
      nome: 'F1 · nascido em 29 de fevereiro',
      porque: 'ano bissexto: a idade impressa já saiu errada aqui',
      perfil: p({ exames: ['CLINICO'], nascimento: '1944-02-29', triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
    },
    {
      nome: 'F2 · sem data de nascimento',
      porque: 'o documento precisa imprimir travessão, não data errada',
      perfil: p({ exames: ['CLINICO'], nascimento: null, triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
    },
    {
      nome: 'F3 · nascido em 31 de dezembro',
      porque: 'virada de ano no cálculo de idade',
      perfil: p({ exames: ['CLINICO'], nascimento: '1965-12-31', triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
    },
    {
      nome: 'F4 · nascido em 1º de janeiro de 1901',
      porque: 'idade alta, e a borda inferior do calendário',
      perfil: p({ exames: ['CLINICO'], nascimento: '1901-03-17', triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
    },
    {
      nome: 'F5 · prioritário',
      porque: 'a senha tem prefixo próprio e fura a fila de exames',
      perfil: p({ exames: ['AUDIO', 'CLINICO'], prioridade: 'prioritario', triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true },
    },
    {
      nome: 'F6 · encaixe',
      porque: 'a terceira prioridade, que quase nunca se testa',
      perfil: p({ exames: ['AUDIO'], prioridade: 'encaixe', triagem: false }),
      espera: { etapa: 'finalizado' },
    },
    {
      nome: 'F7 · nome muito longo',
      porque: 'o A.S.O. cabe numa folha só — o nome não pode empurrar a assinatura',
      perfil: p({
        nome: 'Maria das Graças Aparecida do Nascimento Albuquerque Ferreira dos Santos Neto',
        exames: ['AUDIO', 'CLINICO'],
        triagem: false,
      }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
    },
    {
      nome: 'F8 · cargo e setor preenchidos',
      porque: 'os campos que vão impressos no A.S.O.',
      perfil: p({ exames: ['CLINICO'], cargo: 'Soldador de estruturas metálicas', triagem: false }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true },
    },

    /* ---------------------------------------------------------------- */
    /* G. Volume e concorrência                                          */
    /* ---------------------------------------------------------------- */
    {
      nome: 'G1 · dois exames na mesma sala, um não realizado',
      porque: 'a chamada traz os dois; um não acontece e a sala precisa soltar',
      perfil: p({ exames: ['DINAMO_PAL', 'DINAMO_ESC', 'CLINICO'], triagem: false, naoRealiza: 'DINAMO_PAL' }),
      espera: { etapa: 'finalizado', temConsulta: true },
    },
    {
      nome: 'G2 · fadiga mais consulta',
      porque: 'ficha de bancada com laudo próprio',
      perfil: p({ exames: ['FADIGA', 'CLINICO'], triagem: true }),
      espera: { etapa: 'finalizado', temConsulta: true, laudosMinimos: 1 },
    },
    {
      nome: 'G3 · todos os exames de uma vez',
      porque: 'o limite: tudo que a clínica oferece, num paciente só',
      perfil: p({
        exames: ['AUDIO', 'ACUIDADE', 'ISHIHARA', 'ROMBERG', 'FADIGA', 'DINAMO_PAL', 'DINAMO_ESC', 'DINAMO_LOM', 'ECG', 'ESPIRO', 'EEG', 'RAIOX', 'LAB', 'PSICO', 'CLINICO'],
        triagem: true,
      }),
      espera: { etapa: 'finalizado', temConsulta: true, temAso: true, laudosMinimos: 5 },
    },
  ];

  // O `porque` de cada rota vira o `porque` do perfil, que aparece na
  // mensagem de falha. Quem lê a falha precisa saber por que aquele
  // paciente existe.
  for (const r of rotas) r.perfil.porque = `${r.nome} — ${r.porque}`;

  return rotas;
}
