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
  assinante,
  psicossocialSolicitado = false,
}: {
  attendanceId: string;
  consultation: MedicalConsultation | null;
  /** A recepcao marcou o exame psicossocial para este paciente. */
  psicossocialSolicitado?: boolean;
  /** Quem esta logado — e quem vai assinar o A.S.O. */
  assinante?: { nome: string; registro: string | null; temAssinatura: boolean } | null;
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

  /**
   * Os campos escritos a mao, em estado controlado.
   *
   * ---------------------------------------------------------------------
   * Por que nao pode ser `defaultValue`
   * ---------------------------------------------------------------------
   * O React reseta formulario NAO CONTROLADO depois que a action termina —
   * inclusive quando ela devolve erro. O medico preenchia historia clinica,
   * antecedentes, exame fisico, diagnostico e conduta, esquecia de escolher a
   * conclusao de aptidao, clicava em "Finalizar consulta", o servidor recusava
   * ("Informe a conclusao de aptidao antes de finalizar") — e TUDO QUE ELE
   * DIGITOU sumia.
   *
   * Pior do que sumir tudo: os blocos de selecao sao estado React e
   * sobreviviam, entao a tela voltava meio preenchida e o medico nao percebia
   * o que tinha perdido. Isso e prontuario digitado a mao, em consulta, com o
   * paciente na sala.
   *
   * Controlado, o que esta na tela e o que esta na memoria, e nenhuma recusa
   * do servidor apaga nada.
   */
  const [campos, setCampos] = useState<Record<string, string>>(() => ({
    clinical_history: consultation?.clinical_history ?? '',
    personal_history: consultation?.personal_history ?? '',
    family_history: consultation?.family_history ?? '',
    medications: consultation?.medications ?? '',
    allergies: consultation?.allergies ?? '',
    physical_exam: consultation?.physical_exam ?? '',
    diagnosis: consultation?.diagnosis ?? '',
    conclusion: consultation?.conclusion ?? '',
    conduct: consultation?.conduct ?? '',
    recommendations: consultation?.recommendations ?? '',
    verdict: consultation?.verdict ?? '',
    valid_until: consultation?.valid_until ?? '',
    restrictions: consultation?.restrictions ?? '',
    observations: consultation?.observations ?? '',
  }));

  /** `name`, `value` e `onChange` de uma vez, para nao repetir 14 vezes. */
  const campo = (nome: keyof typeof campos) => ({
    name: String(nome),
    value: campos[nome] ?? '',
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) => setCampos((atual) => ({ ...atual, [nome]: e.target.value })),
  });

  const [aptoAltura, setAptoAltura] = useState(consultation?.apto_altura ?? false);
  const [aptoEletricidade, setAptoEletricidade] = useState(
    consultation?.apto_eletricidade ?? false,
  );

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
              <Textarea {...campo('clinical_history')} rows={2} />
            </Field>
            <Field label="Antecedentes pessoais">
              <Textarea {...campo('personal_history')} rows={2} />
            </Field>
            <Field label="Antecedentes familiares">
              <Textarea {...campo('family_history')} rows={2} />
            </Field>
            <Field label="Medicamentos em uso">
              <Textarea {...campo('medications')} rows={2} />
            </Field>
            <Field label="Alergias">
              <Textarea {...campo('allergies')} rows={2} />
            </Field>
            <Field label="Exame fisico">
              <Textarea {...campo('physical_exam')} rows={2} />
            </Field>
            <Field label="Diagnostico">
              <Textarea {...campo('diagnosis')} rows={2} />
            </Field>
            <Field label="Conclusao">
              <Textarea {...campo('conclusion')} rows={2} />
            </Field>
            <Field label="Conduta">
              <Textarea {...campo('conduct')} rows={2} />
            </Field>
            <Field label="Recomendacoes">
              <Textarea {...campo('recommendations')} rows={2} />
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
              {/*
                `required` no campo: a asterisco do rotulo prometia uma
                validacao que so existia no servidor. O medico so descobria
                que faltava o parecer depois de mandar a ficha inteira e
                receber a recusa no topo da tela, tres rolagens acima do
                botao.
              */}
              <Select {...campo('verdict')} required>
                <option value="">Selecione</option>
                <option value="apto">Apto</option>
                <option value="apto_com_restricoes">Apto com restrições</option>
                <option value="inapto">Inapto</option>
                <option value="inconclusivo">Inconclusivo</option>
              </Select>
            </Field>
            <Field label="Validade">
              <Input type="date" {...campo('valid_until')} />
            </Field>
            {/*
              "no parecer do aso precisa incluir as opcs 'Apto para trabalho
               em altura', 'Apto para trabalho com Eletricidade'"
                                                  — Isabella, 23/09.

              Ficam ao lado da conclusão, e não dentro dela: são aptidões
              ADICIONAIS. Quem trabalha em altura é apto para a função E,
              além disso, liberado para altura. Como opções da mesma caixa,
              o A.S.O. deixaria de dizer se a pessoa está apta ao cargo.
            */}
            <Field label="Aptidões específicas" hint="Saem marcadas no parecer do A.S.O.">
              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="apto_altura"
                    value="on"
                    checked={aptoAltura}
                    onChange={(e) => setAptoAltura(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Apto para trabalho em altura
                    <span className="ml-1 text-xs text-slate-500">(NR-35)</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="apto_eletricidade"
                    value="on"
                    checked={aptoEletricidade}
                    onChange={(e) => setAptoEletricidade(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Apto para trabalho com eletricidade
                    <span className="ml-1 text-xs text-slate-500">(NR-10)</span>
                  </span>
                </label>
              </div>
            </Field>
            <Field label="Restricoes">
              <Input {...campo('restrictions')} />
            </Field>
          </div>

          {/*
            O procedimento saiu daqui em 22/09. "essa opcao nos selecionamos
            na recepcao, e deve mostrar pro medico apenas o que foi
            selecionado, sem opcao de alterar" — Isabella. Ele agora aparece
            ao lado do nome do paciente, como informacao.
          */}

          <Field label="Observacoes">
            <Textarea {...campo('observations')} rows={2} />
          </Field>

          {/*
            Quem assina o A.S.O. e quem esta logado. A escolha saiu em
            22/09: "se estou logada como dra wania, automaticamente ela
            assinara". Alem de ser o que a clinica pediu, e o unico modelo
            honesto — ninguem assina documento medico no lugar de outro.
          */}
          {assinante && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              O A.S.O. sairá assinado por <strong>{assinante.nome}</strong>
              {assinante.registro ? ` — ${assinante.registro}` : ''}.
              {assinante.temAssinatura
                ? ''
                : ' Nenhuma assinatura foi registrada ainda: cadastre a sua em Perfil.'}
            </p>
          )}

          {/*
            A recusa repetida ao lado do botao.

            O `<Alert>` do topo fica tres rolagens acima daqui: o medico
            clicava em "Finalizar consulta", o botao piscava, e nada
            acontecia na parte visivel da tela. Ele clicava de novo — e cada
            clique e uma tentativa de assinar A.S.O.
          */}
          {state && !state.ok && (
            <Alert variant="error">{state.error}</Alert>
          )}

          <div className="flex gap-2">
            {/*
              `formNoValidate`: o rascunho salva o que estiver na tela, com ou
              sem conclusao de aptidao. E justamente para isso que ele existe —
              o medico guarda a ficha no meio da consulta e volta depois.
              So o "Finalizar" exige o parecer.
            */}
            <Button type="submit" variant="outline" loading={pending} formNoValidate>
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
