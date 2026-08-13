'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { isOriginKind, type OriginKind } from '@/modules/queue/origin-kind';
import { ROTULO_ORIGEM, type LinhaNormalizada } from './planilha';

export interface ResultadoImportacao {
  pacientesCriados: number;
  pacientesAtualizados: number;
  agendamentosCriados: number;
  ignorados: { linha: number; nome: string; motivo: string }[];
}

/**
 * Grava a planilha ja conferida: cria pacientes e agendamentos.
 *
 * A conferencia acontece antes, na tela. Aqui a unica decisao que resta e
 * o que fazer com quem ja existe — e a resposta e atualizar, nunca duplicar:
 * o mesmo servidor volta todo ano e nao pode virar tres prontuarios.
 */
export async function aplicarImportacaoPlanilha(input: {
  originKind: string;
  companyId?: string | null;
  fileName: string;
  linhas: LinhaNormalizada[];
  examTypeIds?: string[];
}): Promise<ActionResult<ResultadoImportacao>> {
  try {
    if (!isOriginKind(input.originKind)) return fail('Procedência inválida.');
    const ctx = await assertPermission('importacoes.aprovar');
    const supabase = await createClient();

    const validas = input.linhas.filter((l) => l.erros.length === 0 && l.agendadoEm);
    if (validas.length === 0) return fail('Nenhuma linha válida para importar.');

    const originKind = input.originKind as OriginKind;
    const resultado: ResultadoImportacao = {
      pacientesCriados: 0,
      pacientesAtualizados: 0,
      agendamentosCriados: 0,
      ignorados: [],
    };

    const { data: registroImportacao } = await supabase
      .from('file_imports')
      .insert({
        tenant_id: ctx.tenant.id,
        file_name: input.fileName,
        file_path: `${ctx.tenant.id}/planilhas/${Date.now()}-${input.fileName}`,
        kind: 'agenda',
        origin_kind: originKind,
        company_id: input.companyId ?? null,
        rows_total: input.linhas.length,
        status: 'processando',
        uploaded_by: ctx.userId,
      })
      .select('id')
      .maybeSingle<{ id: string }>();

    for (const linha of validas) {
      try {
        let patientId: string | null = null;

        // CPF e a chave confiavel. Sem ele, nome + nascimento evita o
        // duplicado obvio sem arriscar juntar dois homonimos quaisquer.
        if (linha.cpf) {
          const { data } = await supabase
            .from('patients')
            .select('id')
            .eq('tenant_id', ctx.tenant.id)
            .eq('cpf', linha.cpf)
            .is('deleted_at', null)
            .maybeSingle<{ id: string }>();
          patientId = data?.id ?? null;
        } else if (linha.nascimento) {
          const { data } = await supabase
            .from('patients')
            .select('id')
            .eq('tenant_id', ctx.tenant.id)
            .eq('full_name', linha.nome)
            .eq('birth_date', linha.nascimento)
            .is('deleted_at', null)
            .maybeSingle<{ id: string }>();
          patientId = data?.id ?? null;
        }

        if (patientId) {
          await supabase
            .from('patients')
            .update({
              default_origin_kind: originKind,
              job_title: linha.cargo ?? undefined,
              department: linha.setor ?? undefined,
              registration_number: linha.matricula ?? undefined,
              phone: linha.telefone ?? undefined,
              company_id: input.companyId ?? undefined,
              updated_by: ctx.userId,
            })
            .eq('id', patientId)
            .eq('tenant_id', ctx.tenant.id);
          resultado.pacientesAtualizados += 1;
        } else {
          const { data: novo, error } = await supabase
            .from('patients')
            .insert({
              tenant_id: ctx.tenant.id,
              full_name: linha.nome,
              cpf: linha.cpf,
              birth_date: linha.nascimento,
              phone: linha.telefone,
              job_title: linha.cargo,
              department: linha.setor,
              registration_number: linha.matricula,
              company_id: input.companyId ?? null,
              default_origin_kind: originKind,
              origin: 'importacao_excel',
              notes: linha.observacoes,
              created_by: ctx.userId,
              updated_by: ctx.userId,
            })
            .select('id')
            .single<{ id: string }>();

          if (error || !novo) {
            resultado.ignorados.push({
              linha: linha.linha,
              nome: linha.nome,
              motivo: toFriendlyError(error),
            });
            continue;
          }
          patientId = novo.id;
          resultado.pacientesCriados += 1;
        }

        const { data: agendamento, error: erroAgenda } = await supabase
          .from('appointments')
          .insert({
            tenant_id: ctx.tenant.id,
            patient_id: patientId,
            company_id: input.companyId ?? null,
            scheduled_at: new Date(linha.agendadoEm as string).toISOString(),
            attendance_kind: originKind === 'ingresso' ? 'admissional' : 'consulta',
            origin_kind: originKind,
            origin: 'importacao_excel',
            notes: [linha.observacoes, linha.empresa ? `Órgão: ${linha.empresa}` : null]
              .filter(Boolean)
              .join(' · ') || null,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .select('id')
          .single<{ id: string }>();

        if (erroAgenda || !agendamento) {
          resultado.ignorados.push({
            linha: linha.linha,
            nome: linha.nome,
            motivo: toFriendlyError(erroAgenda),
          });
          continue;
        }

        if (input.examTypeIds?.length) {
          await supabase.from('appointment_exams').insert(
            input.examTypeIds.map((examId) => ({
              tenant_id: ctx.tenant.id,
              appointment_id: agendamento.id,
              exam_type_id: examId,
              origin: 'importacao_excel' as const,
            })),
          );
        }

        resultado.agendamentosCriados += 1;
      } catch (erroLinha) {
        resultado.ignorados.push({
          linha: linha.linha,
          nome: linha.nome,
          motivo: toFriendlyError(erroLinha),
        });
      }
    }

    if (registroImportacao) {
      await supabase
        .from('file_imports')
        .update({
          rows_ok: resultado.agendamentosCriados,
          rows_error: resultado.ignorados.length,
          status: 'concluida',
          errors: resultado.ignorados,
          applied_at: new Date().toISOString(),
          applied_by: ctx.userId,
        })
        .eq('id', registroImportacao.id);
    }

    await audit(ctx, {
      action: 'create',
      entity: 'file_imports',
      entityId: registroImportacao?.id,
      description: `Importação ${ROTULO_ORIGEM[originKind]}: ${resultado.agendamentosCriados} agendamento(s) de ${input.fileName}`,
    });

    revalidatePath('/agenda');
    revalidatePath('/pacientes');
    revalidatePath('/importacao/planilhas');

    return ok(
      resultado,
      `${resultado.agendamentosCriados} agendamento(s) criado(s) — ${resultado.pacientesCriados} paciente(s) novo(s), ${resultado.pacientesAtualizados} atualizado(s)` +
        (resultado.ignorados.length > 0
          ? `. ${resultado.ignorados.length} linha(s) não importada(s).`
          : '.'),
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
