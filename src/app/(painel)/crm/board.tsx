'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ShoppingBag } from 'lucide-react';
import { Alert, Badge } from '@/components/ui';
import { elapsedFrom, formatTime } from '@/lib/format';
import { moveAttendanceStage } from '@/modules/queue/actions';
import { trilhaDoAtendimento, type TrilhaCompleta } from '@/modules/guide/trilha-actions';
import { PainelDaTrilha } from '@/app/(painel)/jornada/mapa';
import type { CrmStage } from '@/types/entities';
import type { CrmCard } from './types';

export function CrmBoard({
  stages,
  cards,
  canMove,
}: {
  stages: CrmStage[];
  cards: CrmCard[];
  canMove: boolean;
}) {
  const [items, setItems] = useState(cards);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [trilha, setTrilha] = useState<TrilhaCompleta | null>(null);
  const [, startTransition] = useTransition();

  // Clicar no cartao abre a trilha: por onde o paciente passou, quanto
  // tempo em cada etapa e qual o proximo passo.
  const abrirTrilha = (attendanceId: string) =>
    startTransition(async () => {
      const r = await trilhaDoAtendimento(attendanceId);
      if (r.ok && r.data) setTrilha(r.data);
      else if (!r.ok) setMessage({ ok: false, text: r.error });
    });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byStage = useMemo(() => {
    const map = new Map<string, CrmCard[]>();
    for (const s of stages) map.set(s.code, []);
    for (const c of items) {
      if (!map.has(c.stage_code)) map.set(c.stage_code, []);
      map.get(c.stage_code)!.push(c);
    }
    return map;
  }, [items, stages]);

  // Etapas finais so ocupam espaco quando tem alguem nelas; o fluxo ativo
  // aparece sempre, mesmo vazio, para servir de alvo do arrastar.
  const visiveis = useMemo(
    () => stages.filter((s) => !s.is_terminal || (byStage.get(s.code)?.length ?? 0) > 0),
    [stages, byStage],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const cardId = String(event.active.id);
    const targetStage = event.over ? String(event.over.id) : null;
    if (!targetStage) return;

    const card = items.find((c) => c.id === cardId);
    if (!card || card.stage_code === targetStage) return;

    const previous = items;
    setItems((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, stage_code: targetStage, stage_changed_at: new Date().toISOString() }
          : c,
      ),
    );

    startTransition(async () => {
      const result = await moveAttendanceStage(cardId, targetStage, 'Movido pelo CRM');
      if (!result.ok) {
        setItems(previous);
        setMessage({ ok: false, text: result.error });
      } else {
        setMessage({ ok: true, text: result.message ?? 'Paciente movido.' });
      }
    });
  };

  return (
    <div>
      {message && (
        <div className="mb-3">
          <Alert variant={message.ok ? 'success' : 'error'}>{message.text}</Alert>
        </div>
      )}
      {!canMove && (
        <p className="mb-3 text-xs text-slate-500">
          Seu perfil visualiza o quadro, mas nao pode mover cartoes manualmente.
        </p>
      )}

      <DndContext sensors={sensors} onDragEnd={canMove ? handleDragEnd : undefined}>
        {/* Grade fluida: as colunas dividem a largura e quebram para a linha
            de baixo em telas estreitas. Nunca ha rolagem horizontal. */}
        <div
          className="grid items-start gap-2 pb-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(124px, 1fr))' }}
        >
          {visiveis.map((stage) => (
            <StageColumn
              key={stage.code}
              stage={stage}
              cards={byStage.get(stage.code) ?? []}
              canMove={canMove}
              onAbrirTrilha={abrirTrilha}
            />
          ))}
        </div>
      </DndContext>

      {trilha && <PainelDaTrilha dados={trilha} onFechar={() => setTrilha(null)} />}
    </div>
  );
}

function StageColumn({
  stage,
  cards,
  canMove,
  onAbrirTrilha,
}: {
  stage: CrmStage;
  cards: CrmCard[];
  canMove: boolean;
  onAbrirTrilha: (attendanceId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.code });

  return (
    <div
      ref={setNodeRef}
      data-guia="coluna-crm"
      className={`flex min-w-0 flex-col rounded-xl border bg-slate-100/60 ${
        isOver ? 'border-slate-400 bg-slate-200/70' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5 border-b border-slate-200 px-2 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
          <span className="truncate text-[11px] leading-tight font-medium text-slate-800" title={stage.name}>
            {stage.name}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-white px-1.5 text-[10px] font-bold text-slate-600">
          {cards.length}
        </span>
      </div>

      {/* Sem altura maxima: a coluna cresce e quem rola e a pagina. */}
      <div className="flex-1 space-y-1.5 p-1.5">
        {cards.length === 0 && <p className="py-5 text-center text-[10px] text-slate-400">—</p>}
        {cards.map((card) => (
          <KanbanCard
            key={card.id}
            card={card}
            color={stage.color}
            draggable={canMove}
            onAbrirTrilha={onAbrirTrilha}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  color,
  draggable,
  onAbrirTrilha,
}: {
  card: CrmCard;
  color: string;
  draggable: boolean;
  onAbrirTrilha: (attendanceId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });

  const done = card.patient_exams.filter((e) => e.status === 'concluído').length;
  const total = card.patient_exams.length;

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...attributes}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        borderLeftColor: color,
        opacity: isDragging ? 0.6 : 1,
      }}
      data-guia="cartao-crm"
      // Clique abre a trilha; arrastar continua funcionando porque o
      // dnd-kit só ativa depois de 6px de movimento.
      onClick={() => onAbrirTrilha(card.id)}
      className={`rounded-lg border border-l-[3px] border-slate-200 bg-white p-2 shadow-sm ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
      title={`${card.patients?.full_name ?? ''} — clique para ver por onde passou`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="truncate text-[11.5px] leading-tight font-semibold text-slate-900">
          {card.patients?.full_name ?? '—'}
        </p>
        <span className="shrink-0 font-mono text-[11px] font-bold text-slate-700">
          {card.queue_tickets[0]?.code ?? '—'}
        </span>
      </div>

      <p className="truncate text-[10px] text-slate-500">
        {card.companies?.trade_name ?? card.companies?.legal_name ?? 'Sem empresa'}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {card.order_id && (
          <Badge color="#0EA5E9">
            <ShoppingBag className="h-3 w-3" /> pedido
          </Badge>
        )}
        {total > 0 && (
          <Badge color={done === total ? '#22C55E' : '#FB923C'}>
            exames {done}/{total}
          </Badge>
        )}
        {card.payment_status !== 'pago' && <Badge color="#9CA3AF">{card.payment_status}</Badge>}
      </div>

      <div className="mt-1.5 flex justify-between gap-1 text-[9.5px] text-slate-400">
        <span>{formatTime(card.checkin_at)}</span>
        <span className="truncate">{elapsedFrom(card.stage_changed_at)}</span>
      </div>
    </div>
  );
}
