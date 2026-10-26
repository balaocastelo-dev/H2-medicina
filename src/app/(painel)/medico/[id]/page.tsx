import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { auditClinicalAccess } from '@/lib/audit';
import { PageHeader } from '@/components/layout/page-header';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { calcAge, formatCPF, formatDate, formatDateTime } from '@/lib/format';
import { umDo, type Embutido } from '@/lib/embed';
import { ConsultationForm } from '@/modules/clinical/consultation-form';
import { fichaDoExame, preenchidos } from '@/modules/clinical/fichas-de-exame';
import { FichaDeExameForm } from '@/modules/clinical/ficha-de-exame';
import { consultaSoConcluir, REGRAS, isOriginKind, temFichaNaConsulta } from '@/modules/queue/origin-kind';
import { ConcluirAtendimentoForm } from '@/modules/clinical/concluir-atendimento-form';
import type { MedicalConsultation, Triage } from '@/types/entities';

export const dynamic = 'force-dynamic';

/** Rotulos do tipo de atendimento, como a clinica fala. */
const TIPO_DE_ATENDIMENTO: Record<string, string> = {
  admissional: 'Admissional',
  periodico: 'Periódico',
  demissional: 'Demissional',
  mudanca_funcao: 'Mudança de função',
  retorno_trabalho: 'Retorno ao trabalho',
  consulta: 'Consulta',
};

interface AttendanceDetail {
  id: string;
  stage_code: string;
  priority: string;
  checkin_at: string;
  notes: string | null;
  procedure_code: string | null;
  origin_kind: string | null;
  patients: {
    id: string;
    full_name: string;
    cpf: string | null;
    birth_date: string | null;
    gender: string;
    job_title: string | null;
    department: string | null;
  } | null;
  companies: { trade_name: string | null; legal_name: string } | null;
  appointments: Embutido<{ attendance_kind: string }>;
  // Um por atendimento: o PostgREST entrega como objeto, nao como lista.
  triages: Embutido<Triage>;
  medical_consultations: Embutido<MedicalConsultation>;
  patient_exams: {
    id: string;
    status: string;
    finished_at: string | null;
    not_performed_reason: string | null;
    exam_types: { name: string; code: string } | null;
    exam_results: {
      conclusion: string | null;
      is_altered: boolean;
      values: Record<string, unknown>;
    }[];
  }[];
}

export default async function MedicoAtendimentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission('medico.atender');
  const supabase = await createClient();

  // Quem assina o A.S.O. e quem esta logado. Nao ha escolha: alem de ser o
  // que a clinica pediu em 22/09, e o unico modelo honesto — ninguem assina
  // documento medico no lugar de outro.
  const { data: eu } = await supabase
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

  const { data } = await supabase
    .from('attendances')
    .select(
      'id, stage_code, priority, checkin_at, notes, procedure_code, origin_kind, patients(id, full_name, cpf, birth_date, gender, job_title, department), companies(trade_name, legal_name), appointments(attendance_kind), triages(*), medical_consultations(*), patient_exams(id, status, finished_at, not_performed_reason, exam_types(name, code), exam_results(conclusion, is_altered, values))',
    )
    .eq('id', id)
    .eq('tenant_id', ctx.tenant.id)
    .maybeSingle<AttendanceDetail>();

  if (!data || !data.patients) notFound();

  await auditClinicalAccess(ctx, data.patients.id, 'prontuario', id);

  const triage = umDo(data.triages);
  const consultation = umDo(data.medical_consultations);

  // "incluir perguntas de exame psicossocial, caso essa opcao tenha sido
  //  flegada na aba recepcao"
  const psicossocialSolicitado = data.patient_exams.some((e) => e.exam_types?.code === 'PSICO');

  // "o teste de romberg tem que mudar para ser realizado na aba medica"
  //                                              -- Isabella, 28/09.
  //
  // Ele era preenchido na bancada da triagem. Aqui ele aparece como ficha
  // propria, e nao como bloco da consulta, de proposito: continua sendo um
  // EXAME, com resultado e laudo em papel separado. Virar bloco da consulta
  // faria o resultado deixar de existir como exame -- sem status, sem laudo,
  // e sem aparecer na area do paciente.
  const soConcluir = consultaSoConcluir(data.origin_kind);
  const fichasDaConsulta = soConcluir
    ? []
    : data.patient_exams.filter(
        (e) => temFichaNaConsulta(e.exam_types?.code) && fichaDoExame(e.exam_types?.code),
      );
  // O que ja esta no cartao "Para preencher" nao se repete no cartao de
  // exames: o Romberg aparecia duas vezes na mesma tela.
  const naConsulta = new Set(fichasDaConsulta.map((e) => e.id));
  const examesDoCartao = data.patient_exams.filter((e) => !naConsulta.has(e.id));

  // O que a recepcao escolheu, em bom portugues, ao lado do nome.
  //
  // "deve mostrar pro medico apenas o que foi selecionado, sem opcao de
  //  alterar, deve mostrar proximo ao nome, por exemplo 'izabella de
  //  oliveira - admissao', sendo uma informacao interna, nao deve aparecer
  //  nas senhas" — Isabella, 21/09.
  const tipoDeAtendimento = TIPO_DE_ATENDIMENTO[umDo(data.appointments)?.attendance_kind ?? ''];
  const nomeDoProcedimento = data.procedure_code
    ? ((
        await supabase
          .from('procedure_types')
          .select('name')
          .eq('tenant_id', ctx.tenant.id)
          .eq('code', data.procedure_code)
          .maybeSingle<{ name: string }>()
      ).data?.name ?? null)
    : null;

  const selo = [tipoDeAtendimento, nomeDoProcedimento].filter(Boolean).join(' · ');

  const assinante = eu
    ? {
        nome: eu.full_name,
        registro: eu.council_number
          ? `${eu.council_type ?? 'CRM'} ${eu.council_number}${eu.council_state ? '/' + eu.council_state : ''}`
          : null,
        temAssinatura: !!eu.signature_path,
      }
    : null;

  return (
    <div>
      <PageHeader
        title={selo ? `${data.patients.full_name} — ${selo}` : data.patients.full_name}
        description={[
          data.patients.cpf ? formatCPF(data.patients.cpf) : null,
          calcAge(data.patients.birth_date) !== null
            ? `${calcAge(data.patients.birth_date)} anos`
            : null,
          data.companies?.trade_name ?? data.companies?.legal_name,
          data.patients.job_title,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Triagem" />
            <CardBody className="space-y-1 text-sm">
              {!triage ? (
                <p className="text-slate-500">Sem triagem registrada.</p>
              ) : (
                <>
                  <Row
                    label="PA"
                    value={`${triage.blood_pressure_systolic ?? '—'}/${triage.blood_pressure_diastolic ?? '—'} mmHg`}
                  />
                  <Row label="FC" value={triage.heart_rate ? `${triage.heart_rate} bpm` : '—'} />
                  <Row
                    label="Temperatura"
                    value={triage.temperature_c ? `${triage.temperature_c} C` : '—'}
                  />
                  <Row
                    label="SpO2"
                    value={triage.oxygen_saturation ? `${triage.oxygen_saturation}%` : '—'}
                  />
                  <Row
                    label="Peso / Altura"
                    value={`${triage.weight_kg ?? '—'} kg / ${triage.height_cm ?? '—'} cm`}
                  />
                  <Row label="IMC" value={triage.bmi ? String(triage.bmi) : '—'} />
                  {/* O resto do que a triagem anotou. Sem isso o medico
                      perguntava de novo diabetes, hipertensao e acuidade. */}
                  {triage.respiratory_rate !== null && (
                    <Row label="FR" value={`${triage.respiratory_rate} irpm`} />
                  )}
                  {(triage.acuidade_od || triage.acuidade_oe) && (
                    <Row
                      label="Acuidade OD / OE"
                      value={`${triage.acuidade_od || '—'} / ${triage.acuidade_oe || '—'}`}
                    />
                  )}
                  <Row label="Diabetes" value={simNao(triage.diabetes)} />
                  <Row label="Hipertensão" value={simNao(triage.hipertenso)} />
                  {triage.observations && (
                    <p className="mt-2 rounded bg-slate-50 p-2 text-slate-700">
                      <strong>Observações da triagem:</strong> {triage.observations}
                    </p>
                  )}
                  {triage.alerts && (
                    <p className="mt-2 rounded bg-amber-50 p-2 text-amber-800">
                      <strong>Alertas:</strong> {triage.alerts}
                    </p>
                  )}
                  {triage.restrictions && (
                    <p className="mt-1 rounded bg-red-50 p-2 text-red-800">
                      <strong>Restrições:</strong> {triage.restrictions}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {fichasDaConsulta.length > 0 && (
            <Card>
              <CardHeader
                title="Para preencher na consulta"
                description="Exames respondidos aqui. Salvar conclui o exame e libera o laudo."
              />
              <CardBody className="space-y-5">
                {fichasDaConsulta.map((e) => (
                  <div key={e.id}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium">{e.exam_types?.name ?? '—'}</span>
                      {e.status === 'concluido' && <Badge color="#22C55E">concluído</Badge>}
                    </div>
                    <FichaDeExameForm
                      patientExamId={e.id}
                      codigoExame={e.exam_types?.code}
                      valoresIniciais={comoTexto(e.exam_results?.[0]?.values)}
                      conclusaoInicial={e.exam_results?.[0]?.conclusion ?? ''}
                      concluirAoSalvar
                    />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Exames"
              description={`Chegada: ${formatDateTime(data.checkin_at)}`}
            />
            <CardBody className="space-y-2 text-sm">
              {examesDoCartao.length === 0 && (
                <p className="text-slate-500">
                  {data.patient_exams.length === 0 ? 'Sem exames.' : 'Todos estão no cartão acima.'}
                </p>
              )}
              {examesDoCartao.map((e) => (
                <div key={e.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.exam_types?.name ?? '—'}</span>
                    <Badge
                      color={
                        e.status === 'concluido'
                          ? '#22C55E'
                          : e.status === 'nao_realizado'
                            ? '#EF4444'
                            : '#FB923C'
                      }
                    >
                      {e.status}
                    </Badge>
                  </div>
                  {/* "Ter os exames realizados em uma aba lateral pro medico
                      visualizar durante a consulta" — o que o examinador
                      preencheu na sala aparece aqui, sem abrir outra tela. */}
                  {(() => {
                    const ficha = fichaDoExame(e.exam_types?.code);
                    const valores = e.exam_results?.[0]?.values;
                    if (!ficha || !valores) return null;
                    const respostas = preenchidos(ficha, valores).slice(0, 12);
                    if (respostas.length === 0) return null;
                    return (
                      <dl className="mt-2 space-y-0.5 rounded bg-slate-50 p-2 text-xs">
                        {respostas.map((r) => (
                          <div key={r.rotulo} className="flex justify-between gap-2">
                            <dt className="text-slate-500">{r.rotulo}</dt>
                            <dd className="text-right font-medium text-slate-700">{r.valor}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  })()}
                  {e.exam_results?.[0]?.conclusion && (
                    <p className="mt-1 text-xs text-slate-600">{e.exam_results[0].conclusion}</p>
                  )}
                  {e.exam_results?.[0]?.is_altered && (
                    <Badge color="#EF4444">resultado alterado</Badge>
                  )}
                  {e.not_performed_reason && (
                    <p className="mt-1 text-xs text-red-600">{e.not_performed_reason}</p>
                  )}
                  {e.finished_at && (
                    <p className="text-[11px] text-slate-400">{formatDate(e.finished_at)}</p>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="xl:col-span-2">
          {/*
            `key={id}`: a ficha guarda o que o medico digita em estado
            React, e sem a chave o React reaproveitaria o componente ao
            trocar de paciente — o texto de um cairia na ficha do outro.
            Hoje nao ha link direto entre duas fichas (toda navegacao passa
            por /medico, que desmonta o formulario), mas isso e acidente de
            rota: o dia em que alguem puser um botao "proximo paciente", o
            buraco abre em silencio. E prontuario.
          */}
          {soConcluir ? (
            <ConcluirAtendimentoForm
              key={id}
              attendanceId={id}
              procedencia={
                isOriginKind(data.origin_kind) ? REGRAS[data.origin_kind].short : 'perícia'
              }
              jaConcluido={!!consultation?.finished_at}
            />
          ) : (
            <ConsultationForm
              key={id}
              psicossocialSolicitado={psicossocialSolicitado}
              attendanceId={id}
              consultation={consultation ?? null}
              assinante={assinante}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * O que ja foi gravado, no formato que o formulario le.
 *
 * O banco guarda `values` como JSON livre; a ficha trabalha com texto. Numero
 * e booleano viram texto para que reabrir uma ficha salva mostre o que foi
 * respondido, em vez de um campo em branco por cima de um valor existente.
 */
function comoTexto(valores: Record<string, unknown> | undefined): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(valores ?? {})) {
    if (valor === null || valor === undefined) continue;
    saida[chave] = String(valor);
  }
  return saida;
}

function simNao(v: boolean | null): string {
  if (v === null || v === undefined) return '—';
  return v ? 'Sim' : 'Não';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-50 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
