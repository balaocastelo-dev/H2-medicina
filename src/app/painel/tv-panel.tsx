'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatTime } from '@/lib/format';
import { escolherVoz, prepararParaFala } from '@/modules/greeting/voice';

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
  // Navegadores bloqueiam áudio ate haver um gesto do usuário. Numa TV isso
  // significa silencio para sempre — por isso a tela pede um clique inicial.
  const [somLiberado, setSomLiberado] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
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

  /** Gongo curto antes da chamada, sintetizado na hora (sem arquivo). */
  const tocarGongo = useCallback(() => {
    try {
      const ctxAudio =
        audioRef.current ??
        new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioRef.current = ctxAudio;
      if (ctxAudio.state === 'suspended') void ctxAudio.resume();

      const agora = ctxAudio.currentTime;
      [880, 1320].forEach((frequencia, i) => {
        const osc = ctxAudio.createOscillator();
        const ganho = ctxAudio.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequencia;
        const inicio = agora + i * 0.18;
        ganho.gain.setValueAtTime(0, inicio);
        ganho.gain.linearRampToValueAtTime(volume * 0.5, inicio + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.45);
        osc.connect(ganho).connect(ctxAudio.destination);
        osc.start(inicio);
        osc.stop(inicio + 0.5);
      });
    } catch {
      /* sem audio disponivel: a chamada continua visivel na tela */
    }
  }, [volume]);

  /** Anuncia senha, nome e sala. */
  const anunciar = useCallback(
    (chamada: CallRow) => {
      if (!sound || typeof window === 'undefined') return;
      tocarGongo();

      const sintese = window.speechSynthesis;
      if (!sintese) return;

      // Uma unica locucao: o sintetizador constroi a entonacao da frase
      // inteira. Dividir em pedacos deixava a fala picada e sem melodia.
      const senhaSoletrada = chamada.ticket_code.split('').join(' ');
      const nome = showName && chamada.patient_label ? `${chamada.patient_label}. ` : '';
      const sala = chamada.room_name ? `Compareça à ${chamada.room_name}.` : '';
      const texto = `Senha ${senhaSoletrada}. ${nome}${sala}`.trim();

      const escolhida = escolherVoz(sintese.getVoices(), null);
      sintese.cancel();

      // A fala comeca depois do gongo.
      window.setTimeout(() => {
        const fala = new SpeechSynthesisUtterance(prepararParaFala(texto));
        if (escolhida) fala.voice = escolhida;
        fala.lang = escolhida?.lang ?? 'pt-BR';
        fala.rate = 0.9;
        fala.pitch = 1;
        fala.volume = Math.min(Math.max(volume, 0), 1);
        sintese.speak(fala);
      }, 750);
    },
    [sound, showName, volume, tocarGongo],
  );

  useEffect(() => {
    const atual = calls[0];
    if (!atual || atual.id === lastAnnounced.current) return;
    lastAnnounced.current = atual.id;
    if (somLiberado) anunciar(atual);
  }, [calls, somLiberado, anunciar]);

  const current = calls[0];
  const history = calls.slice(1, historySize + 1);

  return (
    <main
      className="kiosk relative flex min-h-screen flex-col bg-slate-950 text-white"
      style={{ ['--brand-primary' as string]: primaryColor }}
    >
      {!somLiberado && sound && (
        <button
          type="button"
          onClick={() => {
            setSomLiberado(true);
            tocarGongo();
            const atual = calls[0];
            if (atual) {
              lastAnnounced.current = atual.id;
              anunciar(atual);
            }
          }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 text-white"
        >
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-5xl">
            🔊
          </span>
          <span className="text-3xl font-semibold">Toque para ativar o som</span>
          <span className="max-w-md text-center text-slate-400">
            O navegador exige um clique antes de liberar o audio. Depois disso o painel anuncia
            sozinho cada chamada.
          </span>
        </button>
      )}

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
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm tracking-widest text-slate-400 uppercase">Últimas chamadas</p>
          {somLiberado && current && (
            <button
              type="button"
              onClick={() => anunciar(current)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/20"
            >
              🔊 Repetir chamada
            </button>
          )}
        </div>
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
