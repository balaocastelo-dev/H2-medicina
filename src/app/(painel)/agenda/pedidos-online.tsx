'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Globe, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { formatCPF, formatDate, formatTime } from '@/lib/format';
import {
  confirmarPedidoOnline,
  recusarPedidoOnline,
} from '@/modules/scheduling/confirmacao-actions';

export interface PedidoOnline {
  id: string;
  scheduled_at: string;
  public_code: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  requested_at: string | null;
  notes: string | null;
  patients: { full_name: string; cpf: string | null } | null;
  appointment_exams: { exam_types: { name: string } | null }[];
}

/**
 * Pedidos vindos do site, esperando decisao da recepcao.
 *
 * Fica no alto da agenda porque e trabalho com prazo: o horario esta
 * reservado e ninguem mais consegue marcar nele enquanto isso.
 */
export function PedidosOnline({ pedidos }: { pedidos: PedidoOnline[] }) {
  const [lista, setLista] = useState(pedidos);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, startTransition] = useTransition();

  if (lista.length === 0) return null;

  const decidir = (id: string, acao: 'confirmar' | 'recusar') =>
    startTransition(async () => {
      const r =
        acao === 'confirmar'
          ? await confirmarPedidoOnline(id)
          : await recusarPedidoOnline(id, window.prompt('Motivo da recusa (opcional):') ?? '');

      setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Feito.') : r.error });
      if (r.ok) setLista((prev) => prev.filter((p) => p.id !== id));
    });

  return (
    <div className="mb-4">
      <Card className="border-sky-200">
        <CardHeader
          title="Pedidos de agendamento pelo site"
          description="O horário está reservado até você decidir"
          action={
            <Badge color="#0EA5E9">
              <Globe className="mr-1 inline h-3 w-3" />
              {lista.length} aguardando
            </Badge>
          }
        />
        <CardBody className="space-y-2">
          {mensagem && <Alert variant={mensagem.ok ? 'success' : 'error'}>{mensagem.texto}</Alert>}

          {lista.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {p.requester_name ?? p.patients?.full_name ?? 'Paciente'}
                  {p.public_code && (
                    <span className="ml-2 font-mono text-xs text-slate-500">{p.public_code}</span>
                  )}
                </p>
                <p className="text-xs text-slate-600">
                  {formatDate(p.scheduled_at)} às {formatTime(p.scheduled_at)}
                  {p.patients?.cpf && ` · ${formatCPF(p.patients.cpf)}`}
                  {p.requester_phone && ` · ${p.requester_phone}`}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {(p.appointment_exams ?? [])
                    .map((e) => e.exam_types?.name)
                    .filter(Boolean)
                    .join(', ') || 'sem exames informados'}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  loading={pendente}
                  onClick={() => decidir(p.id, 'confirmar')}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={pendente}
                  onClick={() => decidir(p.id, 'recusar')}
                >
                  <XCircle className="h-3.5 w-3.5" /> Recusar
                </Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
