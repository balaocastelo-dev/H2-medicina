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
