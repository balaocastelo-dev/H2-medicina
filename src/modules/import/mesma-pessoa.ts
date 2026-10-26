import { normalizarBusca } from '@/modules/queue/busca-nome';

/**
 * Reconhecer a mesma pessoa numa lista colada duas vezes.
 *
 * "na hr de incluir a agenda pelo robozinho ele esta duplicando os
 *  atendimentos que ja foram inclusos" -- Isabella, 28/09.
 *
 * Havia uma trava contra duplicata, e ela funcionava: o banco tem indice
 * unico de paciente + dia. O problema era acontecer ANTES dela.
 *
 * A lista da agenda vem de um portal que nem sempre traz CPF. Sem CPF, a
 * busca caia para nome + nascimento; sem nascimento, nao havia busca
 * nenhuma, e o paciente era criado de novo. Paciente novo tem id novo, o
 * indice unico nao ve duplicata, e o agendamento entra outra vez -- agora
 * com dois prontuarios para a mesma pessoa.
 *
 * E mesmo com nascimento a comparacao era exata: "JOSE DA SILVA" e "José da
 * Silva" eram duas pessoas diferentes para o sistema.
 *
 * ---------------------------------------------------------------------
 * Por que a comparacao por nome e limitada ao dia
 * ---------------------------------------------------------------------
 * Juntar duas pessoas pelo nome e pior do que duplicar: dois homonimos
 * viram um prontuario so, e o exame de um aparece no papel do outro. Isso
 * nao se desfaz.
 *
 * Por isso o nome sozinho so vale dentro da AGENDA DAQUELE DIA -- que e
 * exatamente o caso que a Isabella descreveu: a mesma lista colada de novo.
 * Dois homonimos na mesma agenda do mesmo dia sao raros, e nesse caso o
 * segundo aparece em "ignorados", visivel, para a clinica resolver. Um
 * ignorado visivel e melhor que um prontuario errado em silencio.
 */

/** Nome comparavel: sem acento, sem caixa, sem espaco sobrando. */
export function chaveDoNome(nome: string): string {
  return normalizarBusca(nome);
}

export function mesmoNome(a: string, b: string): boolean {
  const x = chaveDoNome(a);
  return x.length > 0 && x === chaveDoNome(b);
}

export interface JaAgendado {
  patientId: string;
  nome: string;
}

/**
 * Quem, entre os ja agendados naquele dia, e esta mesma pessoa.
 *
 * Devolve o id do paciente, para o registro colado atualizar o cadastro que
 * ja existe em vez de criar outro.
 */
export function pacienteJaNaAgenda(nome: string, agenda: JaAgendado[]): string | null {
  const alvo = chaveDoNome(nome);
  if (!alvo) return null;
  const achados = agenda.filter((a) => chaveDoNome(a.nome) === alvo);
  // Dois cadastros com o mesmo nome no mesmo dia: nao ha como escolher sem
  // chutar. Devolver nulo faz o registro cair em "ignorados", onde alguem
  // olha.
  if (achados.length !== 1) return null;
  return achados[0]!.patientId;
}

/**
 * Quem ja veio antes, numa lista sem CPF.
 *
 * "se fazemos o agendamento pelo sistema automatico do proximo dia, e a
 *  pessoa ja passou pela clinica anteriormente, o sistema nao reconhece o
 *  novo agendamento" / "ainda esta duplicando os pacientes quando cadastra
 *  de forma automatica" -- Isa, 26/10.
 *
 * A regra acima (nome so dentro do dia) evitava juntar homonimos, mas
 * deixava cada lista nova criar um cadastro novo para quem ja tinha vindo.
 * Na pratica a clinica ficou com tres "Raquel Patricia Felipe". O agendamento
 * ia para o cadastro novo, sem CPF, e no totem o CPF achava o antigo -- sem
 * agendamento -- e a pessoa virava encaixe.
 *
 * Agora, fora do dia, o nome tambem vale, com tres travas:
 *
 *   1. nome com tres palavras ou mais. "Maria Silva" e comum demais;
 *      "Raquel Patricia Felipe" nao e;
 *   2. UM cadastro so com esse nome. Dois ou mais, ninguem escolhe por
 *      chute: cria-se o novo, com o selo "revisar", e a recepcao decide;
 *   3. se a lista e o cadastro tem matricula, elas precisam bater.
 *
 * A matricula, quando vem, e conferida antes do nome: e a identidade que o
 * eSisla usa.
 */
export function nomeServeParaReconhecer(nome: string): boolean {
  return chaveDoNome(nome).split(' ').filter(Boolean).length >= 3;
}

export interface CadastroCandidato {
  id: string;
  full_name: string;
  registration_number: string | null;
}

export function reconhecerPeloNome(
  nome: string,
  matricula: string | null | undefined,
  candidatos: CadastroCandidato[],
): string | null {
  if (!nomeServeParaReconhecer(nome)) return null;
  const alvo = chaveDoNome(nome);
  const iguais = candidatos.filter((c) => chaveDoNome(c.full_name) === alvo);
  if (iguais.length !== 1) return null;
  const unico = iguais[0]!;
  const m = (matricula ?? '').trim();
  const n = (unico.registration_number ?? '').trim();
  if (m && n && m !== n) return null;
  return unico.id;
}
