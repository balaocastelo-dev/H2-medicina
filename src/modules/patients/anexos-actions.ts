'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { slugify } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

const LIMITE_BYTES = 50 * 1024 * 1024;
const BUCKET = 'attachments';

/**
 * Anexa um laudo ao cadastro do paciente.
 *
 * "alguns exames sao laudados depois de alguns dias, ter a opcao de anexar
 *  exames no cadastro do paciente"
 */
export async function anexarExame(
  patientId: string,
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('pacientes.editar');
    const supabase = await createClient();

    const arquivo = formData.get('arquivo');
    if (!(arquivo instanceof File) || arquivo.size === 0) return fail('Selecione um arquivo.');
    if (arquivo.size > LIMITE_BYTES) return fail('Arquivo maior que 50 MB.');

    const { data: paciente } = await supabase
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>();
    if (!paciente) return fail('Paciente não encontrado.');

    const titulo = String(formData.get('titulo') ?? '').trim() || arquivo.name;
    const examTypeId = (formData.get('exam_type_id') as string) || null;
    const extensao = arquivo.name.includes('.') ? `.${arquivo.name.split('.').pop()}` : '';
    const caminho = `${ctx.tenant.id}/pacientes/${patientId}/${Date.now()}-${slugify(titulo)}${extensao}`;

    const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, {
      contentType: arquivo.type || 'application/octet-stream',
      upsert: false,
    });
    if (erroUpload) return fail(`Falha ao enviar o arquivo: ${erroUpload.message}`);

    const { error } = await supabase.from('patient_attachments').insert({
      tenant_id: ctx.tenant.id,
      patient_id: patientId,
      exam_type_id: examTypeId,
      title: titulo,
      description: String(formData.get('descricao') ?? '').trim() || null,
      kind: 'exame',
      bucket: BUCKET,
      file_path: caminho,
      mime_type: arquivo.type || null,
      size_bytes: arquivo.size,
      uploaded_by: ctx.userId,
    });
    if (error) {
      // Sem o registro, o arquivo ficaria orfao no bucket.
      await supabase.storage.from(BUCKET).remove([caminho]);
      return fail(toFriendlyError(error));
    }

    await audit(ctx, {
      action: 'create',
      entity: 'patient_attachments',
      patientId,
      description: `Laudo "${titulo}" anexado ao paciente`,
    });

    revalidatePath(`/pacientes/${patientId}`);
    return ok(undefined, 'Laudo anexado.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

/** Link temporario: anexo clinico nunca fica publico. */
export async function urlDoAnexo(anexoId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await assertPermission('pacientes.ver');
    const supabase = await createClient();

    const { data: anexo } = await supabase
      .from('patient_attachments')
      .select('id, bucket, file_path')
      .eq('id', anexoId)
      .eq('tenant_id', ctx.tenant.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; bucket: string; file_path: string }>();
    if (!anexo?.file_path) return fail('Anexo não encontrado.');

    const { data, error } = await supabase.storage
      .from(anexo.bucket)
      .createSignedUrl(anexo.file_path, 300);
    if (error || !data) return fail('Não foi possível gerar o link.');

    return ok({ url: data.signedUrl });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

export async function removerAnexo(anexoId: string): Promise<ActionResult> {
  try {
    const ctx = await assertPermission('pacientes.editar');
    const supabase = await createClient();

    const { data: anexo } = await supabase
      .from('patient_attachments')
      .select('id, patient_id, title')
      .eq('id', anexoId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{ id: string; patient_id: string; title: string }>();
    if (!anexo) return fail('Anexo não encontrado.');

    const { error } = await supabase
      .from('patient_attachments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', anexoId)
      .eq('tenant_id', ctx.tenant.id);
    if (error) return fail(toFriendlyError(error));

    await audit(ctx, {
      action: 'delete',
      entity: 'patient_attachments',
      entityId: anexoId,
      patientId: anexo.patient_id,
      description: `Anexo "${anexo.title}" removido`,
    });

    revalidatePath(`/pacientes/${anexo.patient_id}`);
    return ok(undefined, 'Anexo removido.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
