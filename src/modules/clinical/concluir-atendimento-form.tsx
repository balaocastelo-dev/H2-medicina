'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { saveConsultation } from './actions';
import type { ActionResult } from '@/lib/action-result';

/**
 * Tela do medico para pericia e SISPER: so concluir.
 *
 * "todas as perguntas de ficha clinica e apto, da aba modulo medico, nao
 *  aparecam e seja apenas 'chamar' e 'concluir atendimento'" -- Isa, 26/10.
 *
 * O "chamar" ja existe na lista do modulo medico. Aqui fica o "concluir": o
 * mesmo `saveConsultation` da consulta completa, que no servidor reconhece a
 * procedencia e dispensa o parecer. A consulta e gravada com o medico, o
 * repasse e lancado e o paciente segue o caminho de sempre.
 */
export function ConcluirAtendimentoForm({
  attendanceId,
  procedencia,
  jaConcluido,
}: {
  attendanceId: string;
  procedencia: string;
  jaConcluido: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveConsultation,
    null,
  );
  const router = useRouter();

  useEffect(() => {
    if (!state?.ok) return;
    const t = setTimeout(() => {
      router.push('/medico');
      router.refresh();
    }, 1500);
    return () => clearTimeout(t);
  }, [state, router]);

  return (
    <Card>
      <CardHeader
        title={`Atendimento de ${procedencia}`}
        description="Sem ficha clínica nem parecer de aptidão. Conclua quando terminar o atendimento."
      />
      <CardBody className="space-y-3">
        {state?.ok && <Alert variant="success">{state.message}</Alert>}
        {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

        {jaConcluido ? (
          <Alert variant="info">Este atendimento já foi concluído.</Alert>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="attendance_id" value={attendanceId} />
            <Button
              type="submit"
              name="finalizar"
              value="sim"
              loading={pending}
              disabled={pending || state?.ok}
            >
              <CheckCircle2 className="h-4 w-4" /> Concluir atendimento
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
