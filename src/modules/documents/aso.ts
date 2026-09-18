import 'server-only';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildAsoPdf } from './aso-pdf';
import { idadeNaData, montarRiscos, perfilParaCargo, type PerfilDeRisco } from './riscos';
import { formatCNPJ, formatCPF, formatDate } from '@/lib/format';
import { type ActionResult, fail, ok, toFriendlyError } from '@/lib/action-result';
import { urlDeVerificacao } from './verificacao';
import { publicEnv } from '@/lib/env';

/**
 * A.S.O. — Atestado de Saude Ocupacional.
 *
 * Sai automaticamente quando o medico finaliza a consulta. Traz sempre a data
 * atual, o medico responsavel pelo PCMSO cadastrado nas configuracoes, a
 * assinatura eletronica do examinador e, quando houver, a assinatura que o
 * paciente deixou na entrada.
 */

interface AtendimentoAso {
  id: string;
  checkin_at: string;
  company_id: string | null;
  patient_signature_path: string | null;
  patients: {
    full_name: string;
    social_name: string | null;
    cpf: string | null;
    rg: string | null;
    birth_date: string | null;
    gender: string;
    job_title: string | null;
    department: string | null;
    registration_number: string | null;
    /** Risco anotado no cadastro deste empregado; vence o perfil do cargo. */
    occupational_risks: string | null;
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
  appointments: { attendance_kind: string } | null;
  medical_consultations: {
    verdict: string | null;
    restrictions: string | null;
    valid_until: string | null;
    observations: string | null;
    conclusion: string | null;
  }[];
  patient_exams: {
    status: string;
    finished_at: string | null;
    exam_types: { name: string } | null;
  }[];
}

// O parecer deixou de ser escrito por extenso: o modelo da clinica usa
// caixas de marcar, e quem desenha isso agora e o proprio PDF.

const TIPO_EXAME: Record<string, string> = {
  admissional: 'Admissional',
  periodico: 'Periódico',
  demissional: 'Demissional',
  mudanca_funcao: 'Mudança de função',
  retorno_trabalho: 'Retorno ao trabalho',
  consulta: 'Consulta',
};

export async function gerarAso(
  ctx: SessionContext,
  attendanceId: string,
  /** Quem assina. Sem isso, assina quem esta emitindo. */
  signatarioId?: string | null,
): Promise<ActionResult<{ documentId: string }>> {
  try {
    const supabase = await createClient();

    const { data: at } = await supabase
      .from('attendances')
      .select(
        'id, checkin_at, company_id, patient_signature_path, patients(full_name, social_name, cpf, rg, birth_date, gender, job_title, department, registration_number, occupational_risks), companies(legal_name, trade_name, document, street, number, district, city, state, zip_code), appointments(attendance_kind), medical_consultations(verdict, restrictions, valid_until, observations, conclusion), patient_exams(status, finished_at, exam_types(name))',
      )
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<AtendimentoAso>();

    if (!at?.patients) return fail('Atendimento não encontrado.');

    const consulta = at.medical_consultations?.[0];
    if (!consulta?.verdict) {
      return fail('O A.S.O. exige a conclusão de aptidão preenchida.');
    }

    const empresaCfg = (ctx.settings.empresa ?? {}) as Record<string, string | null>;
    const contatoCfg = (ctx.settings.contato ?? {}) as Record<string, string | null>;
    const respCfg = (ctx.settings.responsavel_tecnico ?? {}) as Record<string, string | null>;
    const signatario = await carregarSignatario(ctx, signatarioId ?? ctx.userId, respCfg);
    const pcmsoCfg = (ctx.settings.pcmso ?? {}) as Record<string, string | null>;
    const docsCfg = (ctx.settings.documentos ?? {}) as Record<string, string | null>;

    // Assinatura do paciente coletada na entrada, se houver.
    let assinaturaPaciente: string | null = null;
    if (at.patient_signature_path) {
      const { data } = await supabase.storage
        .from('clinical-documents')
        .createSignedUrl(at.patient_signature_path, 120);
      if (data?.signedUrl) {
        const resp = await fetch(data.signedUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          assinaturaPaciente = `data:image/png;base64,${buf.toString('base64')}`;
        }
      }
    }

    const codigo = randomBytes(5).toString('hex').toUpperCase();
    const paciente = at.patients;
    const empresa = at.companies;
    const emitidoEm = new Date();

    // Perigos e fatores de risco: do cargo dentro da empresa, nao do
    // paciente. Gravados junto com o atendimento para o A.S.O. ja emitido
    // nao mudar se a empresa revisar o perfil depois.
    const { data: perfis } = await supabase
      .from('company_risk_profiles')
      .select('cargo, fisicos, quimicos, biologicos, ergonomicos, acidentes')
      .eq('tenant_id', ctx.tenant.id)
      .eq('company_id', at.company_id ?? '')
      .is('deleted_at', null)
      .returns<PerfilDeRisco[]>();

    const riscos = montarRiscos(
      perfilParaCargo(perfis ?? [], paciente.job_title),
      // O risco anotado no cadastro deste empregado vence o perfil do cargo.
      paciente.occupational_risks,
    );
    await supabase.from('attendances').update({ riscos }).eq('id', attendanceId);

    const pdf = await buildAsoPdf({
      clinica: {
        nome: ctx.branding.system_name,
        razaoSocial: empresaCfg.razao_social ?? ctx.tenant.legal_name,
        cnpj: empresaCfg.cnpj ? formatCNPJ(empresaCfg.cnpj) : null,
        endereco:
          [contatoCfg.logradouro, contatoCfg.numero, contatoCfg.bairro, contatoCfg.cidade]
            .filter(Boolean)
            .join(', ') || null,
        telefone: contatoCfg.telefone ?? null,
        cor: ctx.branding.color_primary,
      },
      // A data e sempre a da emissao, como pedido.
      emitidoEm,
      empresaContratante: {
        razaoSocial: empresa?.legal_name ?? 'Não informada',
        cnpj: empresa?.document ? formatCNPJ(empresa.document) : null,
        endereco: [empresa?.street, empresa?.number].filter(Boolean).join(', ') || null,
        bairro: empresa?.district ?? null,
        cidade: [empresa?.city, empresa?.state].filter(Boolean).join(' / ') || null,
        cep: empresa?.zip_code ?? null,
      },
      funcionario: {
        nome: paciente.social_name ?? paciente.full_name,
        matricula: paciente.registration_number ?? null,
        cpf: paciente.cpf ? formatCPF(paciente.cpf) : null,
        rg: paciente.rg ?? null,
        nascimento: formatDate(paciente.birth_date),
        idade: idadeNaData(paciente.birth_date, emitidoEm),
        sexo: paciente.gender,
        cargo: paciente.job_title ?? null,
        setor: paciente.department ?? null,
      },
      medicoPcmso: {
        nome: pcmsoCfg.nome ?? respCfg.nome ?? null,
        conselho: pcmsoCfg.conselho ?? respCfg.conselho ?? 'CRM',
        numero: pcmsoCfg.numero ?? respCfg.numero ?? null,
        uf: pcmsoCfg.uf ?? respCfg.uf ?? null,
        rqe: pcmsoCfg.rqe ?? null,
        endereco: pcmsoCfg.endereco ?? null,
        bairro: pcmsoCfg.bairro ?? null,
        cidade: pcmsoCfg.cidade ?? null,
        cep: pcmsoCfg.cep ?? null,
        telefone: pcmsoCfg.telefone ?? null,
      },
      riscos,
      medicoExaminador: {
        nome: signatario.nome,
        conselho: signatario.conselho,
        numero: signatario.numero,
        uf: signatario.uf,
      },
      assinaturaMedico: signatario.assinatura,
      tipoExame: TIPO_EXAME[at.appointments?.attendance_kind ?? ''] ?? 'Ocupacional',
      // O modelo da clinica imprime a data ao lado de cada exame.
      exames: [
        { nome: 'Exame Clínico', data: formatDate(emitidoEm) },
        ...at.patient_exams
          .filter((e) => e.status === 'concluido')
          .map((e) => ({
            nome: e.exam_types?.name ?? 'Exame',
            data: e.finished_at ? formatDate(e.finished_at) : null,
          })),
      ],
      // O PDF marca a caixa certa, entao recebe o codigo e nao o rotulo.
      parecer: consulta.verdict,
      restricoes: consulta.restrictions ?? null,
      validade: consulta.valid_until ? formatDate(consulta.valid_until) : null,
      observacoes: consulta.observations ?? consulta.conclusion ?? null,
      assinaturaPaciente,
      codigoVerificacao: codigo,
      urlVerificacao: urlDeVerificacao(docsCfg.url_verificacao, publicEnv.NEXT_PUBLIC_APP_URL),
      rodape: docsCfg.rodape ?? ctx.branding.footer_text ?? null,
    });

    const caminho = `${ctx.tenant.id}/atendimentos/${attendanceId}/aso-${Date.now()}.pdf`;
    const { error: erroUpload } = await supabase.storage
      .from('clinical-documents')
      .upload(caminho, new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (erroUpload) return fail(`Falha ao salvar o A.S.O.: ${erroUpload.message}`);

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        tenant_id: ctx.tenant.id,
        kind: 'aso',
        title: 'Atestado de Saúde Ocupacional',
        patient_id: (await patientIdDe(attendanceId, ctx.tenant.id)) ?? null,
        attendance_id: attendanceId,
        bucket: 'clinical-documents',
        file_path: caminho,
        size_bytes: pdf.byteLength,
        verification_code: codigo,
        is_patient_visible: true,
        signed_by: signatario.id,
        signer_name: signatario.nome,
        signer_council: signatario.numero
          ? `${signatario.conselho} ${signatario.numero}${signatario.uf ? '/' + signatario.uf : ''}`
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
      description: 'A.S.O. emitido ao finalizar a consulta',
    });

    return ok({ documentId: doc.id });
  } catch (error) {
    return fail(toFriendlyError(error));
  }
}

async function patientIdDe(attendanceId: string, tenantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendances')
    .select('patient_id')
    .eq('id', attendanceId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ patient_id: string }>();
  return data?.patient_id ?? null;
}

interface Signatario {
  id: string;
  nome: string;
  conselho: string;
  numero: string | null;
  uf: string | null;
  /** PNG em data URI, ou null quando o profissional ainda nao registrou. */
  assinatura: string | null;
}

/**
 * Carrega quem assina o documento.
 *
 * O nome e o registro sao gravados no PDF no momento da emissao: se o
 * cadastro mudar depois, o documento ja impresso continua dizendo a verdade
 * sobre quem assinou.
 */
async function carregarSignatario(
  ctx: SessionContext,
  profileId: string,
  respCfg: Record<string, string | null>,
): Promise<Signatario> {
  const supabase = await createClient();

  const { data: perfil } = await supabase
    .from('profiles')
    .select('id, full_name, council_type, council_number, council_state, signature_path')
    .eq('id', profileId)
    .eq('tenant_id', ctx.tenant.id)
    .is('deleted_at', null)
    .maybeSingle<{
      id: string;
      full_name: string;
      council_type: string | null;
      council_number: string | null;
      council_state: string | null;
      signature_path: string | null;
    }>();

  const base: Signatario = {
    id: perfil?.id ?? ctx.userId,
    nome: perfil?.full_name || ctx.profile.full_name || (respCfg.nome ?? ''),
    conselho: perfil?.council_type ?? ctx.profile.council_type ?? respCfg.conselho ?? 'CRM',
    numero: perfil?.council_number ?? ctx.profile.council_number ?? respCfg.numero ?? null,
    uf: perfil?.council_state ?? ctx.profile.council_state ?? respCfg.uf ?? null,
    assinatura: null,
  };

  if (!perfil?.signature_path) return base;

  // Assinatura ilegivel nao pode impedir a emissao: o documento sai com a
  // linha e o nome, como sempre saiu.
  try {
    const { data } = await supabase.storage
      .from('signatures')
      .createSignedUrl(perfil.signature_path, 120);
    if (data?.signedUrl) {
      const resposta = await fetch(data.signedUrl);
      if (resposta.ok) {
        const buf = Buffer.from(await resposta.arrayBuffer());
        base.assinatura = `data:image/png;base64,${buf.toString('base64')}`;
      }
    }
  } catch (erro) {
    console.error('[aso] não consegui carregar a assinatura do médico:', erro);
  }

  return base;
}
