/** Resultado padronizado de Server Actions. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok<T>(data?: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Converte erros conhecidos (Postgres/Zod) em mensagens em portugues. */
export function toFriendlyError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('duplicate key')) {
      if (msg.includes('uq_patients_tenant_cpf')) return 'Ja existe um paciente com este CPF.';
      if (msg.includes('uq_companies_tenant_document'))
        return 'Ja existe uma empresa com este CNPJ.';
      if (msg.includes('uq_appointments_patient_day'))
        return 'Este paciente ja possui agendamento neste dia.';
      if (msg.includes('uq_patient_exam_in_service'))
        return 'O paciente ja esta sendo atendido em outra sala.';
      return 'Registro duplicado.';
    }
    if (msg.includes('violates row-level security') || msg.includes('42501')) {
      return 'Sem permissao para executar esta operacao.';
    }
    if (msg.includes('Sem permissao')) return msg;
    if (msg.includes('patients_cpf_valid')) return 'CPF invalido.';
    if (msg.includes('companies_document_valid')) return 'CNPJ invalido.';
    return msg;
  }
  return 'Erro inesperado. Tente novamente.';
}
