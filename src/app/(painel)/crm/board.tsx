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
import { AlertTriangle, ShoppingBag } from 'lucide-react';
import { Alert, Badge } from '@/components/ui';
import { elapsedFrom, formatTime } from '@/lib/format';
import { moveAttendanceStage } from '@/modules/queue/actions';
import type { CrmStage } from '@/types/entities';
import type { CrmCard } from './page';

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
  const [, startTransition] = useTransition();
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
        <div className="flex scrollbar-thin gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.code}
              stage={stage}
              cards={byStage.get(stage.code) ?? []}
              canMove={canMove}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function StageColumn({
  stage,
  cards,
  canMove,
}: {
  stage: CrmStage;
  cards: CrmCard[];
  canMove: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.code });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl border bg-slate-100/60 ${
        isOver ? 'border-slate-400 bg-slate-200/70' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-medium text-slate-800">{stage.name}</span>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
          {cards.length}
        </span>
      </div>

      <div
        className="flex-1 scrollbar-thin space-y-2 overflow-y-auto p-2"
        style={{ maxHeight: '70vh' }}
      >
        {cards.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Sem pacientes</p>
        )}
        {cards.map((card) => (
          <KanbanCard key={card.id} card={card} color={stage.color} draggable={canMove} />
        ))}
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  color,
  draggable,
}: {
  card: CrmCard;
  color: string;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });

  const done = card.patient_exams.filter((e) => e.status === 'concluido').length;
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
      className={`rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-900">
          {card.patients?.full_name ?? '—'}
        </p>
        <span className="font-mono text-sm font-bold text-slate-700">
          {card.queue_tickets[0]?.code ?? '—'}
        </span>
      </div>

      <p className="truncate text-xs text-slate-500">
        {card.companies?.trade_name ?? card.companies?.legal_name ?? 'Sem empresa'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {card.priority !== 'normal' && (
          <Badge color="#EF4444">
            <AlertTriangle className="h-3 w-3" /> {card.priority}
          </Badge>
        )}
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

      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>chegada {formatTime(card.checkin_at)}</span>
        <span>na etapa {elapsedFrom(card.stage_changed_at)}</span>
      </div>
    </div>
  );
}
