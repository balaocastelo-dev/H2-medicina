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
  // Fora do `try` para o `catch` alcancar: e la que a importacao
  // interrompida e marcada como falha, com o que entrou antes.
  const resultado: ResultadoImportacao = {
    pacientesCriados: 0,
    pacientesAtualizados: 0,
    agendamentosCriados: 0,
    ignorados: [],
  };
  let registroImportacao: { id: string } | null = null;

  try {
    if (!isOriginKind(input.originKind)) return fail('Procedência inválida.');
    const ctx = await assertPermission('importacoes.aprovar');
    const supabase = await createClient();

    const validas = input.linhas.filter((l) => l.erros.length === 0 && l.agendadoEm);
    if (validas.length === 0) return fail('Nenhuma linha válida para importar.');

    // Teto por importacao.
    //
    // Cada linha faz de 2 a 4 idas ao banco, em serie. Uma planilha de 400
    // funcionarios passa do tempo que a funcao tem para rodar, e o estouro e
    // o pior tipo: a tela devolve erro generico com METADE dos pacientes ja
    // criados, e o registro da importacao fica preso em "processando".
    // Reimportar depois duplica.
    //
    // Recusar antes de comecar e honesto; parar no meio nao e.
    const TETO_POR_IMPORTACAO = 250;
    if (validas.length > TETO_POR_IMPORTACAO) {
      return fail(
        `Esta planilha tem ${validas.length} linhas válidas, e o limite por importação é ${TETO_POR_IMPORTACAO}. ` +
          'Divida o arquivo em partes e importe uma por vez — assim nenhuma importação fica pela metade.',
      );
    }

    const originKind = input.originKind as OriginKind;

    const { data: criado } = await supabase
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
    registroImportacao = criado ?? null;

    // -------------------------------------------------------------------
    // Quem ja existe, numa consulta so.
    //
    // Antes era uma consulta de deduplicacao POR LINHA — 250 idas ao banco
    // em serie so para descobrir quem ja estava cadastrado, antes de
    // escrever qualquer coisa. Com uma planilha de empresa isso dominava o
    // tempo da importacao.
    //
    // Duas buscas resolvem a planilha inteira: uma pelos CPFs, outra pelos
    // nomes de quem veio sem CPF. A regra de casamento continua a mesma —
    // CPF e a chave confiavel; sem ele, nome + nascimento evita o duplicado
    // obvio sem arriscar juntar dois homonimos quaisquer.
    // -------------------------------------------------------------------
    const cpfs = [...new Set(validas.map((l) => l.cpf).filter((c): c is string => !!c))];
    const semCpf = validas.filter((l) => !l.cpf && l.nascimento);

    const [porCpfRes, porNomeRes] = await Promise.all([
      cpfs.length > 0
        ? supabase
            .from('patients')
            .select('id, cpf')
            .eq('tenant_id', ctx.tenant.id)
            .in('cpf', cpfs)
            .is('deleted_at', null)
            .returns<{ id: string; cpf: string | null }[]>()
        : Promise.resolve({ data: [] as { id: string; cpf: string | null }[] }),
      semCpf.length > 0
        ? supabase
            .from('patients')
            .select('id, full_name, birth_date')
            .eq('tenant_id', ctx.tenant.id)
            .in('full_name', [...new Set(semCpf.map((l) => l.nome))])
            .is('deleted_at', null)
            .returns<{ id: string; full_name: string; birth_date: string | null }[]>()
        : Promise.resolve({
            data: [] as { id: string; full_name: string; birth_date: string | null }[],
          }),
    ]);

    const idPorCpf = new Map<string, string>();
    for (const p of porCpfRes.data ?? []) {
      if (p.cpf) idPorCpf.set(p.cpf, p.id);
    }
    // A chave do segundo mapa junta nome e nascimento: nome igual com
    // nascimento diferente e outra pessoa, e nao pode casar.
    const idPorNomeNascimento = new Map<string, string>();
    for (const p of porNomeRes.data ?? []) {
      if (p.birth_date) idPorNomeNascimento.set(`${p.full_name}|${p.birth_date}`, p.id);
    }

    for (const linha of validas) {
      try {
        let patientId: string | null = linha.cpf
          ? (idPorCpf.get(linha.cpf) ?? null)
          : linha.nascimento
            ? (idPorNomeNascimento.get(`${linha.nome}|${linha.nascimento}`) ?? null)
            : null;

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
    // A importacao nunca fica presa em "processando".
    //
    // Se algo estourar no meio, o registro ficava nesse estado para sempre —
    // a tela de importacoes mostrava um processo rodando que ja tinha morrido,
    // e ninguem sabia se podia reimportar. Marcar como falha, com o motivo,
    // e o minimo: a clinica ve o que aconteceu e quanto entrou antes.
    try {
      if (registroImportacao) {
        const supabase = await createClient();
        await supabase
          .from('file_imports')
          .update({
            status: 'falhou',
            rows_ok: resultado.agendamentosCriados,
            rows_error: resultado.ignorados.length,
            errors: [
              ...resultado.ignorados,
              { linha: 0, nome: '(importação interrompida)', motivo: toFriendlyError(error) },
            ],
          })
          .eq('id', registroImportacao.id);
      }
    } catch {
      // Falha ao registrar a falha nao pode esconder a falha original.
    }
    return fail(toFriendlyError(error));
  }
}
