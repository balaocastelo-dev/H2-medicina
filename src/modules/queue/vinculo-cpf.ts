/**
 * Vinculo do CPF ao cadastro que veio sem ele.
 *
 * A lista do SISPER chega sem CPF — so nome e matricula. O paciente digita
 * o CPF no totem, o sistema nao acha, e a pessoa fica sem check-in. Em vez
 * disso, o totem leva a busca por nome e, achando, pergunta se o CPF
 * digitado e dele. Confirmado, o CPF entra no cadastro que ja existe.
 *
 * A regra importante: isso completa um cadastro, nunca cria outro. Criar
 * um segundo cadastro para a mesma pessoa e o que gera prontuario
 * duplicado — exatamente o que a clinica pediu para parar de acontecer.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

import { isValidCPF } from '@/lib/validators';

export type ResultadoDaChecagem =
  | { pode: true }
  | { pode: false; motivo: string; codigo: 'cpf_invalido' | 'ja_tem_outro' | 'em_uso' };

export interface PacienteParaVinculo {
  id: string;
  /** CPF ja gravado neste cadastro, se houver. */
  cpf: string | null;
}

/**
 * O CPF pode ser gravado neste cadastro?
 *
 * Recusa em tres casos, e cada um por um motivo diferente:
 * CPF invalido nao entra em cadastro nenhum; cadastro que ja tem outro CPF
 * sugere que a pessoa escolheu o nome errado na lista; e CPF que ja
 * pertence a outra pessoa juntaria dois prontuarios.
 */
export function podeVincularCpf(
  paciente: PacienteParaVinculo,
  cpf: string,
  donoAtualDoCpf?: { id: string } | null,
): ResultadoDaChecagem {
  const limpo = (cpf ?? '').replace(/\D/g, '');

  if (!isValidCPF(limpo)) {
    return { pode: false, codigo: 'cpf_invalido', motivo: 'O CPF digitado não é válido.' };
  }

  const jaGravado = (paciente.cpf ?? '').replace(/\D/g, '');
  if (jaGravado && jaGravado !== limpo) {
    return {
      pode: false,
      codigo: 'ja_tem_outro',
      motivo: 'Este cadastro já tem outro CPF. Procure a recepção.',
    };
  }

  if (donoAtualDoCpf && donoAtualDoCpf.id !== paciente.id) {
    return {
      pode: false,
      codigo: 'em_uso',
      motivo: 'Este CPF já está em outro cadastro. Procure a recepção.',
    };
  }

  return { pode: true };
}

/**
 * Precisa gravar, ou o cadastro ja esta como deveria?
 *
 * Repetir a gravacao nao estraga nada, mas mexer no cadastro sem motivo
 * gera linha de auditoria a toa e confunde quem for investigar depois.
 */
export function precisaGravar(paciente: PacienteParaVinculo, cpf: string): boolean {
  const limpo = (cpf ?? '').replace(/\D/g, '');
  const jaGravado = (paciente.cpf ?? '').replace(/\D/g, '');
  return limpo.length === 11 && jaGravado !== limpo;
}

/** "12345678900" -> "123.456.789-00", para o paciente conferir na tela. */
export function cpfParaConferencia(cpf: string): string {
  const so = (cpf ?? '').replace(/\D/g, '');
  if (so.length !== 11) return cpf ?? '';
  return `${so.slice(0, 3)}.${so.slice(3, 6)}.${so.slice(6, 9)}-${so.slice(9)}`;
}
