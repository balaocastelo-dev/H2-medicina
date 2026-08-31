'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { saveConsultation } from './actions';
import type { ActionResult } from '@/lib/action-result';
import type { MedicalConsultation } from '@/types/entities';
import { BlocosDaFicha } from './ficha-blocos';
import {
  alertasPsicossociais,
  BLOCO_PSICOSSOCIAL,
  BLOCOS_FICHA,
  type RespostasBloco,
} from './ficha-estrutura';

export function ConsultationForm({
  attendanceId,
  consultation,
  procedimentos = [],
  procedimentoPadrao,
  medicos = [],
  medicoPadrao,
  psicossocialSolicitado = false,
}: {
  attendanceId: string;
  consultation: MedicalConsultation | null;
  /** A recepcao marcou o exame psicossocial para este paciente. */
  psicossocialSolicitado?: boolean;
  /** Catalogo de repasse; vazio esconde o campo. */
  procedimentos?: { code: string; name: string }[];
  procedimentoPadrao?: string;
  /** Quem pode assinar o A.S.O.; vazio esconde o campo. */
  medicos?: { id: string; nome: string; registro: string | null; temAssinatura: boolean }[];
  medicoPadrao?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveConsultation,
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const finished = !!consultation?.finished_at;
  const router = useRouter();

  /**
   * Consulta finalizada devolve a tela para a lista de espera.
   *
   * O medico chamava o proximo e continuava olhando a ficha de quem acabou
   * de sair. A pausa curta deixa ele ler o aviso de que o A.S.O. saiu antes
   * de a tela trocar.
   */
  useEffect(() => {
    if (!state?.ok || !state.message?.includes('finalizada')) return;
    const t = setTimeout(() => {
      router.push('/medico');
      router.refresh();
    }, 1800);
    return () => clearTimeout(t);
  }, [state, router]);

  // Blocos de selecao da ficha clinica. Comecam com o que ja foi gravado.
  const [blocos, setBlocos] = useState<Record<string, RespostasBloco>>(() =>
    Object.fromEntries(
      [...BLOCOS_FICHA, BLOCO_PSICOSSOCIAL].map((b) => [
        b.chave,
        (consultation?.[b.chave] as RespostasBloco | undefined) ?? {},
      ]),
    ),
  );
  const marcar = (bloco: string, campo: string, valor: string) =>
    setBlocos((atual) => ({ ...atual, [bloco]: { ...atual[bloco], [campo]: valor } }));

  const alertasPsico = alertasPsicossociais(blocos.psicossocial);

  return (
    <Card>
      <CardHeader
        title="Consulta médica"
        description={
          finished ? 'Consulta finalizada — alteracoes ficam registradas na auditoria' : undefined
        }
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          {state?.ok && <Alert variant="success">{state.message}</Alert>}
          {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

          <input type="hidden" name="attendance_id" value={attendanceId} />

          <div className="grid gap-4 md:grid-cols-2">
            {/* "Modulo medico: retirar 'queixa principal' e 'anamnese'" —
                as colunas continuam no banco para nao perder o que ja foi
                gravado; apenas sairam da tela. */}
            <Field label="Historia clínica">
              <Textarea
                name="clinical_history"
                defaultValue={consultation?.clinical_history ?? ''}
                rows={2}
              />
            </Field>
            <Field label="Antecedentes pessoais">
              <Textarea
                name="personal_history"
                defaultValue={consultation?.personal_history ?? ''}
                rows={2}
              />
            </Field>
            <Field label="Antecedentes familiares">
              <Textarea
                name="family_history"
                defaultValue={consultation?.family_history ?? ''}
                rows={2}
              />
            </Field>
            <Field label="Medicamentos em uso">
              <Textarea
                name="medications"
                defaultValue={consultation?.medications ?? ''}
                rows={2}
              />
            </Field>
            <Field label="Alergias">
              <Textarea name="allergies" defaultValue={consultation?.allergies ?? ''} rows={2} />
            </Field>
            <Field label="Exame fisico">
              <Textarea
                name="physical_exam"
                defaultValue={consultation?.physical_exam ?? ''}
                rows={2}
              />
            </Field>
            <Field label="Diagnostico">
              <Textarea name="diagnosis" defaultValue={consultation?.diagnosis ?? ''} rows={2} />
            </Field>
            <Field label="Conclusao">
              <Textarea name="conclusion" defaultValue={consultation?.conclusion ?? ''} rows={2} />
            </Field>
            <Field label="Conduta">
              <Textarea name="conduct" defaultValue={consultation?.conduct ?? ''} rows={2} />
            </Field>
            <Field label="Recomendacoes">
              <Textarea
                name="recommendations"
                defaultValue={consultation?.recommendations ?? ''}
                rows={2}
              />
            </Field>
          </div>

          <div className="space-y-4">
            <BlocosDaFicha
              extras={psicossocialSolicitado ? [BLOCO_PSICOSSOCIAL] : []}
              valores={blocos}
              alteracoes={consultation?.alteracoes_exame_fisico ?? ''}
              onChange={marcar}
            />
          </div>

          {/* O que o psicossocial apontou fica visivel na hora de fechar a
              aptidao, e nao so no fim da lista de perguntas. */}
          {psicossocialSolicitado && alertasPsico.length > 0 && (
            <Alert variant="warning" title="Respostas que pedem atenção">
              <ul className="list-disc pl-4">
                {alertasPsico.map((a) => (
                  <li key={a.rotulo}>
                    {a.rotulo} <strong>{a.valor}</strong>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Conclusão de aptidão" error={errors?.verdict} required>
              <Select name="verdict" defaultValue={consultation?.verdict ?? ''}>
                <option value="">Selecione</option>
                <option value="apto">Apto</option>
                <option value="apto_com_restricoes">Apto com restrições</option>
                <option value="inapto">Inapto</option>
                <option value="inconclusivo">Inconclusivo</option>
              </Select>
            </Field>
            <Field label="Validade">
              <Input
                type="date"
                name="valid_until"
                defaultValue={consultation?.valid_until ?? ''}
              />
            </Field>
            <Field label="Restricoes">
              <Input name="restrictions" defaultValue={consultation?.restrictions ?? ''} />
            </Field>
          </div>

          {procedimentos.length > 0 && (
            <Field
              label="Procedimento"
              hint="Define o valor do repasse lançado ao finalizar a consulta"
            >
              <Select name="procedure_code" defaultValue={procedimentoPadrao ?? ''}>
                {procedimentos.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Observacoes">
            <Textarea
              name="observations"
              defaultValue={consultation?.observations ?? ''}
              rows={2}
            />
          </Field>

          {medicos.length > 0 && (
            <Field
              label="Médico que assina o A.S.O."
              hint="O documento sai com o nome, o registro e a assinatura de quem for escolhido"
            >
              <Select name="signatario_id" defaultValue={medicoPadrao ?? ''}>
                {medicos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                    {m.registro ? ` — ${m.registro}` : ''}
                    {m.temAssinatura ? '' : ' (sem assinatura registrada)'}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="outline" loading={pending}>
              Salvar rascunho
            </Button>
            <Button type="submit" name="finalizar" value="sim" loading={pending}>
              Finalizar consulta
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
