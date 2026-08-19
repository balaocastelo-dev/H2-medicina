'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { isValidCPF } from '@/lib/validators';

/** Um registro ja conferido e corrigido na tela. */
const registroSchema = z.object({
  nome: z.string().trim().min(3, 'Informe o nome'),
  cpf: z.string().trim().nullable().optional(),
  rg: z.string().trim().nullable().optional(),
  nascimento: z.string().trim().nullable().optional(),
  sexo: z.enum(['masculino', 'feminino']).nullable().optional(),
  mae: z.string().trim().nullable().optional(),
  telefone: z.string().trim().nullable().optional(),
  email: z.string().trim().nullable().optional(),
  cep: z.string().trim().nullable().optional(),
  logradouro: z.string().trim().nullable().optional(),
  numero: z.string().trim().nullable().optional(),
  complemento: z.string().trim().nullable().optional(),
  bairro: z.string().trim().nullable().optional(),
  cidade: z.string().trim().nullable().optional(),
  uf: z.string().trim().length(2).nullable().optional(),
  empresa: z.string().trim().nullable().optional(),
  cnpjEmpresa: z.string().trim().nullable().optional(),
  cargo: z.string().trim().nullable().optional(),
  setor: z.string().trim().nullable().optional(),
  matricula: z.string().trim().nullable().optional(),
  hora: z.string().trim().nullable().optional(),
  observacoes: z.string().trim().nullable().optional(),
});

const entradaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  horaPadrao: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
  criarEmpresas: z.boolean().default(true),
  registros: z.array(registroSchema).min(1, 'Nada para agendar'),
});

export interface ResultadoTexto {
  pacientesCriados: number;
  pacientesAtualizados: number;
  agendamentosCriados: number;
  empresasCriadas: number;
  ignorados: { nome: string; motivo: string }[];
}

/**
 * Grava a lista colada, ja conferida na tela.
 *
 * O CPF e a chave de identidade: o mesmo trabalhador volta todo ano e nao
 * pode virar tres prontuarios. Sem CPF, cai para nome + nascimento, que
 * evita o duplicado obvio sem arriscar juntar dois homonimos quaisquer.
 */
export async function aplicarTextoColado(
  entrada: z.input<typeof entradaSchema>,
): Promise<ActionResult<ResultadoTexto>> {
  try {
    const ctx = await assertPermission('agenda.administrar');
    const parsed = entradaSchema.safeParse(entrada);
    if (!parsed.success) {
      return fail(z.prettifyError(parsed.error));
    }
    const { data, horaPadrao, criarEmpresas, registros } = parsed.data;

    const supabase = await createClient();
    const resultado: ResultadoTexto = {
      pacientesCriados: 0,
      pacientesAtualizados: 0,
      agendamentosCriados: 0,
      empresasCriadas: 0,
      ignorados: [],
    };

    // Uma empresa citada vinte vezes na lista e resolvida uma vez so.
    const empresasResolvidas = new Map<string, string | null>();

    for (const reg of registros) {
      try {
        const cpf = reg.cpf ? reg.cpf.replace(/\D/g, '') : null;
        if (cpf && !isValidCPF(cpf)) {
          resultado.ignorados.push({ nome: reg.nome, motivo: 'CPF inválido' });
          continue;
        }

        const companyId = await resolverEmpresa(
          supabase,
          ctx.tenant.id,
          ctx.userId,
          reg.empresa ?? null,
          reg.cnpjEmpresa ?? null,
          criarEmpresas,
          empresasResolvidas,
          resultado,
        );

        const camposPaciente = {
          full_name: reg.nome,
          cpf,
          rg: reg.rg ?? null,
          birth_date: reg.nascimento ?? null,
          gender: reg.sexo ?? undefined,
          mother_name: reg.mae ?? null,
          phone: reg.telefone ?? null,
          email: reg.email ?? null,
          zip_code: reg.cep ?? null,
          street: reg.logradouro ?? null,
          number: reg.numero ?? null,
          complement: reg.complemento ?? null,
          district: reg.bairro ?? null,
          city: reg.cidade ?? null,
          state: reg.uf ? reg.uf.toUpperCase() : null,
          job_title: reg.cargo ?? null,
          department: reg.setor ?? null,
          registration_number: reg.matricula ?? null,
          company_id: companyId,
        };

        let patientId: string | null = null;

        if (cpf) {
          const { data: achado } = await supabase
            .from('patients')
            .select('id')
            .eq('tenant_id', ctx.tenant.id)
            .eq('cpf', cpf)
            .is('deleted_at', null)
            .maybeSingle<{ id: string }>();
          patientId = achado?.id ?? null;
        } else if (reg.nascimento) {
          const { data: achado } = await supabase
            .from('patients')
            .select('id')
            .eq('tenant_id', ctx.tenant.id)
            .eq('full_name', reg.nome)
            .eq('birth_date', reg.nascimento)
            .is('deleted_at', null)
            .maybeSingle<{ id: string }>();
          patientId = achado?.id ?? null;
        }

        if (patientId) {
          // Campo vazio na lista nao apaga o que ja estava no cadastro.
          const somentePreenchidos = Object.fromEntries(
            Object.entries(camposPaciente).filter(([, v]) => v !== null && v !== undefined),
          );
          await supabase
            .from('patients')
            .update({ ...somentePreenchidos, updated_by: ctx.userId })
            .eq('id', patientId)
            .eq('tenant_id', ctx.tenant.id);
          resultado.pacientesAtualizados += 1;
        } else {
          const { data: novo, error } = await supabase
            .from('patients')
            .insert({
              ...camposPaciente,
              tenant_id: ctx.tenant.id,
              origin: 'importacao_excel',
              notes: reg.observacoes ?? null,
              needs_review: !cpf,
              review_reason: cpf ? null : 'Importado sem CPF',
              created_by: ctx.userId,
              updated_by: ctx.userId,
            })
            .select('id')
            .single<{ id: string }>();

          if (error || !novo) {
            resultado.ignorados.push({ nome: reg.nome, motivo: toFriendlyError(error) });
            continue;
          }
          patientId = novo.id;
          resultado.pacientesCriados += 1;
        }

        const hora = /^\d{2}:\d{2}$/.test(reg.hora ?? '') ? reg.hora! : horaPadrao;

        // Ja agendado nesse dia? Nao cria de novo — colar a lista duas vezes
        // e o erro mais facil de cometer.
        const { data: jaTem } = await supabase
          .from('appointments')
          .select('id')
          .eq('tenant_id', ctx.tenant.id)
          .eq('patient_id', patientId)
          .eq('scheduled_date', data)
          .is('deleted_at', null)
          .maybeSingle<{ id: string }>();

        if (jaTem) {
          resultado.ignorados.push({ nome: reg.nome, motivo: 'Já estava agendado neste dia' });
          continue;
        }

        const { error: erroAgenda } = await supabase.from('appointments').insert({
          tenant_id: ctx.tenant.id,
          patient_id: patientId,
          company_id: companyId,
          scheduled_at: new Date(`${data}T${hora}:00-03:00`).toISOString(),
          attendance_kind: 'consulta',
          origin: 'importacao_excel',
          notes: reg.observacoes ?? null,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        });

        if (erroAgenda) {
          resultado.ignorados.push({ nome: reg.nome, motivo: toFriendlyError(erroAgenda) });
          continue;
        }

        resultado.agendamentosCriados += 1;
      } catch (erroLinha) {
        resultado.ignorados.push({ nome: reg.nome, motivo: toFriendlyError(erroLinha) });
      }
    }

    await audit(ctx, {
      action: 'create',
      entity: 'appointments',
      description: `Lista colada para ${data}: ${resultado.agendamentosCriados} agendamento(s)`,
      isAutomatic: false,
      origin: 'texto_colado',
    });

    revalidatePath('/agenda');
    revalidatePath('/agenda/proximo-dia');
    revalidatePath('/pacientes');

    return ok(
      resultado,
      `${resultado.agendamentosCriados} agendamento(s) criado(s), ` +
        `${resultado.pacientesCriados} paciente(s) novo(s).`,
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** Acha a empresa pelo CNPJ, senao pelo nome; cria quando autorizado. */
async function resolverEmpresa(
  supabase: Cliente,
  tenantId: string,
  userId: string,
  nome: string | null,
  cnpj: string | null,
  podeCriar: boolean,
  cache: Map<string, string | null>,
  resultado: ResultadoTexto,
): Promise<string | null> {
  const documento = cnpj ? cnpj.replace(/\D/g, '') : null;
  const chave = documento ?? (nome ? nome.toLowerCase() : '');
  if (!chave) return null;
  if (cache.has(chave)) return cache.get(chave) ?? null;

  let id: string | null = null;

  if (documento) {
    const { data } = await supabase
      .from('companies')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('document', documento)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    id = data?.id ?? null;
  }

  if (!id && nome) {
    const { data } = await supabase
      .from('companies')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('legal_name', nome)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    id = data?.id ?? null;
  }

  if (!id && podeCriar && nome) {
    const { data } = await supabase
      .from('companies')
      .insert({
        tenant_id: tenantId,
        legal_name: nome,
        document: documento,
        created_by: userId,
        updated_by: userId,
      })
      .select('id')
      .maybeSingle<{ id: string }>();
    if (data) {
      id = data.id;
      resultado.empresasCriadas += 1;
    }
  }

  cache.set(chave, id);
  return id;
}
