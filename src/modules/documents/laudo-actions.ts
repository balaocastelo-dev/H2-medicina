'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { formatCNPJ, formatCPF, formatDate } from '@/lib/format';
import { idadeNaData } from './riscos';
import { buildLaudoAudiometria } from './laudo-audiometria';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/** Exames que tem laudo proprio. Os demais saem na ficha do atendimento. */
const COM_LAUDO_PROPRIO = new Set(['AUDIO']);

interface ExameParaLaudo {
  id: string;
  status: string;
  finished_at: string | null;
  attendance_id: string;
  exam_types: { code: string; name: string } | null;
  exam_results: { values: Record<string, unknown>; conclusion: string | null }[];
  attendances: {
    id: string;
    checkin_at: string;
    /** Precisa vir gravado no documento, senao o laudo nao aparece em /meu. */
    patient_id: string | null;
    patients: {
      full_name: string;
      social_name: string | null;
      cpf: string | null;
      birth_date: string | null;
      gender: string;
      job_title: string | null;
      department: string | null;
    } | null;
    companies: { legal_name: string; document: string | null } | null;
    appointments: { attendance_kind: string } | null;
  } | null;
}

const TIPO_EXAME: Record<string, string> = {
  admissional: 'Admissional',
  periodico: 'Periódico',
  demissional: 'Demissional',
  mudanca_funcao: 'Mudança de função',
  retorno_trabalho: 'Retorno ao trabalho',
  consulta: 'Consulta',
};

/**
 * Emite o laudo de um exame realizado.
 *
 * Hoje so a audiometria tem laudo proprio, porque e o unico com grafico e
 * dados de aparelho. Os outros exames saem nas fichas do atendimento. A
 * lista `COM_LAUDO_PROPRIO` e o lugar de crescer quando outro exame ganhar
 * o seu.
 *
 * O laudo e sempre gerado do zero a partir do que esta gravado: reemitir
 * depois de corrigir um limiar produz o documento certo, sem editar PDF.
 */
export async function gerarLaudoDeExame(
  patientExamId: string,
): Promise<ActionResult<{ documentId: string }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const { data: exame } = await supabase
      .from('patient_exams')
      .select(
        'id, status, finished_at, attendance_id, exam_types(code, name), exam_results(values, conclusion), attendances(id, checkin_at, patient_id, patients(full_name, social_name, cpf, birth_date, gender, job_title, department), companies(legal_name, document), appointments(attendance_kind))',
      )
      .eq('id', patientExamId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<ExameParaLaudo>();

    if (!exame?.attendances?.patients) return fail('Exame não encontrado.');

    const codigo = exame.exam_types?.code ?? '';
    if (!COM_LAUDO_PROPRIO.has(codigo)) {
      return fail('Este exame ainda não tem laudo próprio. Use a ficha do atendimento.');
    }
    if (exame.status !== 'concluido') {
      return fail('O laudo sai depois que o exame é concluído.');
    }

    const resultado = exame.exam_results?.[0];
    const valores = resultado?.values ?? {};
    const paciente = exame.attendances.patients;
    const empresa = exame.attendances.companies;
    const emitidoEm = exame.finished_at ? new Date(exame.finished_at) : new Date();

    // Quem assina e quem esta emitindo, com a assinatura que registrou.
    const { data: perfil } = await supabase
      .from('profiles')
      .select('full_name, council_type, council_number, council_state, signature_path')
      .eq('id', ctx.userId)
      .maybeSingle<{
        full_name: string;
        council_type: string | null;
        council_number: string | null;
        council_state: string | null;
        signature_path: string | null;
      }>();

    let assinatura: string | null = null;
    if (perfil?.signature_path) {
      try {
        const { data } = await supabase.storage
          .from('signatures')
          .createSignedUrl(perfil.signature_path, 120);
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl);
          if (resp.ok) {
            assinatura = `data:image/png;base64,${Buffer.from(
              await resp.arrayBuffer(),
            ).toString('base64')}`;
          }
        }
      } catch (erro) {
        console.error('[laudo] não consegui carregar a assinatura:', erro);
      }
    }

    const texto = (chave: string) => {
      const v = valores[chave];
      return v === null || v === undefined || v === '' ? null : String(v);
    };

    const contatoCfg = (ctx.settings.contato ?? {}) as Record<string, string | null>;
    const docsCfg = (ctx.settings.documentos ?? {}) as Record<string, string | null>;
    const verificacao = randomBytes(5).toString('hex').toUpperCase();

    const pdf = await buildLaudoAudiometria({
      clinica: {
        nome: ctx.branding.system_name,
        endereco:
          [contatoCfg.logradouro, contatoCfg.numero, contatoCfg.bairro, contatoCfg.cidade]
            .filter(Boolean)
            .join(', ') || null,
        telefone: contatoCfg.telefone ?? null,
        cor: ctx.branding.color_primary,
      },
      emitidoEm,
      paciente: {
        nome: paciente.social_name ?? paciente.full_name,
        cpf: paciente.cpf ? formatCPF(paciente.cpf) : null,
        nascimento: formatDate(paciente.birth_date),
        idade: idadeNaData(paciente.birth_date, emitidoEm),
        sexo: paciente.gender,
        cargo: paciente.job_title ?? null,
        setor: paciente.department ?? null,
      },
      empresa: empresa
        ? {
            razaoSocial: empresa.legal_name,
            cnpj: empresa.document ? formatCNPJ(empresa.document) : null,
          }
        : null,
      tipoExame: TIPO_EXAME[exame.attendances.appointments?.attendance_kind ?? ''] ?? 'Ocupacional',
      aparelho: {
        modelo: texto('aparelho'),
        fabricante: texto('fabricante'),
        calibracao: texto('calibracao'),
        repousoAuditivo: texto('repouso_auditivo'),
      },
      medicoes: valores,
      meatoscopia: { od: texto('meatoscopia_od'), oe: texto('meatoscopia_oe') },
      conclusao: resultado?.conclusion ?? null,
      medico: {
        nome: perfil?.full_name ?? ctx.profile.full_name,
        conselho: perfil?.council_type ?? 'CRM',
        numero: perfil?.council_number ?? null,
        uf: perfil?.council_state ?? null,
      },
      assinaturaMedico: assinatura,
      codigoVerificacao: verificacao,
      rodape: docsCfg.rodape ?? ctx.branding.footer_text ?? null,
    });

    const caminho = `${ctx.tenant.id}/atendimentos/${exame.attendance_id}/laudo-audiometria-${Date.now()}.pdf`;
    const { error: erroUpload } = await supabase.storage
      .from('clinical-documents')
      .upload(caminho, new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (erroUpload) return fail(`Falha ao salvar o laudo: ${erroUpload.message}`);

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenant.id,
        kind: 'resultado_exame',
        title: `Laudo — ${exame.exam_types?.name ?? 'Exame'}`,
        // Sem `patient_id` o laudo some da area do paciente: /meu filtra por ele.
        patient_id: exame.attendances.patient_id,
        attendance_id: exame.attendance_id,
        bucket: 'clinical-documents',
        file_path: caminho,
        size_bytes: pdf.byteLength,
        verification_code: verificacao,
        is_patient_visible: true,
        signed_by: ctx.userId,
        signer_name: perfil?.full_name ?? ctx.profile.full_name,
        signer_council: perfil?.council_number
          ? `${perfil.council_type ?? 'CRM'} ${perfil.council_number}${perfil.council_state ? '/' + perfil.council_state : ''}`
          : null,
        generated_by: ctx.userId,
      })
      .select('id')
      .single<{ id: string }>();
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'create',
      entity: 'documents',
      entityId: doc.id,
      description: `Laudo de ${exame.exam_types?.name ?? 'exame'} emitido`,
    });

    revalidatePath('/documentos');
    revalidatePath('/filas');
    return ok({ documentId: doc.id }, 'Laudo emitido.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
