'use server';

import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission, type SessionContext } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildDocumentPdf, type PdfBrand } from './pdf';
import { paragrafosDoTermo } from './authorization';
import { formatCPF } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

const TITULO = 'Autorização para entrega de prontuário à empresa';
const FINALIDADE = 'autorizacao_envio_resultados';

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

  return {
    systemName: ctx.branding.system_name,
    legalName: empresa.razao_social ?? ctx.tenant.legal_name,
    document: empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
    address: address || null,
    contact: [contato.telefone, contato.email].filter(Boolean).join(' · ') || null,
    headerText: documentos.cabecalho ?? ctx.branding.pdf_header_html,
    footerText: documentos.rodape ?? ctx.branding.footer_text,
    primaryColor: ctx.branding.color_primary,
  };
}

/**
 * Converte a data URL vinda do quadro de assinatura em bytes.
 *
 * Rejeita qualquer coisa que nao seja PNG e limita o tamanho: o campo
 * chega do navegador e nao ha motivo para um traco passar de 2 MB.
 */
function pngDaAssinatura(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl) return null;
  const prefixo = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefixo)) return null;
  const base64 = dataUrl.slice(prefixo.length);
  if (base64.length > 2_800_000) return null;
  try {
    const bytes = Buffer.from(base64, 'base64');
    return bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

interface AtendimentoDoTermo {
  id: string;
  patient_id: string;
  company_id: string | null;
  origin_kind: string;
  patients: { full_name: string; cpf: string | null; rg: string | null } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
}

/**
 * Emite o termo de autorizacao de envio de resultados a empresa.
 *
 * Dois caminhos no mesmo documento:
 *  - `tela`: o paciente assina no quadro e o PDF ja sai assinado;
 *  - `papel`: sai com a linha em branco para assinar e digitalizar depois.
 */
export async function emitirTermoAutorizacao(input: {
  attendanceId: string;
  method: 'tela' | 'papel';
  signerName?: string;
  signerRg?: string;
  signerCpf?: string;
  signatureDataUrl?: string | null;
}): Promise<ActionResult<{ documentId: string; signatureId: string | null }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const { data: atendimento } = await supabase
      .from('attendances')
      .select(
        'id, patient_id, company_id, origin_kind, patients(full_name, cpf, rg), companies(trade_name, legal_name)',
      )
      .eq('id', input.attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<AtendimentoDoTermo>();

    if (!atendimento?.patients) return fail('Atendimento não encontrado.');

    const paciente = atendimento.patients;
    const nomeAssinante = (input.signerName ?? paciente.full_name).trim();
    if (!nomeAssinante) return fail('Informe o nome de quem assina.');

    const assinatura = pngDaAssinatura(input.signatureDataUrl);
    if (input.method === 'tela' && !assinatura) {
      return fail('A assinatura não foi capturada. Peça para assinar no quadro novamente.');
    }

    const empresa = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
    const contato = (ctx.settings.contato ?? {}) as Record<string, string | null>;
    const responsavel = (ctx.settings.responsavel_tecnico ?? {}) as Record<string, string | null>;
    const documentos = (ctx.settings.documentos ?? {}) as Record<string, string | null>;

    const paragraphs = paragrafosDoTermo({
      pacienteNome: nomeAssinante,
      pacienteRg: input.signerRg?.trim() || paciente.rg,
      pacienteCpf: input.signerCpf?.trim() || paciente.cpf,
      empresaNome:
        atendimento.companies?.trade_name ?? atendimento.companies?.legal_name ?? null,
      coordenadorNome: responsavel.nome ?? null,
      coordenadorConselho:
        [responsavel.conselho, responsavel.numero, responsavel.uf].filter(Boolean).join(' ') ||
        null,
      clinicaRazaoSocial: empresa.razao_social ?? ctx.tenant.legal_name,
      cidade: contato.cidade ?? null,
      data: new Date(),
    });

    const verificationCode = randomBytes(5).toString('hex').toUpperCase();

    const pdfBytes = await buildDocumentPdf({
      brand: brandFrom(ctx),
      title: TITULO,
      subtitle:
        input.method === 'tela'
          ? 'Assinado eletronicamente na recepção'
          : 'Via para assinatura em papel',
      sections: [],
      paragraphs,
      signatureBlocks: [
        {
          caption: 'Assinatura do funcionário autorizado',
          imagePng: assinatura,
          name: nomeAssinante,
          lines: [
            `Documento de identidade nº ${input.signerRg?.trim() || paciente.rg || '________________'}`,
            `CPF nº ${
              input.signerCpf?.trim() ||
              (paciente.cpf ? formatCPF(paciente.cpf) : '________________')
            }`,
          ],
        },
        {
          caption: `Assinatura e carimbo do funcionário da ${empresa.razao_social ?? ctx.tenant.legal_name}`,
          name: null,
          lines: [],
        },
      ],
      verificationCode,
      verificationUrl: documentos.url_verificacao ?? null,
    });

    const carimbo = Date.now();
    const basePath = `${ctx.tenant.id}/atendimentos/${input.attendanceId}`;
    const pdfPath = `${basePath}/autorizacao-envio-resultados-${carimbo}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('clinical-documents')
      .upload(pdfPath, new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (uploadError) return fail(`Falha ao salvar o termo: ${uploadError.message}`);

    // O traco fica guardado separado do PDF. Se amanha alguem contestar a
    // assinatura, a imagem original vale mais que o desenho embutido.
    let signaturePath: string | null = null;
    if (assinatura) {
      const path = `${basePath}/assinatura-${carimbo}.png`;
      const { error } = await supabase.storage
        .from('clinical-documents')
        .upload(path, new Blob([new Uint8Array(assinatura)], { type: 'image/png' }), {
          contentType: 'image/png',
          upsert: false,
        });
      if (!error) signaturePath = path;
    }

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenant.id,
        kind: FINALIDADE,
        title: TITULO,
        patient_id: atendimento.patient_id,
        attendance_id: input.attendanceId,
        company_id: atendimento.company_id,
        bucket: 'clinical-documents',
        file_path: pdfPath,
        size_bytes: pdfBytes.byteLength,
        verification_code: verificationCode,
        is_patient_visible: true,
        generated_by: ctx.userId,
        payload: { method: input.method, signer_name: nomeAssinante },
      })
      .select('id')
      .single<{ id: string }>();
    if (docError) return fail(toFriendlyError(docError));

    const cabecalhos = await headers();
    const ip = cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

    const { data: assinaturaRegistro } = await supabase
      .from('patient_signatures')
      .insert({
        tenant_id: ctx.tenant.id,
        patient_id: atendimento.patient_id,
        attendance_id: input.attendanceId,
        company_id: atendimento.company_id,
        document_id: doc.id,
        purpose: FINALIDADE,
        method: input.method,
        status: input.method === 'tela' ? 'assinado' : 'pendente',
        signer_name: nomeAssinante,
        signer_rg: input.signerRg?.trim() || paciente.rg,
        signer_cpf: input.signerCpf?.trim() || paciente.cpf,
        signature_path: signaturePath,
        signed_at: input.method === 'tela' ? new Date().toISOString() : null,
        ip_address: ip,
        user_agent: cabecalhos.get('user-agent'),
        created_by: ctx.userId,
      })
      .select('id')
      .maybeSingle<{ id: string }>();

    // O consentimento tambem entra no registro de LGPD do paciente: e la
    // que se procura quando o titular pergunta o que autorizou.
    if (input.method === 'tela') {
      await supabase.from('patient_consents').insert({
        tenant_id: ctx.tenant.id,
        patient_id: atendimento.patient_id,
        purpose: 'compartilhamento_empresa',
        granted: true,
        legal_basis: 'Consentimento do titular — Art. 89 do Código de Ética Médica',
        source: 'recepcao',
        created_by: ctx.userId,
      });
    }

    await audit(ctx, {
      action: 'create',
      entity: 'documents',
      entityId: doc.id,
      patientId: atendimento.patient_id,
      description:
        input.method === 'tela'
          ? 'Termo de autorização assinado na tela'
          : 'Termo de autorização emitido para assinatura em papel',
    });

    revalidatePath('/recepcao');
    revalidatePath('/documentos');
    return ok(
      { documentId: doc.id, signatureId: assinaturaRegistro?.id ?? null },
      input.method === 'tela'
        ? 'Termo assinado e arquivado.'
        : 'Termo gerado para impressão. Depois de assinado, anexe a digitalização.',
    );
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/**
 * Anexa a digitalizacao do termo assinado no papel.
 *
 * Chega como data URL para nao precisar de rota de upload separada — o
 * arquivo e pequeno e a recepcao ja esta autenticada.
 */
export async function anexarTermoAssinado(input: {
  signatureId: string;
  fileDataUrl: string;
  fileName: string;
}): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const separador = input.fileDataUrl.indexOf(';base64,');
    if (!input.fileDataUrl.startsWith('data:') || separador < 0) {
      return fail('Arquivo inválido.');
    }
    const mime = input.fileDataUrl.slice(5, separador);
    const permitidos = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!permitidos.includes(mime)) {
      return fail('Envie um PDF ou uma imagem (PNG, JPG ou WebP).');
    }

    const base64 = input.fileDataUrl.slice(separador + 8);
    if (base64.length > 28_000_000) return fail('Arquivo muito grande (limite de 20 MB).');
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));

    const { data: registro } = await supabase
      .from('patient_signatures')
      .select('id, attendance_id, patient_id')
      .eq('id', input.signatureId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; attendance_id: string | null; patient_id: string }>();
    if (!registro) return fail('Registro de assinatura não encontrado.');

    const extensao = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
    const path = `${ctx.tenant.id}/atendimentos/${registro.attendance_id ?? 'avulso'}/termo-assinado-${Date.now()}.${extensao}`;

    const { error: uploadError } = await supabase.storage
      .from('clinical-documents')
      .upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
    if (uploadError) return fail(`Falha ao enviar o arquivo: ${uploadError.message}`);

    const { error } = await supabase
      .from('patient_signatures')
      .update({
        scan_path: path,
        status: 'assinado',
        signed_at: new Date().toISOString(),
        updated_by: ctx.userId,
      })
      .eq('id', input.signatureId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await supabase.from('patient_consents').insert({
      tenant_id: ctx.tenant.id,
      patient_id: registro.patient_id,
      purpose: 'compartilhamento_empresa',
      granted: true,
      legal_basis: 'Consentimento do titular — termo assinado em papel',
      source: 'recepcao',
      created_by: ctx.userId,
    });

    await audit(ctx, {
      action: 'update',
      entity: 'patient_signatures',
      entityId: input.signatureId,
      patientId: registro.patient_id,
      description: 'Termo assinado em papel anexado',
    });

    revalidatePath('/recepcao');
    revalidatePath('/documentos');
    return ok(undefined, 'Termo assinado anexado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
