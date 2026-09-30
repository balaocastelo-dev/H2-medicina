'use client';

import { FileWarning } from 'lucide-react';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui';
import { FichaDeExameForm } from '@/modules/clinical/ficha-de-exame';
import type { QueueExam } from './types';

/**
 * Exames concluídos cuja ficha ficou em branco.
 *
 * ---------------------------------------------------------------------
 * O beco sem saída que isto resolve
 * ---------------------------------------------------------------------
 * O quadro de salas só carrega exame em `pendente`, `em_fila`, `chamado` ou
 * `em_andamento`. Concluído o exame sem preencher a ficha — acontece: a
 * examinadora conclui para liberar a sala e volta para digitar depois —,
 * o cartão sumia da tela e **não existia nenhum lugar no sistema para
 * reabrir aquele formulário**.
 *
 * E o laudo recusa, com razão, exame sem nenhuma medição gravada: documento
 * em branco assinado é pior do que documento nenhum. Então o laudo passava a
 * ser inemitível para sempre, e a resposta era sempre a mesma frase, sem
 * dizer onde resolver.
 *
 * Aqui o exame reaparece com a ficha aberta, até ela ser preenchida. Depois
 * disso ele sai daqui sozinho.
 */
export function ExamesSemFicha({ exames }: { exames: QueueExam[] }) {
  if (exames.length === 0) return null;

  return (
    <Card className="mb-4 border-sky-300">
      <CardHeader
        title="Exames concluídos com a ficha em branco"
        description="O laudo destes exames não pode ser emitido enquanto a ficha não for preenchida"
        action={<FileWarning className="h-5 w-5 text-sky-500" />}
      />
      <CardBody className="space-y-3">
        <Alert variant="info">
          O exame já foi concluído e a sala já está livre. Preencha a ficha para o laudo poder sair
          — assim que salvar, o cartão some daqui.
        </Alert>

        {exames.map((exame) => (
          <div key={exame.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {exame.attendances?.queue_tickets?.[0]?.code ?? '—'} ·{' '}
                {exame.attendances?.patients?.full_name ?? 'Paciente'}
              </p>
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {exame.exam_types?.name ?? 'Exame'}
              </p>
            </div>

            <FichaDeExameForm
              key={exame.id}
              patientExamId={exame.id}
              codigoExame={exame.exam_types?.code}
              valoresIniciais={exame.exam_results?.[0]?.values ?? {}}
              conclusaoInicial={exame.exam_results?.[0]?.conclusion ?? ''}
            />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
