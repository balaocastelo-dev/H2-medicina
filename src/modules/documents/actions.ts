'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission, type SessionContext } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildDocumentPdf, type PdfBrand } from './pdf';
import { formatCPF, formatDate, formatDuration, formatTime } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import type { DocumentKind } from '@/types/entities';

function brandFrom(ctx: SessionContext): PdfBrand {
  const empresa = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
  const contato = (ctx.settings.contato ?? {}) as Record<string, string | null>;
  const documentos = (ctx.settings.documentos ?? {}) as Record<string, string | null>;

  const address = [
    contato.logradouro,
    contato.numero,
    contato.bairro,
    contato.cidade,
    contato.estado,
  ]
    .filter(Boolean)
    .join(', ');
  const contact = [contato.telefone, contato.email, empresa.site].filter(Boolean).join(' · ');

  return {
    systemName: ctx.branding.system_name,
    legalName: empresa.razao_social ?? ctx.tenant.legal_name,
    document: empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
    address: address || null,
    contact: contact || null,
    headerText: documentos.cabecalho ?? ctx.branding.pdf_header_html,
    footerText: documentos.rodape ?? ctx.branding.footer_text,
    primaryColor: ctx.branding.color_primary,
  };
}

interface AttendanceForDocument {
  id: string;
  checkin_at: string;
  finished_at: string | null;
  exit_at: string | null;
  patient_id: string;
  patients: { full_name: string; cpf: string | null; birth_date: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  patient_exams: { status: string; exam_types: { name: string } | null }[];
  medical_consultations: {
    verdict: string | null;
    valid_until: string | null;
    conclusion: string | null;
  }[];
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
        'id, checkin_at, finished_at, exit_at, patient_id, patients(full_name, cpf, birth_date), companies(trade_name, legal_name), patient_exams(status, exam_types(name)), medical_consultations(verdict, valid_until, conclusion)',
      )
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<AttendanceForDocument>();

    if (!attendance || !attendance.patients) return fail('Atendimento nao encontrado.');

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
      ficha_clinica: 'Ficha clinica',
      documento_final: 'Documento final consolidado',
    };

    const identification = {
      title: 'Identificacao',
      lines: [
        { label: 'Paciente', value: patient.full_name },
        { label: 'CPF', value: patient.cpf ? formatCPF(patient.cpf) : 'nao informado' },
        { label: 'Nascimento', value: formatDate(patient.birth_date) },
        {
          label: 'Empresa',
          value:
            attendance.companies?.trade_name ?? attendance.companies?.legal_name ?? 'nao informada',
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

    const consultation = attendance.medical_consultations?.[0];
    if (consultation && (kind === 'documento_final' || kind === 'resumo_atendimento')) {
      sections.push({
        title: 'Conclusao medica',
        lines: [
          { label: 'Aptidao', value: consultation.verdict ?? 'nao informada' },
          { label: 'Validade', value: formatDate(consultation.valid_until) },
          { label: 'Conclusao', value: consultation.conclusion ?? '—' },
        ],
      });
    }

    const body =
      kind === 'atestado_comparecimento' || kind === 'comprovante_comparecimento'
        ? `Atesto para os devidos fins que o(a) paciente acima compareceu a esta unidade em ${formatDate(
            attendance.checkin_at,
          )}, permanecendo das ${formatTime(attendance.checkin_at)} as ${formatTime(exit)} (${formatDuration(
            durationSeconds,
          )}), para realizacao de avaliacao ocupacional.`
        : undefined;

    const signatureName = responsavel.nome ?? null;
    const signatureRole = [responsavel.conselho, responsavel.numero, responsavel.uf]
      .filter(Boolean)
      .join(' ');

    const pdfBytes = await buildDocumentPdf({
      brand: brandFrom(ctx),
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
    if (!doc?.file_path) return fail('Documento nao encontrado.');

    const { data, error } = await supabase.storage
      .from(doc.bucket)
      .createSignedUrl(doc.file_path, 300);
    if (error || !data) return fail('Nao foi possivel gerar o link.');

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
