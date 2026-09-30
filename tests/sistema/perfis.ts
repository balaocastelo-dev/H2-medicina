/**
 * Os perfis que a clinica produz num dia de verdade.
 *
 * Nao sao "pacientes aleatorios": cada combinacao existe porque e um jeito
 * conhecido de o sistema errar. Trezentos pacientes iguais provariam uma
 * coisa so trezentas vezes.
 */
import type { Perfil } from './percurso';

/** Combinacoes de exames que a recepcao marca de verdade. */
const COMBINACOES: { exames: string[]; porque: string }[] = [
  { exames: ['CLINICO'], porque: 'so a consulta: nenhum exame de sala para disparar a etapa' },
  { exames: ['AUDIO', 'CLINICO'], porque: 'o admissional comum' },
  { exames: ['AUDIO'], porque: 'exame de sala sem consulta: termina no caixa, sem medico' },
  { exames: ['RAIOX'], porque: 'feito fora: nao entra em fila nenhuma' },
  { exames: ['LAB'], porque: 'coleta com guia impressa' },
  { exames: ['RAIOX', 'LAB', 'CLINICO'], porque: 'dois fora da clinica mais a consulta' },
  {
    exames: ['DINAMO_PAL', 'DINAMO_ESC', 'DINAMO_LOM'],
    porque: 'tres exames na mesma sala: uma chamada so',
  },
  {
    exames: ['AUDIO', 'ESPIRO', 'ECG', 'EEG', 'ACUIDADE', 'CLINICO'],
    porque: 'seis exames em cinco salas: o percurso mais longo',
  },
  { exames: ['ACUIDADE', 'ISHIHARA'], porque: 'bancada da triagem, sem consulta' },
  { exames: ['ROMBERG', 'CLINICO'], porque: 'Romberg foi para a consulta em 29/09' },
  { exames: ['PSICO', 'CLINICO'], porque: 'psicossocial e do medico desde 22/09' },
  { exames: ['ROMBERG'], porque: 'so Romberg: vai ao medico sem consulta marcada' },
  { exames: ['FADIGA', 'CLINICO'], porque: 'ficha de bancada com laudo proprio' },
  { exames: [], porque: 'nenhum exame marcado: nao pode sumir do sistema' },
];

/** Procedencias, que mudam o destino do paciente. */
const PROCEDENCIAS: { origem: string; triagem: boolean; porque: string }[] = [
  { origem: 'particular', triagem: true, porque: 'particular com triagem' },
  { origem: 'particular', triagem: false, porque: 'particular direto para os exames' },
  // Convenio com empresa nao e uma procedencia: e um particular com
  // vinculo. A procedencia diz quem custeia o atendimento (a clinica, o
  // estado, o SISPER); a empresa entra pelo cadastro do paciente e e ela
  // que decide o preco.
  { origem: 'particular', triagem: true, porque: 'convenio com a empresa' },
  { origem: 'estado', triagem: false, porque: 'pericia: vai ao medico mesmo sem consulta marcada' },
  { origem: 'sisper', triagem: false, porque: 'SISPER: avaliacao medica e o motivo da visita' },
  // O SISPER passa pela triagem por definicao ("Passa pela triagem e segue
  // direto ao medico"). Essa combinacao nunca tinha sido exercitada, e era
  // justamente nela que o encaminhamento pos-triagem mandava o paciente
  // para o caixa sem ver o medico.
  { origem: 'sisper', triagem: true, porque: 'SISPER passando pela triagem, como e de verdade' },
  { origem: 'estado', triagem: true, porque: 'pericia que ainda assim passa pela triagem' },
  { origem: 'ingresso', triagem: true, porque: 'ingresso escolar termina em avaliacao medica' },
];

/**
 * Procedimentos do catalogo da clinica.
 *
 * Sao eles que decidem o valor do repasse do medico e se o atendimento
 * emite ficha clinica -- pericia e junta medica nao emitem. `null` e o
 * atendimento comum, que cai em "consulta ocupacional".
 */
const PROCEDIMENTOS: (string | null)[] = [
  null,
  'cps',
  null,
  'seduc',
  null,
  'pericia',
  null,
  'junta_medica',
  null,
  'ingresso',
];

/** Datas de nascimento que ja quebraram alguma coisa. */
const NASCIMENTOS = [
  '1900-01-01',
  '1940-02-29',
  '1963-12-02',
  '1970-01-01',
  '1978-12-31',
  '1985-11-25',
  '1992-02-29',
  '2000-02-29',
  '2006-03-15',
  null,
];

const PRIMEIROS = [
  'Adriana', 'Bruno', 'Camila', 'Diego', 'Eliane', 'Fábio', 'Gisele', 'Heitor',
  'Ivana', 'Joaquim', 'Karina', 'Lucas', 'Marlene', 'Nelson', 'Otávio', 'Patrícia',
  'Quirino', 'Renato', 'Sílvia', 'Tadeu', 'Úrsula', 'Valdir', 'Wanda', 'Yara',
];
const SOBRENOMES = [
  'Nogueira Prado', 'Salgado Ferrarini', 'Peixoto Vasconcelos', 'Ramalho Quintanilha',
  'Fontes Bittencourt', 'Quintela Marchesini', 'Amâncio Taborda', 'Vasques de Alencastro',
  'Portela Schiavinato', 'Tavares Bandeira', 'da Silva', 'de Almeida Souza',
];

/**
 * Gera o lote do dia.
 *
 * O sorteio e determinístico: a mesma semente produz o mesmo dia. Um teste
 * que falha so as vezes nao e usado por ninguem.
 */
export function gerarPerfis(quantos: number, empresas: string[], semente0 = 20260929): Perfil[] {
  let semente = semente0;
  const proximo = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  const sorteia = <T,>(lista: T[]): T => lista[Math.floor(proximo() * lista.length)]!;

  const perfis: Perfil[] = [];

  for (let i = 0; i < quantos; i++) {
    const combo = COMBINACOES[i % COMBINACOES.length]!;
    const proc = PROCEDENCIAS[Math.floor(i / COMBINACOES.length) % PROCEDENCIAS.length]!;
    const nascimento = NASCIMENTOS[i % NASCIMENTOS.length]!;

    // Uma parte tem empresa; o resto e particular sem vinculo.
    const empresa = proc.origem === 'empresa' || i % 3 === 0 ? sorteia(empresas) : null;

    perfis.push({
      porque: `${combo.porque} / ${proc.porque}`,
      nome: `${sorteia(PRIMEIROS)} ${sorteia(SOBRENOMES)} ${i + 1}`,
      nascimento,
      sexo: i % 2 === 0 ? 'feminino' : 'masculino',
      empresaId: empresa,
      cargo: i % 4 === 0 ? 'Operador de máquinas' : null,
      exames: combo.exames,
      procedencia: proc.origem,
      triagem: proc.triagem,
      prioridade: i % 17 === 0 ? 'prioritario' : i % 23 === 0 ? 'encaixe' : 'normal',
      // O procedimento decide o repasse do medico e se ha ficha clinica.
      // Variar aqui e o que faz o relatorio de pagamento ter mais de uma
      // linha -- e o que exercita a regra "pericia nao emite ficha".
      procedimento: PROCEDIMENTOS[i % PROCEDIMENTOS.length]!,
      // Um em cada trinta desiste no meio: o sistema precisa solta-lo.
      desiste: i % 30 === 29,
      // Um em cada dezenove nao faz um dos exames.
      naoRealiza: i % 19 === 18 ? combo.exames[0] : undefined,
    });
  }

  return perfis;
}
