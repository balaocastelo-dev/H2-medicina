'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertPermission } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { buildDocumentPdf } from './pdf';
import { marcaDoTenant } from './brand';
import {
  formatCNPJ,
  formatCPF,
  formatDate,
  formatDuration,
  formatMoney,
  formatTime,
} from '@/lib/format';
import { regraDe } from '@/modules/queue/origin-kind';
import { avaliarFichaClinica } from './ficha-clinica';
import { montarComprovanteImpresso } from './comprovante-texto';
import { gerarLaudoDeExame } from './laudo-actions';
import { fichaDoExame } from '@/modules/clinical/fichas-de-exame';
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
  patients: {
    full_name: string;
    cpf: string | null;
    birth_date: string | null;
    gender: string;
    job_title: string | null;
    department: string | null;
    admission_date: string | null;
  } | null;
  companies: {
    trade_name: string | null;
    legal_name: string;
    document: string | null;
    emite_ficha_clinica: boolean;
  } | null;
  appointments: Embutido<{ attendance_kind: string }>;
  triages: Embutido<Record<string, unknown>>;
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
        'id, checkin_at, finished_at, exit_at, patient_id, origin_kind, procedure_code, patients(full_name, cpf, birth_date, gender, job_title, department, admission_date), companies(trade_name, legal_name, document, emite_ficha_clinica), appointments(attendance_kind), triages(*), patient_exams(status, exam_types(name)), medical_consultations(verdict, valid_until, conclusion, antecedentes_profissionais, antecedentes_pessoais, estilo_vida, exame_fisico, psicossocial, alteracoes_exame_fisico)',
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
      avaliacao_psicossocial: 'Avaliação psicossocial',
      documento_final: 'Documento final consolidado',
      recibo: 'Recibo de pagamento',
      comprovante_agendamento: 'Comprovante de agendamento',
    };

    // "a ficha clinica precisa adicionar esses itens que nao esta saindo:
    //  funcao, data de admissao, cnpj da empresa, Setor, sexo, tipo de exame
    //  (admissional, demissional, periodico), resultados da triagem"
    //                                              -- Isabella, 23/09.
    //
    // Sao os campos do modelo em papel da clinica. A ficha e o que vai para
    // a empresa contratante: sem funcao, setor e tipo de exame ela nao diz
    // de qual avaliacao esta falando.
    const detalhado = kind === 'ficha_clinica' || kind === 'avaliacao_psicossocial';
    const identification = {
      title: 'Identificacao',
      lines: [
        { label: 'Paciente', value: patient.full_name },
        { label: 'CPF', value: patient.cpf ? formatCPF(patient.cpf) : 'não informado' },
        { label: 'Nascimento', value: formatDate(patient.birth_date) },
        ...(detalhado
          ? [
              { label: 'Sexo', value: patient.gender || 'não informado' },
              { label: 'Função', value: patient.job_title ?? 'não informada' },
              { label: 'Setor', value: patient.department ?? 'não informado' },
              { label: 'Admissão', value: formatDate(patient.admission_date) },
            ]
          : []),
        {
          label: 'Empresa',
          value:
            attendance.companies?.trade_name ?? attendance.companies?.legal_name ?? 'não informada',
        },
        ...(detalhado
          ? [
              {
                label: 'CNPJ da empresa',
                value: attendance.companies?.document
                  ? formatCNPJ(attendance.companies.document)
                  : 'não informado',
              },
              {
                label: 'Tipo de exame',
                value:
                  TIPO_DE_ATENDIMENTO[umDo(attendance.appointments)?.attendance_kind ?? ''] ??
                  'Ocupacional',
              },
            ]
          : []),
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

    // Resultados da triagem na ficha clinica: pressao, peso, altura e o que
    // mais foi medido na entrada. Faziam parte do modelo em papel e nao
    // saiam em lugar nenhum.
    if (kind === 'ficha_clinica') {
      const triagem = umDo(attendance.triages);
      const medidas = triagem ? medidasDaTriagem(triagem) : [];
      sections.push({
        title: 'Triagem',
        lines:
          medidas.length > 0
            ? medidas
            : [{ label: 'Situação', value: 'sem triagem registrada neste atendimento' }],
      });
    }

    // A avaliacao psicossocial saiu daqui em 23/09: "a avaliacao
    // psicossocial que saiu nela, nao deve estar junto, precisa sair em uma
    // ficha separada". Ela tem documento proprio agora.
    if (kind === 'avaliacao_psicossocial' && consultation) {
      const respostas = respondidos(
        BLOCO_PSICOSSOCIAL,
        consultation.psicossocial as Record<string, string> | null,
      );
      sections.push({
        title: BLOCO_PSICOSSOCIAL.titulo,
        lines:
          respostas.length > 0
            ? respostas.map((r) => ({ label: r.rotulo, value: r.valor }))
            : [{ label: 'Situação', value: 'sem respostas registradas' }],
      });
    }

    // Ficha clinica: o que o medico marcou na consulta.
    // "opc de imprimir a ficha com os dados que o medico preencheu"
    if (kind === 'ficha_clinica' && consultation) {
      for (const bloco of BLOCOS_FICHA) {
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
      .select('id, origin_kind, medical_consultations(verdict, psicossocial)')
      .eq('id', attendanceId)
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle<{
        id: string;
        origin_kind: string | null;
        medical_consultations: Embutido<{
          verdict: string | null;
          psicossocial: Record<string, unknown> | null;
        }>;
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

    // O psicossocial so entra no kit se o medico respondeu: emitir folha em
    // branco nao ajuda ninguem, e o documento nao vale para quem nao fez.
    const psicossocialRespondido = Object.values(
      (umDo(at.medical_consultations)?.psicossocial ?? {}) as Record<string, unknown>,
    ).some((v) => String(v ?? '').trim() !== '');
    if (psicossocialRespondido) {
      kinds.push({ kind: 'avaliacao_psicossocial', nome: 'avaliação psicossocial' });
    }

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
    // Laudo de cada exame que foi feito.
    //
    // "conferir que todos os exames feitos estao aparecendo os documentos
    //  no kit de saida" -- Isabella, 15/09.
    //
    // Ate 23/09 so a audiometria tinha laudo, e dinamometria, Romberg,
    // fadiga e psicossocial eram preenchidos na sala sem nunca virar papel.
    // Agora todo exame com ficha gera laudo; o que ja saiu nao sai de novo.
    // -----------------------------------------------------------------
    const { data: jaTemLaudo } = await supabase
      .from('documents')
      .select('payload')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .eq('kind', 'resultado_exame')
      .is('deleted_at', null)
      .returns<{ payload: { patient_exam_id?: string } | null }[]>();

    const comLaudo = new Set(
      (jaTemLaudo ?? [])
        .map((d) => d.payload?.patient_exam_id)
        .filter((x): x is string => typeof x === 'string'),
    );

    const { data: exames } = await supabase
      .from('patient_exams')
      .select('id, exam_types(code, name)')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .eq('status', 'concluido')
      .returns<{ id: string; exam_types: { code: string; name: string } | null }[]>();

    for (const exame of exames ?? []) {
      if (comLaudo.has(exame.id)) continue;
      if (!fichaDoExame(exame.exam_types?.code)) continue;

      const laudo = await gerarLaudoDeExame(exame.id);
      const nome = `laudo de ${(exame.exam_types?.name ?? 'exame').toLowerCase()}`;
      if (laudo.ok) emitidos.push(nome);
      else falhas.push(`${nome} (${laudo.error})`);
    }

    // -----------------------------------------------------------------
    // O que ja estava pronto tambem faz parte do kit: a guia sai no balcao
    // e o laudo pode ter saido na sala. Nao se emite de novo; se lista,
    // senao a recepcao acha que sumiram.
    // -----------------------------------------------------------------
    const { data: existentes } = await supabase
      .from('documents')
      .select('title, kind, payload')
      .eq('tenant_id', ctx.tenant.id)
      .eq('attendance_id', attendanceId)
      .in('kind', ['resultado_exame', 'guia_exame', 'aso'])
      .is('deleted_at', null)
      .returns<{ title: string; kind: string; payload: { patient_exam_id?: string } | null }[]>();

    const jaExistiam = (existentes ?? [])
      .filter((d) => d.kind !== 'aso' || !emitidos.includes('A.S.O.'))
      // Laudo recem-emitido acima ja esta em `emitidos`: contar de novo aqui
      // faria o kit anunciar o dobro de documentos.
      .filter((d) => d.kind !== 'resultado_exame' || comLaudo.has(d.payload?.patient_exam_id ?? ''))
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

/** Rotulos do tipo de atendimento, como a clinica fala. */
const TIPO_DE_ATENDIMENTO: Record<string, string> = {
  admissional: 'Admissional',
  periodico: 'Periódico',
  demissional: 'Demissional',
  mudanca_funcao: 'Mudança de função',
  retorno_trabalho: 'Retorno ao trabalho',
  consulta: 'Consulta',
};

/**
 * O que a triagem mediu, em linhas prontas para o documento.
 *
 * So sai o que foi preenchido: ficha com dez linhas de "—" nao informa
 * nada e ocupa a folha que a clinica quer enxuta.
 */
function medidasDaTriagem(t: Record<string, unknown>): { label: string; value: string }[] {
  const texto = (chave: string) => {
    const v = t[chave];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const linhas: { label: string; value: string }[] = [];
  const por = (label: string, valor: string | null, unidade = '') => {
    if (valor) linhas.push({ label, value: `${valor}${unidade}` });
  };

  const sis = texto('blood_pressure_systolic');
  const dia = texto('blood_pressure_diastolic');
  if (sis || dia) por('Pressão arterial', `${sis ?? '—'}/${dia ?? '—'}`, ' mmHg');

  por('Peso', texto('weight_kg'), ' kg');
  por('Altura', texto('height_cm'), ' cm');
  por('IMC', texto('bmi'));
  por('Frequência cardíaca', texto('heart_rate'), ' bpm');
  por('Frequência respiratória', texto('respiratory_rate'), ' irpm');
  por('Saturação', texto('oxygen_saturation'), '%');
  por('Temperatura', texto('temperature_c'), ' °C');
  por('Glicemia', texto('glucose'), ' mg/dL');
  por('Acuidade O.D.', texto('acuidade_od'));
  por('Acuidade O.E.', texto('acuidade_oe'));

  if (t.diabetes !== null && t.diabetes !== undefined) {
    linhas.push({ label: 'Diabetes', value: t.diabetes ? 'sim' : 'não' });
  }
  if (t.hipertenso !== null && t.hipertenso !== undefined) {
    linhas.push({ label: 'Hipertenso', value: t.hipertenso ? 'sim' : 'não' });
  }

  por('Alertas', texto('alerts'));
  por('Restrições', texto('restrictions'));
  por('Observações', texto('observations'));

  return linhas;
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