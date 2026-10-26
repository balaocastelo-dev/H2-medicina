'use server';

import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { onlyDigits } from '@/lib/format';
import { normalizarBusca } from '@/modules/queue/busca-nome';

export interface PacienteEncontrado {
  id: string;
  full_name: string;
  cpf: string | null;
  company_id: string | null;
  job_title: string | null;
  needs_review: boolean | null;
}

/**
 * Busca de paciente no banco inteiro, enquanto a pessoa digita.
 *
 * As telas de agendamento carregavam os 500 primeiros nomes em ordem
 * alfabetica e filtravam so esses no navegador. Com as listas do eSisla a
 * clinica passou de 500 cadastros, e quem ficava depois do 500o nome nao
 * aparecia: "to cadastrando paciente e nao ta aparecendo ele na hora de
 * fazer o agendamento" -- Isa, 26/10. Aqui a busca vai ao banco, pela
 * coluna `search_key` (sem acento, minuscula), e acha qualquer um.
 *
 * Todas as palavras digitadas precisam bater, como no filtro da tela:
 * "maria seduc" nao traz todas as Marias.
 */
export async function buscarPacientes(termo: string): Promise<PacienteEncontrado[]> {
  const ctx = await assertPermission('pacientes.ver');
  const supabase = await createClient();

  const texto = normalizarBusca(termo ?? '');
  const digitos = onlyDigits(termo ?? '');
  const soNumeros = digitos.length >= 3 && texto.replace(/[\d\s]/g, '').length === 0;
  if (!soNumeros && texto.replace(/\s/g, '').length < 2) return [];

  let consulta = supabase
    .from('patients')
    .select('id, full_name, cpf, company_id, job_title, needs_review')
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null);

  if (soNumeros) {
    consulta = consulta.like('cpf', `%${digitos}%`);
  } else {
    for (const palavra of texto.split(' ').filter(Boolean).slice(0, 5)) {
      consulta = consulta.ilike('search_key', `%${palavra}%`);
    }
  }

  const { data } = await consulta
    .order('full_name')
    .limit(30)
    .returns<PacienteEncontrado[]>();
  return data ?? [];
}
