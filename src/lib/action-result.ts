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

/**
 * Converte erros conhecidos (Postgres/Zod) em mensagens em portugues.
 *
 * O que nao for reconhecido aqui chega CRU na tela da recepcao, em ingles e
 * com nome de tabela. Por isso a lista cobre os codigos que a operacao do
 * dia a dia realmente produz, e nao so os bonitos de mapear.
 */
export function toFriendlyError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;

    // Sessao expirada e permissao negada, que era o caso mais comum de todos.
    //
    // `PermissionError` monta a mensagem como "Sem permissao: <codigo>" — sem
    // cedilha, porque o codigo-fonte do projeto evita acento em identificador.
    // O teste aqui procurava "Sem permissão", COM cedilha: nunca casava, e a
    // tela mostrava "Sem permissao: sessao" para quem so precisava entrar de
    // novo. A recepcao deixa o sistema aberto o dia inteiro, entao esse era o
    // erro que a clinica mais via — e o que menos entendia.
    if (msg.startsWith('Sem permiss')) {
      if (msg.includes('sessao') || msg.includes('sessão')) {
        return 'Sua sessão expirou. Entre no sistema novamente para continuar.';
      }
      return 'Você não tem permissão para esta ação. Fale com quem administra o sistema.';
    }

    // Zero linhas afetadas com `.single()`.
    //
    // Sob RLS forcado, UPDATE barrado afeta zero linhas sem erro; o PostgREST
    // entao responde PGRST116 ao `.single()`. E o erro mais provavel do
    // sistema, e saia em ingles falando de "JSON object".
    if (msg.includes('PGRST116') || msg.includes('Cannot coerce the result')) {
      return 'Não foi possível alterar este registro. Atualize a tela e tente de novo.';
    }
    if (msg.includes('violates foreign key constraint') || msg.includes('23503')) {
      return 'Este registro está ligado a outro e não pode ser alterado ou removido assim.';
    }
    if (msg.includes('violates not-null constraint') || msg.includes('23502')) {
      return 'Falta preencher um campo obrigatório.';
    }
    if (msg.includes('invalid input syntax for type uuid') || msg.includes('22P02')) {
      return 'Registro não encontrado. Atualize a tela e tente de novo.';
    }
    // Rede, banco fora do ar, tempo esgotado.
    if (
      msg.includes('fetch failed') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('Failed to fetch')
    ) {
      return 'Sem conexão com o servidor agora. Verifique a internet e tente de novo.';
    }
    // Mensagem do Zod quando a coercao de numero falha (campo com virgula
    // decimal em navegador configurado em ingles, por exemplo).
    if (msg.includes('expected number') || msg.includes('received NaN')) {
      return 'Valor numérico inválido. Use apenas números, com ponto para os centavos.';
    }

    if (msg.includes('duplicate key')) {
      if (msg.includes('uq_patients_tenant_cpf')) return 'Já existe um paciente com este CPF.';
      if (msg.includes('uq_companies_tenant_document'))
        return 'Já existe uma empresa com este CNPJ.';
      if (msg.includes('uq_appointments_patient_day'))
        return 'Este paciente já possui agendamento neste dia.';
      if (msg.includes('uq_patient_exam_in_service'))
        return 'O paciente já esta sendo atendido em outra sala.';
      return 'Registro duplicado.';
    }
    if (msg.includes('violates row-level security') || msg.includes('42501')) {
      return 'Sem permissão para executar esta operação.';
    }
    if (msg.includes('patients_cpf_valid')) return 'CPF inválido.';
    if (msg.includes('companies_document_valid')) return 'CNPJ inválido.';
    return msg;
  }
  return 'Erro inesperado. Tente novamente.';
}
