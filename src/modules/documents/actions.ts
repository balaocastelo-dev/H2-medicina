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
import {
  BLOCO_PSICOSSOCIAL,
  BLOCOS_FICHA,
  respondidos,
  sistemasAlterados,
} from '@/modules/clinical/ficha-estrutura';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
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
  medical_consultations: {
    verdict: string | null;
    valid_until: string | null;
    conclusion: string | null;
    antecedentes_profissionais: Record<string, string> | null;
    antecedentes_pessoais: Record<string, string> | null;
    estilo_vida: Record<string, string> | null;
    exame_fisico: Record<string, string> | null;
    psicossocial: Record<string, string> | null;
    alteracoes_exame_fisico: string | null;
  }[];
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

    const consultation = attendance.medical_consultations?.[0];

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
      body = proximoAgendamento
        ? `Comprovante do agendamento do(a) paciente acima para ${formatDate(
            proximoAgendamento.scheduled_at,
          )} as ${formatTime(proximoAgendamento.scheduled_at)}. Recomenda-se chegar com 15 minutos de antecedencia e trazer documento com foto.`
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
      verificationUrl: documentos.url_verificacao ?? null,
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
): Promise<ActionResult<{ emitidos: string[]; falhas: string[] }>> {
  const kinds: { kind: DocumentKind; nome: string }[] = [
    { kind: 'comprovante_comparecimento', nome: 'comprovante de comparecimento' },
    { kind: 'recibo', nome: 'recibo de pagamento' },
    { kind: 'comprovante_agendamento', nome: 'comprovante de agendamento' },
  ];

  const emitidos: string[] = [];
  const falhas: string[] = [];

  for (const { kind, nome } of kinds) {
    const resultado = await generateAttendanceDocument(attendanceId, kind);
    if (resultado.ok) emitidos.push(nome);
    else falhas.push(`${nome} (${resultado.error})`);
  }

  if (emitidos.length === 0) {
    return fail(`Nenhum documento foi emitido. ${falhas.join('; ')}`);
  }

  return ok(
    { emitidos, falhas },
    falhas.length === 0
      ? `${emitidos.length} documentos emitidos: ${emitidos.join(', ')}.`
      : `Emitidos: ${emitidos.join(', ')}. Falhou: ${falhas.join('; ')}.`,
  );
}

/** URL assinada temporaria (documentos clinicos nunca sao publicos). */
export async function getDocumentUrl(documentId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('id, bucket, file_path, patient_id')
      .eq('id', documentId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; bucket: string; file_path: string; patient_id: string | null }>();
    if (!doc?.file_path) return fail('Documento não encontrado.');

    const { data, error } = await supabase.storage
      .from(doc.bucket)
      .createSignedUrl(doc.file_path, 300);
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
