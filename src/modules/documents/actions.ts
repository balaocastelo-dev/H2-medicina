'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildDocumentPdf } from './pdf';
import { marcaDoTenant } from './brand';
import { formatCPF, formatDate, formatDuration, formatMoney, formatTime } from '@/lib/format';
import { regraDe } from '@/modules/queue/origin-kind';
import { avaliarFichaClinica } from './ficha-clinica';
import { montarComprovanteImpresso } from './comprovante-texto';
import { umDo, type Embutido } from '@/lib/embed';
import type { SessionContext } from '@/lib/auth';
import {
  BLOCO_PSICOSSOCIAL,
  BLOCOS_FICHA,
  respondidos,
  sistemasAlterados,
} from '@/modules/clinical/ficha-estrutura';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { urlDeVerificacao } from './verificacao';
import { publicEnv } from '@/lib/env';
import { gerarAso } from './aso';
import type { DocumentKind } from '@/types/entities';


interface AttendanceForDocument {
  id: string;
  checkin_at: string;
  finished_at: string | null;
  exit_at: string | null;
  patient_id: string;
  origin_kind: string;
  procedure_code: string | null;
  patients: { full_name: string; cpf: string | null; birth_date: string | null } | null;
  companies: { trade_name: string | null; legal_name: string; emite_ficha_clinica: boolean } | null;
  patient_exams: { status: string; exam_types: { name: string } | null }[];
  // Uma por atendimento: o PostgREST entrega como objeto, nao como lista.
  medical_consultations: Embutido<{
    verdict: string | null;
    valid_until: string | null;
    conclusion: string | null;
    antecedentes_profissionais: Record<string, string> | null;
    antecedentes_pessoais: Record<string, string> | null;
    estilo_vida: Record<string, string> | null;
    exame_fisico: Record<string, string> | null;
    psicossocial: Record<string, string> | null;
    alteracoes_exame_fisico: string | null;
  }>;
}

interface PagamentoDoAtendimento {
  id: string;
  description: string | null;
  net_amount: number;
  method: string;
  status: string;
  paid_at: string | null;
}

/**
 * Gera um documento PDF do atendimento, salva no storage privado e
 * registra na tabela documents com auditoria completa.
 */
export async function generateAttendanceDocument(
  attendanceId: string,
  kind: DocumentKind,
): Promise<ActionResult<{ documentId: string; path: string }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const { data: attendance } = await supabase
      .from('attendances')
      .select(
        'id, checkin_at, finished_at, exit_at, patient_id, origin_kind, procedure_code, patients(full_name, cpf, birth_date), companies(trade_name, legal_name, emite_ficha_clinica), patient_exams(status, exam_types(name)), medical_consultations(verdict, valid_until, conclusion, antecedentes_profissionais, antecedentes_pessoais, estilo_vida, exame_fisico, psicossocial, alteracoes_exame_fisico)',
      )
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<AttendanceForDocument>();

    if (!attendance || !attendance.patients) return fail('Atendimento não encontrado.');

    // "emitir ficha clinica exceto para pericia, acl, sisper e empresa agape"
    if (kind === 'ficha_clinica') {
      let procedimentoEmiteFicha: boolean | null = null;
      if (attendance.procedure_code) {
        const { data: procedimento } = await supabase
          .from('procedure_types')
          .select('emite_ficha_clinica')
          .eq('tenant_id', ctx.tenant.id)
          .eq('code', attendance.procedure_code)
          .maybeSingle<{ emite_ficha_clinica: boolean }>();
        procedimentoEmiteFicha = procedimento?.emite_ficha_clinica ?? null;
      }

      const regra = avaliarFichaClinica({
        origin_kind: attendance.origin_kind,
        procedimentoEmiteFicha,
        empresaEmiteFicha: attendance.companies?.emite_ficha_clinica ?? null,
      });
      if (!regra.emite) return fail(regra.motivo ?? 'Este atendimento não gera ficha clínica.');
    }

    const responsavel = (ctx.settings.responsavel_tecnico ?? {}) as Record<string, string | null>;
    const documentos = (ctx.settings.documentos ?? {}) as Record<string, string | null>;
    const patient = attendance.patients;
    const exit = attendance.exit_at ?? attendance.finished_at ?? new Date().toISOString();
    const durationSeconds =
      (new Date(exit).getTime() - new Date(attendance.checkin_at).getTime()) / 1000;

    const verificationCode =
      documentos.codigo_verificacao_ativo === null || documentos.codigo_verificacao_ativo
        ? randomBytes(5).toString('hex').toUpperCase()
        : null;

    const titles: Record<string, string> = {
      atestado_comparecimento: 'Atestado de comparecimento',
      comprovante_comparecimento: 'Comprovante de comparecimento',
      resumo_atendimento: 'Resumo do atendimento',
      relacao_exames: 'Relacao de exames',
      ficha_clinica: 'Ficha clínica',
      documento_final: 'Documento final consolidado',
      recibo: 'Recibo de pagamento',
      comprovante_agendamento: 'Comprovante de agendamento',
    };

    const identification = {
      title: 'Identificacao',
      lines: [
        { label: 'Paciente', value: patient.full_name },
        { label: 'CPF', value: patient.cpf ? formatCPF(patient.cpf) : 'não informado' },
        { label: 'Nascimento', value: formatDate(patient.birth_date) },
        {
          label: 'Empresa',
          value:
            attendance.companies?.trade_name ?? attendance.companies?.legal_name ?? 'não informada',
        },
        {
          label: 'Procedência',
          value: `${regraDe(attendance.origin_kind).letter} — ${regraDe(attendance.origin_kind).label}`,
        },
      ],
    };

    const attendanceSection = {
      title: 'Atendimento',
      lines: [
        { label: 'Data', value: formatDate(attendance.checkin_at) },
        { label: 'Entrada', value: formatTime(attendance.checkin_at) },
        { label: 'Saida', value: formatTime(exit) },
        { label: 'Permanencia', value: formatDuration(durationSeconds) },
      ],
    };

    const sections = [identification, attendanceSection];

    if (kind === 'relacao_exames' || kind === 'resumo_atendimento' || kind === 'documento_final') {
      sections.push({
        title: 'Exames',
        lines:
          attendance.patient_exams.length > 0
            ? attendance.patient_exams.map((e) => ({
                label: e.exam_types?.name ?? 'Exame',
                value: e.status,
              }))
            : [{ label: 'Exames', value: 'nenhum exame registrado' }],
      });
    }

    // Recibo: o que foi cobrado e como foi pago.
    if (kind === 'recibo') {
      const { data: pagamentos } = await supabase
        .from('payments')
        .select('id, description, net_amount, method, status, paid_at')
        .eq('tenant_id', ctx.tenant.id)
        .eq('attendance_id', attendanceId)
        .is('deleted_at', null)
        .order('created_at')
        .returns<PagamentoDoAtendimento[]>();

      const pagos = (pagamentos ?? []).filter((p) => p.status === 'pago');
      const total = pagos.reduce((soma, p) => soma + Number(p.net_amount), 0);

      sections.push({
        title: 'Pagamento',
        lines:
          pagos.length > 0
            ? [
                ...pagos.map((p) => ({
                  label: p.description ?? 'Atendimento',
                  value: `${formatMoney(Number(p.net_amount))} — ${p.method}${
                    p.paid_at ? ` em ${formatDate(p.paid_at)}` : ''
                  }`,
                })),
                { label: 'Total pago', value: formatMoney(total) },
              ]
            : [{ label: 'Situação', value: 'sem pagamento registrado neste atendimento' }],
      });
    }

    // Comprovante de agendamento: o proximo compromisso do paciente.
    let proximoAgendamento: { scheduled_at: string; attendance_kind: string } | null = null;
    if (kind === 'comprovante_agendamento') {
      const { data: proximo } = await supabase
        .from('appointments')
        .select('scheduled_at, attendance_kind')
        .eq('tenant_id', ctx.tenant.id)
        .eq('patient_id', attendance.patient_id)
        .is('deleted_at', null)
        .not('status', 'in', '("cancelado","remarcado")')
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at')
        .limit(1)
        .maybeSingle<{ scheduled_at: string; attendance_kind: string }>();

      proximoAgendamento = proximo ?? null;

      sections.push({
        title: 'Próximo agendamento',
        lines: proximo
          ? [
              { label: 'Data', value: formatDate(proximo.scheduled_at) },
              { label: 'Horário', value: formatTime(proximo.scheduled_at) },
              { label: 'Tipo', value: proximo.attendance_kind },
            ]
          : [{ label: 'Situação', value: 'nenhum agendamento futuro registrado' }],
      });
    }

    const consultation = umDo(attendance.medical_consultations);

    // Ficha clinica: o que o medico marcou na consulta.
    // "opc de imprimir a ficha com os dados que o medico preencheu"
    if (kind === 'ficha_clinica' && consultation) {
      for (const bloco of [...BLOCOS_FICHA, BLOCO_PSICOSSOCIAL]) {
        const respostas = respondidos(
          bloco,
          consultation[bloco.chave] as Record<string, string> | null,
        );
        if (respostas.length === 0) continue;
        sections.push({
          title: bloco.titulo,
          lines: respostas.map((r) => ({ label: r.rotulo, value: r.valor })),
        });
      }

      const alterados = sistemasAlterados(
        consultation.exame_fisico as Record<string, string> | null,
      );
      if (alterados.length > 0 || consultation.alteracoes_exame_fisico) {
        sections.push({
          title: 'Alterações do exame físico',
          lines: [
            { label: 'Sistemas alterados', value: alterados.join(', ') || 'nenhum' },
            { label: 'Descrição', value: consultation.alteracoes_exame_fisico ?? '—' },
          ],
        });
      }
    }

    if (consultation && (kind === 'documento_final' || kind === 'resumo_atendimento')) {
      sections.push({
        title: 'Conclusão médica',
        lines: [
          { label: 'Aptidao', value: consultation.verdict ?? 'não informada' },
          { label: 'Validade', value: formatDate(consultation.valid_until) },
          { label: 'Conclusao', value: consultation.conclusion ?? '—' },
        ],
      });
    }

    let body: string | undefined;
    if (kind === 'atestado_comparecimento' || kind === 'comprovante_comparecimento') {
      body = `Atesto para os devidos fins que o(a) paciente acima compareceu a esta unidade em ${formatDate(
        attendance.checkin_at,
      )}, permanecendo das ${formatTime(attendance.checkin_at)} as ${formatTime(exit)} (${formatDuration(
        durationSeconds,
      )}), para realizacao de avaliacao ocupacional.`;
    } else if (kind === 'recibo') {
      body =
        'Recibo referente aos serviços prestados no atendimento acima identificado. Documento emitido eletronicamente, dispensando assinatura de próprio punho.';
    } else if (kind === 'comprovante_agendamento') {
      // Mesmo texto que a recepcao ja mandava a mao pelo WhatsApp, agora
      // preenchido sozinho. Sem emoji: a fonte do PDF nao os tem.
      body = proximoAgendamento
        ? montarComprovanteImpresso({
            paciente: attendance.patients?.full_name ?? '',
            data: emDiaDaClinica(proximoAgendamento.scheduled_at),
            hora: formatTime(proximoAgendamento.scheduled_at),
            tipoAtendimento: proximoAgendamento.attendance_kind ?? null,
            clinica: dadosDaClinica(ctx),
          })
        : 'Nenhum agendamento futuro registrado para este paciente no momento da emissao.';
    }

    const signatureName = responsavel.nome ?? null;
    const signatureRole = [responsavel.conselho, responsavel.numero, responsavel.uf]
      .filter(Boolean)
      .join(' ');

    const pdfBytes = await buildDocumentPdf({
      brand: await marcaDoTenant(ctx),
      title: titles[kind] ?? 'Documento',
      subtitle: `Emitido em ${formatDate(new Date())} por ${ctx.profile.full_name}`,
      sections,
      body,
      signatureName,
      signatureRole: signatureRole || null,
      verificationCode,
      verificationUrl: urlDeVerificacao(documentos.url_verificacao, publicEnv.NEXT_PUBLIC_APP_URL),
    });

    const path = `${ctx.tenant.id}/atendimentos/${attendanceId}/${kind}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clinical-documents')
      .upload(path, new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (uploadError) return fail(`Falha ao salvar o arquivo: ${uploadError.message}`);

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenant.id,
        kind,
        title: titles[kind] ?? 'Documento',
        patient_id: attendance.patient_id,
        attendance_id: attendanceId,
        bucket: 'clinical-documents',
        file_path: path,
        size_bytes: pdfBytes.byteLength,
        verification_code: verificationCode,
        is_patient_visible: true,
        generated_by: ctx.userId,
      })
      .select('id')
      .single<{ id: string }>();
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'create',
      entity: 'documents',
      entityId: doc.id,
      patientId: attendance.patient_id,
      description: `Documento gerado: ${titles[kind] ?? kind}`,
    });

    revalidatePath('/documentos');
    return ok({ documentId: doc.id, path }, 'Documento gerado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Kit de saida: os tres documentos que todo paciente leva embora.
 *
 * A regra veio da clinica e vale para as quatro procedencias — particular,
 * Estado, SISPER e ingresso. Antes, quem lembrava emitia; quem esquecia
 * gerava ligacao no dia seguinte.
 *
 * Um documento que falha nao impede os outros: e melhor entregar dois e
 * avisar do terceiro do que segurar o paciente na recepcao.
 */
export async function emitirDocumentosDeSaida(
  attendanceId: string,
): Promise<ActionResult<{ emitidos: string[]; falhas: string[]; jaExistiam: string[] }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const { data: at } = await supabase
      .from('attendances')
      .select('id, origin_kind, medical_consultations(verdict)')
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        origin_kind: string | null;
        medical_consultations: Embutido<{ verdict: string | null }>;
      }>();

    if (!at) return fail('Atendimento não encontrado.');

    const ehParticular = (at.origin_kind ?? 'particular') === 'particular';
    const temParecer = Boolean(umDo(at.medical_consultations)?.verdict);

    const kinds: { kind: DocumentKind; nome: string }[] = [
      { kind: 'comprovante_comparecimento', nome: 'comprovante de comparecimento' },
      { kind: 'recibo', nome: 'recibo de pagamento' },
      { kind: 'comprovante_agendamento', nome: 'comprovante de agendamento' },
      // "essa ficha clinica deve sair pra cada paciente com as informacoes
      //  preenchidas" -- Isabella, 15/09.
      { kind: 'ficha_clinica', nome: 'ficha clínica' },
    ];

    const emitidos: string[] = [];
    const falhas: string[] = [];

    for (const { kind, nome } of kinds) {
      const resultado = await generateAttendanceDocument(attendanceId, kind);
      if (resultado.ok) emitidos.push(nome);
      else falhas.push(`${nome} (${resultado.error})`);
    }

    // -----------------------------------------------------------------
    // A.S.O. -- so para particular, e so depois do parecer do medico.
    //
    // "sempre na parte de recepcao tem um paciente de entrada como
    //  particular obrigatoriamente deve gerar o aso" e "lembrando que o aso
    //  aparece apenas para clientes particulares" -- Isabella, 15/09.
    //
    // Sem parecer o A.S.O. nao pode existir: ele atesta aptidao, e quem
    // atesta e o medico. Antes isso falhava calado e a clinica so descobria
    // que o documento nao saiu. Agora o kit diz o porque.
    // -----------------------------------------------------------------
    if (ehParticular) {
      if (!temParecer) {
        falhas.push('A.S.O. (a consulta ainda não tem o parecer de aptidão preenchido)');
      } else {
        const aso = await gerarAso(ctx, attendanceId);
        if (aso.ok) emitidos.push('A.S.O.');
        else falhas.push(`A.S.O. (${aso.error})`);
      }
    }

    // -----------------------------------------------------------------
    // O que ja estava pronto tambem faz parte do kit.
    //
    // "conferir que todos os exames feitos estao aparecendo os documentos
    //  no kit de saida" -- o laudo de audiometria sai quando o exame e
    //  concluido, e a guia sai no balcao. Nao se emite de novo; se lista,
    //  senao a recepcao acha que sumiram.
    // -----------------------------------------------------------------
    const { data: existentes } = await supabase
      .from('documents')
      .select('title, kind')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .in('kind', ['resultado_exame', 'guia_exame', 'aso'])
      .is('deleted_at', null)
      .returns<{ title: string; kind: string }[]>();

    const jaExistiam = (existentes ?? [])
      .filter((d) => d.kind !== 'aso' || !emitidos.includes('A.S.O.'))
      .map((d) => d.title);

    if (emitidos.length === 0) {
      return fail(`Nenhum documento foi emitido. ${falhas.join('; ')}`);
    }

    const total = emitidos.length + jaExistiam.length;
    const base =
      jaExistiam.length > 0
        ? `${total} documentos no kit (${jaExistiam.length} já estavam prontos).`
        : `${emitidos.length} documentos emitidos.`;

    return ok(
      { emitidos, falhas, jaExistiam },
      falhas.length === 0 ? base : `${base} Não saiu: ${falhas.join('; ')}.`,
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * URL assinada temporaria (documentos clinicos nunca sao publicos).
 *
 * `formato` existe por causa do A.S.O., que e gravado em PDF e tambem em
 * Word. O PDF e o documento emitido; o .docx e a copia que a clinica edita
 * antes de imprimir.
 */
export async function getDocumentUrl(
  documentId: string,
  formato: 'pdf' | 'docx' = 'pdf',
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('id, bucket, file_path, patient_id, payload')
      .eq('id', documentId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        bucket: string;
        file_path: string;
        patient_id: string | null;
        payload: Record<string, unknown> | null;
      }>();
    if (!doc?.file_path) return fail('Documento não encontrado.');

    const caminhoDocx =
      typeof doc.payload?.docx_path === 'string' ? doc.payload.docx_path : null;
    if (formato === 'docx' && !caminhoDocx) {
      return fail('Este documento não tem versão em Word.');
    }

    const { data, error } = await supabase.storage
      .from(doc.bucket)
      .createSignedUrl(formato === 'docx' ? caminhoDocx! : doc.file_path, 300);
    if (error || !data) return fail('Não foi possível gerar o link.');

    await supabase.from('document_views').insert({
      tenant_id: ctx.tenant.id,
      document_id: documentId,
      viewed_by: ctx.userId,
      viewer_kind: 'usuario',
    });

    return ok({ url: data.signedUrl });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Dados da clinica usados no comprovante, vindos das configuracoes. */
function dadosDaClinica(ctx: SessionContext) {
  const contato = (ctx.settings.contato ?? {}) as Record<string, string | null>;
  const empresa = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
  return {
    nome: empresa.nome_fantasia ?? ctx.branding.system_name,
    logradouro: contato.logradouro,
    numero: contato.numero,
    bairro: contato.bairro,
    cidade: contato.cidade,
    // A tela de Configuracoes grava `estado`; todos os outros documentos leem
    // `estado`. So aqui estava escrito `uf`, e o comprovante saia sem o estado.
    // O `uf` fica como reserva para instalacao antiga que gravou assim.
    uf: contato.estado ?? contato.uf,
    cep: contato.cep,
    referencia: contato.referencia,
    whatsapp: contato.whatsapp,
    telefone: contato.telefone_fixo ?? contato.telefone,
  };
}

/** Instante em UTC para o dia AAAA-MM-DD no fuso da clinica. */
function emDiaDaClinica(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}