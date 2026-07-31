'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTime } from '@/lib/format';

interface CallRow {
  id: string;
  ticket_code: string;
  patient_label: string | null;
  room_name: string | null;
  destination: string | null;
  priority: string;
  is_recall: boolean;
  called_at: string;
}

export function TvPanel({
  tenantId,
  initialCalls,
  systemName,
  logoUrl,
  primaryColor,
  historySize,
  sound,
  volume,
  showName,
}: {
  tenantId: string;
  initialCalls: CallRow[];
  systemName: string;
  logoUrl: string | null;
  primaryColor: string;
  historySize: number;
  sound: boolean;
  volume: number;
  showName: boolean;
}) {
  const [calls, setCalls] = useState<CallRow[]>(initialCalls);
  const [clock, setClock] = useState(() => new Date());
  const lastAnnounced = useRef<string | null>(initialCalls[0]?.id ?? null);
  const signatureRef = useRef(initialCalls.map((call) => call.id).join('|'));

  const syncCalls = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('tv_calls')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('called_at', { ascending: false })
      .limit(historySize + 1)
      .returns<CallRow[]>();

    if (error || !data) return;

    const nextSignature = data.map((call) => call.id).join('|');
    if (nextSignature === signatureRef.current) return;

    signatureRef.current = nextSignature;
    setCalls(data);
  }, [historySize, tenantId]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`tv-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tv_calls',
          filter: `tenant_id=eq.${tenantId}`,
        },
        async () => {
          await syncCalls();
        },
      )
      .subscribe();

    const timer = window.setInterval(() => {
      void syncCalls();
    }, 3000);

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [syncCalls, tenantId]);

  // Aviso sonoro + voz
  useEffect(() => {
    const current = calls[0];
    if (!current || current.id === lastAnnounced.current) return;
    lastAnnounced.current = current.id;
    if (!sound || typeof window === 'undefined' || !window.speechSynthesis) return;

    const spoken = `Senha ${current.ticket_code.split('').join(' ')}${
      current.room_name ? `, ${current.room_name}` : ''
    }`;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = 'pt-BR';
    utterance.volume = Math.min(Math.max(volume, 0), 1);
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [calls, sound, volume]);

  const current = calls[0];
  const history = calls.slice(1, historySize + 1);

  return (
    <main
      className="kiosk flex min-h-screen flex-col bg-slate-950 text-white"
      style={{ ['--brand-primary' as string]: primaryColor }}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div className="flex items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={systemName} className="h-12 object-contain" />
          ) : (
            <span className="text-2xl font-bold">{systemName}</span>
          )}
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tabular-nums">
            {clock.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </p>
          <p className="text-sm text-slate-400">
            {clock.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-8">
        {current ? (
          <div
            className="w-full max-w-4xl rounded-3xl p-12 text-center"
            style={{
              backgroundColor: current.priority !== 'normal' ? '#7f1d1d' : primaryColor,
            }}
          >
            <p className="text-2xl tracking-[0.3em] uppercase opacity-80">
              {current.is_recall ? 'Rechamada' : 'Senha'}
            </p>
            <p className="my-4 text-[10rem] leading-none font-black tracking-tight">
              {current.ticket_code}
            </p>
            {showName && current.patient_label && (
              <p className="text-3xl font-medium opacity-90">{current.patient_label}</p>
            )}
            <p className="mt-4 text-4xl font-semibold">
              {current.room_name ?? current.destination ?? 'Recepcao'}
            </p>
            {current.priority !== 'normal' && (
              <p className="mt-3 inline-block rounded-full bg-white/20 px-4 py-1 text-xl">
                Atendimento prioritario
              </p>
            )}
          </div>
        ) : (
          <p className="text-3xl text-slate-500">Aguardando chamadas...</p>
        )}
      </section>

      <footer className="border-t border-white/10 px-8 py-5">
        <p className="mb-3 text-sm tracking-widest text-slate-400 uppercase">Ultimas chamadas</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {history.length === 0 && <p className="text-slate-600">—</p>}
          {history.map((c) => (
            <div key={c.id} className="rounded-xl bg-white/5 p-3 text-center">
              <p className="text-3xl font-bold">{c.ticket_code}</p>
              <p className="truncate text-sm text-slate-400">
                {c.room_name ?? c.destination ?? '—'}
              </p>
              <p className="text-xs text-slate-500">{formatTime(c.called_at)}</p>
            </div>
          ))}
        </div>
      </footer>
    </main>
  );
}
