'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Undo2 } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { moveAttendanceStage } from '@/modules/queue/actions';

const ETAPAS: Record<string, string> = {
  aguardando_recepcao: 'aguardando recepção',
  na_recepcao: 'na recepção',
  aguardando_triagem: 'aguardando triagem',
  em_triagem: 'em triagem',
  aguardando_medico: 'aguardando médico',
  em_consulta: 'em consulta',
  aguardando_documentos: 'aguardando documentos',
};

/**
 * Exames pendentes de pacientes que estão em outra etapa.
 *
 * Acontece quando alguém adianta o cartão no CRM sem concluir os exames: eles
 * ficam sem fila, invisíveis para quem opera as salas. Aqui eles aparecem, com
 * um atalho para devolver o paciente à fila de exames.
 */
export function ExamesForaDaFila({
  itens,
}: {
  itens: [string, { nome: string; etapa: string; exames: string[] }][];
}) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, startTransition] = useTransition();

  return (
    <Card className="border-amber-300">
      <CardHeader
        title="Exames pendentes fora da fila"
        description="Estes pacientes têm exames por fazer, mas estão em outra etapa — por isso não aparecem em nenhuma sala"
        action={<AlertTriangle className="h-5 w-5 text-amber-500" />}
      />
      <CardBody className="space-y-3">
        {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.texto}</Alert>}

        {itens.map(([id, item]) => (
          <div
            key={id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.nome}</p>
              <p className="text-xs text-slate-500">
                {ETAPAS[item.etapa] ?? item.etapa} · faltam: {item.exames.join(', ')}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={pendente}
              onClick={() =>
                startTransition(async () => {
                  const r = await moveAttendanceStage(
                    id,
                    'aguardando_exames',
                    'Devolvido às filas: havia exames pendentes',
                  );
                  setMsg({
                    ok: r.ok,
                    texto: r.ok ? `${item.nome} voltou para a fila de exames.` : r.error,
                  });
                })
              }
            >
              <Undo2 className="h-4 w-4" /> Devolver às filas
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
