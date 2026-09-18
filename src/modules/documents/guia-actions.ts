'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { formatCNPJ, formatCPF, formatDate } from '@/lib/format';
import { buildGuiaDeExame } from './guia-exame';
import { cabecalhoDaClinica } from './cabecalho';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';

/**
 * Emite a guia de exame que o paciente leva ao laboratorio.
 *
 * Raio-X e coleta laboratorial nao sao feitos na clinica. Ate aqui eles
 * entravam na fila como qualquer exame e ficavam presos numa sala que nao
 * existe -- foi o caso da Izabella de Oliveira em 15/09, esperando 42 minutos
 * por um raio-X que a clinica nem realiza.
 *
 * Agora a recepcao imprime a guia e o paciente segue o caminho dele.
 */

/**
 * Onde cada guia manda o paciente.
 *
 * "o segundo e o laboratorio onde o cliente vai realizar o exame, somente
 *  a guia da coleta de sangue deve sair com o endereco da rua sacramento"
 *                                                  -- Isabella, 13/09
 *
 * Ou seja: raio X e feito no laboratorio da Tiradentes; a coleta de sangue
 * e feita aqui na clinica, e por isso a guia dela traz o endereco daqui.
 * Mandar o paciente ao lugar errado e o pior defeito possivel numa guia.
 */
const LOCAL_DO_LABORATORIO = 'R. Tiradentes, 164 – Vila Itapura – SP, 13023-190';

export async function emitirGuiaDeExame(input: {
  attendanceId: string;
  /** Uma linha por exame pedido. Para laboratorial, o que a recepcao digitou. */
  exames: string[];
  preparos?: string | null;
  /**
   * Para onde o paciente vai com esta guia.
   *
   * `laboratorio` = raio X, feito na Tiradentes.
   * `clinica` = coleta de sangue, feita aqui mesmo.
   */
  destino?: 'laboratorio' | 'clinica';
}): Promise<ActionResult<{ documentId: string }>> {
  try {
    const ctx = await assertPermission('documentos.emitir');
    const supabase = await createClient();

    const exames = input.exames.map((e) => e.trim()).filter(Boolean);
    if (exames.length === 0) {
      return fail('Escreva ao menos um exame antes de imprimir a guia.');
    }

    const { data: atendimento } = await supabase
      .from('attendances')
      .select(
        'id, patient_id, company_id, checkin_at, ' +
          'patients(full_name, social_name, cpf, rg, gender, birth_date, job_title, department), ' +
          'companies(legal_name, trade_name, document, street, number, district, city, state, zip_code)',
      )
      .eq('id', input.attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        patient_id: string | null;
        company_id: string | null;
        checkin_at: string;
        patients: {
          full_name: string;
          social_name: string | null;
          cpf: string | null;
          rg: string | null;
          gender: string | null;
          birth_date: string | null;
          job_title: string | null;
          department: string | null;
        } | null;
        companies: {
          legal_name: string;
          trade_name: string | null;
          document: string | null;
          street: string | null;
          number: string | null;
          district: string | null;
          city: string | null;
          state: string | null;
          zip_code: string | null;
        } | null;
      }>();

    if (!atendimento?.patients) return fail('Atendimento não encontrado.');

    const p = atendimento.patients;
    const e = atendimento.companies;
    const docsCfg = (ctx.settings.documentos ?? {}) as Record<string, string | null>;
    const guiaCfg = (ctx.settings.guia_exame ?? {}) as Record<string, string | null>;

    const codigo = randomBytes(5).toString('hex').toUpperCase();
    const cabecalho = await cabecalhoDaClinica(ctx);

    const pdf = await buildGuiaDeExame({
      clinica: cabecalho,
      colaborador: {
        nome: p.social_name ?? p.full_name,
        cpf: p.cpf ? formatCPF(p.cpf) : null,
        rg: p.rg,
        sexo: p.gender,
        nascimento: p.birth_date ? formatDate(p.birth_date) : null,
        cargo: p.job_title,
        setor: p.department,
      },
      empresa: e
        ? {
            nome: e.trade_name ?? e.legal_name,
            documento: e.document ? formatCNPJ(e.document) : null,
            endereco: [e.street, e.number].filter(Boolean).join(', ') || null,
            bairro: e.district,
            cidadeUf: [e.city, e.state].filter(Boolean).join('/') || null,
            cep: e.zip_code,
          }
        : null,
      exames,
      agendadoPara: formatDate(atendimento.checkin_at),
      preparos: input.preparos ?? null,
      localDoExame:
        input.destino === 'clinica'
          ? (cabecalho.endereco ?? 'Na própria clínica')
          : guiaCfg.local_do_exame || LOCAL_DO_LABORATORIO,
      rodape: docsCfg.rodape ?? ctx.branding.footer_text ?? null,
    });

    const caminho = `${ctx.tenant.id}/atendimentos/${atendimento.id}/guia-exame-${Date.now()}.pdf`;
    const { error: erroUpload } = await supabase.storage
      .from('clinical-documents')
      .upload(caminho, new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (erroUpload) return fail(`Falha ao salvar a guia: ${erroUpload.message}`);

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenant.id,
        kind: 'guia_exame',
        title: `Guia de exame${input.destino === 'clinica' ? ' (coleta)' : ''} — ${exames[0]}${exames.length > 1 ? ` (+${exames.length - 1})` : ''}`,
        patient_id: atendimento.patient_id,
        attendance_id: atendimento.id,
        company_id: atendimento.company_id,
        bucket: 'clinical-documents',
        file_path: caminho,
        size_bytes: pdf.byteLength,
        verification_code: codigo,
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
      patientId: atendimento.patient_id ?? undefined,
      description: `Guia de exame emitida: ${exames.join(', ')}`,
    });

    revalidatePath('/recepcao');
    revalidatePath('/documentos');
    return ok({ documentId: doc.id }, 'Guia emitida.');
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}
