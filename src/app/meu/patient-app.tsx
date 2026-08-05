'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  CalendarPlus, CheckCircle2, Circle, FileText, Loader2, Receipt, Route, Stethoscope,
} from 'lucide-react';
import {
  agendarAtendimento, baixarDocumento, obterPortal, opcoesDeAgendamento,
  type OpcoesAgendamento, type PortalPaciente,
} from './actions';
import { formatCPF, formatDate, formatDateTime, formatMoney, formatTime } from '@/lib/format';

const ETAPAS = [
  { code: 'agendado', label: 'Agendamento' },
  { code: 'aguardando_recepcao', label: 'Totem' },
  { code: 'na_recepcao', label: 'Recepção' },
  { code: 'em_triagem', label: 'Triagem' },
  { code: 'em_exames', label: 'Exames' },
  { code: 'em_consulta', label: 'Médico' },
  { code: 'aguardando_pagamento', label: 'Pagamento' },
  { code: 'aguardando_documentos', label: 'Documentos' },
  { code: 'finalizado', label: 'Finalizado' },
];

const ORDEM: Record<string, number> = {
  agendado: 0, checkin: 1, aguardando_recepcao: 1, na_recepcao: 2,
  aguardando_triagem: 3, em_triagem: 3, aguardando_exames: 4, em_exames: 4,
  aguardando_medico: 5, em_consulta: 5, aguardando_pagamento: 6,
  aguardando_documentos: 7, finalizado: 8,
};

type Aba = 'jornada' | 'exames' | 'recibos' | 'documentos' | 'agendar';

export function PatientApp({
  systemName,
  logoUrl,
  primaryColor,
}: {
  systemName: string;
  logoUrl: string | null;
  primaryColor: string;
}) {
  const [cpf, setCpf] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [portal, setPortal] = useState<PortalPaciente | null>(null);
  const [aba, setAba] = useState<Aba>('jornada');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  // Enquanto o atendimento estiver aberto, a etapa se atualiza sozinha.
  useEffect(() => {
    if (!portal?.temAtendimentoAberto) return;
    const timer = setInterval(() => {
      startTransition(async () => {
        const r = await obterPortal(cpf, nascimento);
        if (r.ok && r.data) setPortal(r.data);
      });
    }, 20000);
    return () => clearInterval(timer);
  }, [portal?.temAtendimentoAberto, cpf, nascimento]);

  const entrar = () =>
    startTransition(async () => {
      setErro(null);
      const r = await obterPortal(cpf, nascimento);
      if (!r.ok) {
        setErro(r.error);
        setPortal(null);
        return;
      }
      setPortal(r.data ?? null);
      setAba(r.data?.temAtendimentoAberto ? 'jornada' : 'agendar');
    });

  const atual = portal ? (ORDEM[portal.etapa] ?? 0) : -1;

  if (!portal) {
    return (
      <Tela systemName={systemName} logoUrl={logoUrl} primaryColor={primaryColor}>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold">Acompanhe seu atendimento</h1>
          <p className="mb-4 text-sm text-slate-500">
            Informe seu CPF e data de nascimento para ver sua senha, exames, recibos e documentos —
            e para agendar um atendimento.
          </p>

          {erro && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">CPF</span>
            <input
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              inputMode="numeric"
              className="h-11 w-full rounded-lg border border-slate-300 px-3"
              placeholder="000.000.000-00"
            />
          </label>
          <label className="mb-4 block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Data de nascimento</span>
            <input
              type="date"
              value={nascimento}
              onChange={(e) => setNascimento(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-300 px-3"
            />
          </label>

          <button
            type="button"
            onClick={entrar}
            disabled={pendente || cpf.replace(/\D/g, '').length !== 11 || !nascimento}
            className="h-12 w-full rounded-lg font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: primaryColor }}
          >
            {pendente ? 'Consultando...' : 'Entrar'}
          </button>
        </div>
      </Tela>
    );
  }

  const abas: { id: Aba; icone: React.ReactNode; texto: string; n?: number }[] = [
    { id: 'jornada', icone: <Route className="h-4 w-4" />, texto: 'Jornada' },
    { id: 'exames', icone: <Stethoscope className="h-4 w-4" />, texto: 'Exames', n: portal.exames.length },
    { id: 'recibos', icone: <Receipt className="h-4 w-4" />, texto: 'Recibos', n: portal.recibos.length },
    { id: 'documentos', icone: <FileText className="h-4 w-4" />, texto: 'Documentos', n: portal.documentos.length },
    { id: 'agendar', icone: <CalendarPlus className="h-4 w-4" />, texto: 'Agendar' },
  ];

  return (
    <Tela systemName={systemName} logoUrl={logoUrl} primaryColor={primaryColor}>
      {portal.temAtendimentoAberto && (
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
          <p className="text-[10.5px] tracking-[0.16em] text-slate-500 uppercase">Sua senha</p>
          <p className="my-1 text-5xl font-black" style={{ color: primaryColor }}>
            {portal.senha ?? '—'}
          </p>
          <p className="text-sm font-medium">{portal.nome}</p>
          <p className="text-xs text-slate-500">{formatCPF(cpf)}</p>
          {portal.sala && (
            <p className="mt-3 rounded-lg bg-slate-100 p-2 text-sm">
              Dirija-se à <b>{portal.sala}</b>
            </p>
          )}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`flex flex-1 shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[11px] font-medium transition ${
              aba === a.id ? 'text-white' : 'text-slate-600'
            }`}
            style={aba === a.id ? { backgroundColor: primaryColor } : undefined}
          >
            {a.icone}
            <span>
              {a.texto}
              {a.n ? ` (${a.n})` : ''}
            </span>
          </button>
        ))}
      </div>

      {aviso && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</div>
      )}

      {aba === 'jornada' && (
        <Cartao titulo="Sua jornada">
          {!portal.temAtendimentoAberto && (
            <p className="mb-3 rounded-lg bg-slate-100 p-2 text-sm text-slate-600">
              Nenhum atendimento em andamento.
            </p>
          )}
          <ol className="space-y-2.5">
            {ETAPAS.map((e, i) => {
              const feito = i < atual;
              const agora = i === atual && portal.temAtendimentoAberto;
              return (
                <li key={e.code} className="flex items-center gap-3">
                  {feito ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : agora ? (
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: primaryColor }} />
                  ) : (
                    <Circle className="h-5 w-5 text-slate-300" />
                  )}
                  <span className={agora ? 'font-semibold' : feito ? 'text-slate-600' : 'text-slate-400'}>
                    {e.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {portal.chegadaEm && (
            <p className="mt-3 text-xs text-slate-400">
              Check-in: {formatDateTime(portal.chegadaEm)}
            </p>
          )}
        </Cartao>
      )}

      {aba === 'exames' && (
        <Cartao titulo="Seus exames">
          {portal.exames.length === 0 ? (
            <Vazio texto="Nenhum exame registrado." />
          ) : (
            <ul className="space-y-2 text-sm">
              {portal.exames.map((e, i) => (
                <li key={i} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{e.nome}</span>
                    <span className={e.status === 'concluido' ? 'text-emerald-600' : 'text-slate-400'}>
                      {e.status === 'concluido' ? 'concluído' : e.status.replace('_', ' ')}
                    </span>
                  </div>
                  {e.concluidoEm && (
                    <p className="text-xs text-slate-400">{formatDateTime(e.concluidoEm)}</p>
                  )}
                  {e.conclusao && <p className="mt-1 text-xs text-slate-600">{e.conclusao}</p>}
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      {aba === 'recibos' && (
        <Cartao titulo="Pagamentos">
          {portal.recibos.length === 0 ? (
            <Vazio texto="Nenhum pagamento registrado." />
          ) : (
            <ul className="space-y-2 text-sm">
              {portal.recibos.map((r) => (
                <li key={r.id} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.descricao}</span>
                    <span className="font-semibold tabular-nums">{formatMoney(r.valor)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500">{r.metodo}</span>
                    <span className={r.status === 'pago' ? 'text-emerald-600' : 'text-amber-600'}>
                      {r.status === 'pago'
                        ? `pago em ${formatDate(r.pagoEm)}`
                        : r.status.replace('_', ' ')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      {aba === 'documentos' && (
        <Cartao titulo="Documentos">
          {portal.documentos.length === 0 ? (
            <Vazio texto="Nenhum documento disponível ainda." />
          ) : (
            <ul className="space-y-2 text-sm">
              {portal.documentos.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.titulo}</p>
                    <p className="text-xs text-slate-400">
                      {formatDate(d.emitidoEm)}
                      {d.codigoVerificacao ? ` · ${d.codigoVerificacao}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pendente}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await baixarDocumento(cpf, nascimento, d.id);
                        if (r.ok && r.data) window.open(r.data.url, '_blank', 'noopener');
                        else if (!r.ok) setErro(r.error);
                      })
                    }
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Abrir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      {aba === 'agendar' && (
        <Agendar
          cpf={cpf}
          nascimento={nascimento}
          primaryColor={primaryColor}
          agendamentos={portal.agendamentos}
          aoAgendar={(texto) => {
            setAviso(texto);
            startTransition(async () => {
              const r = await obterPortal(cpf, nascimento);
              if (r.ok && r.data) setPortal(r.data);
            });
          }}
        />
      )}

      <button
        type="button"
        onClick={() => {
          setPortal(null);
          setCpf('');
          setNascimento('');
          setAviso(null);
        }}
        className="h-11 w-full rounded-lg border border-slate-300 bg-white text-sm font-medium"
      >
        Sair
      </button>
    </Tela>
  );
}

/* ------------------------------------------------------------------ auxiliares */

function Tela({
  children,
  systemName,
  logoUrl,
  primaryColor,
}: {
  children: React.ReactNode;
  systemName: string;
  logoUrl: string | null;
  primaryColor: string;
}) {
  return (
    <main className="min-h-screen bg-slate-50" style={{ ['--brand-primary' as string]: primaryColor }}>
      <header className="px-5 py-5 text-white" style={{ backgroundColor: primaryColor }}>
        <div className="mx-auto flex max-w-md items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={systemName} className="h-9 object-contain" />
          ) : (
            <span className="text-lg font-bold">{systemName}</span>
          )}
        </div>
      </header>
      <div className="mx-auto flex max-w-md flex-col gap-3 p-4">{children}</div>
    </main>
  );
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="mb-3 text-sm font-semibold">{titulo}</p>
      {children}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="py-4 text-center text-sm text-slate-400">{texto}</p>;
}

function Agendar({
  cpf,
  nascimento,
  primaryColor,
  agendamentos,
  aoAgendar,
}: {
  cpf: string;
  nascimento: string;
  primaryColor: string;
  agendamentos: PortalPaciente['agendamentos'];
  aoAgendar: (texto: string) => void;
}) {
  const [opcoes, setOpcoes] = useState<OpcoesAgendamento | null>(null);
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');
  const [exames, setExames] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const r = await opcoesDeAgendamento();
      if (r.ok && r.data) setOpcoes(r.data);
    });
  }, []);

  const ocupados = data ? (opcoes?.ocupados[data] ?? []) : [];
  const total = (opcoes?.exames ?? [])
    .filter((e) => exames.includes(e.id))
    .reduce((s, e) => s + e.preco, 0);

  const proximosDias = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  }).filter((iso) => {
    const dia = new Date(`${iso}T12:00:00-03:00`).getDay();
    return dia !== 0 && dia !== 6; // sem fim de semana
  });

  return (
    <>
      {agendamentos.length > 0 && (
        <Cartao titulo="Seus agendamentos">
          <ul className="space-y-2 text-sm">
            {agendamentos.map((a) => (
              <li key={a.id} className="border-b border-slate-100 pb-2 last:border-0">
                <p className="font-medium">
                  {formatDate(a.quando)} às {formatTime(a.quando)}
                </p>
                <p className="text-xs text-slate-500">
                  {a.exames.join(', ') || a.tipo} · {a.status}
                </p>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <Cartao titulo="Agendar atendimento">
        {erro && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <p className="mb-2 text-xs font-medium text-slate-600">1. Escolha os exames</p>
        <div className="mb-4 space-y-1.5">
          {(opcoes?.exames ?? []).map((e) => (
            <label
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={exames.includes(e.id)}
                  onChange={(ev) =>
                    setExames((p) => (ev.target.checked ? [...p, e.id] : p.filter((x) => x !== e.id)))
                  }
                />
                <span className="truncate">{e.nome}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{formatMoney(e.preco)}</span>
            </label>
          ))}
          {opcoes?.exames.length === 0 && <Vazio texto="Nenhum exame disponível online." />}
        </div>

        <p className="mb-2 text-xs font-medium text-slate-600">2. Escolha o dia</p>
        <div className="mb-4 grid grid-cols-4 gap-1.5">
          {proximosDias.slice(0, 20).map((iso) => {
            const d = new Date(`${iso}T12:00:00-03:00`);
            const escolhido = data === iso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => {
                  setData(iso);
                  setHora('');
                }}
                className={`rounded-lg border p-1.5 text-center text-xs ${
                  escolhido ? 'border-transparent text-white' : 'border-slate-200 bg-white'
                }`}
                style={escolhido ? { backgroundColor: primaryColor } : undefined}
              >
                <span className="block text-[9px] uppercase opacity-70">
                  {new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(d)}
                </span>
                <span className="block font-bold">{d.getDate()}</span>
              </button>
            );
          })}
        </div>

        {data && (
          <>
            <p className="mb-2 text-xs font-medium text-slate-600">3. Escolha o horário</p>
            <div className="mb-4 grid grid-cols-4 gap-1.5">
              {(opcoes?.horarios ?? []).map((h) => {
                const tomado = ocupados.includes(h);
                const escolhido = hora === h;
                return (
                  <button
                    key={h}
                    type="button"
                    disabled={tomado}
                    onClick={() => setHora(h)}
                    className={`rounded-lg border p-1.5 text-xs ${
                      tomado
                        ? 'border-slate-100 bg-slate-100 text-slate-300 line-through'
                        : escolhido
                          ? 'border-transparent text-white'
                          : 'border-slate-200 bg-white'
                    }`}
                    style={escolhido && !tomado ? { backgroundColor: primaryColor } : undefined}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {total > 0 && (
          <p className="mb-3 rounded-lg bg-slate-100 p-2 text-center text-sm">
            Valor estimado: <b>{formatMoney(total)}</b>
          </p>
        )}

        <button
          type="button"
          disabled={pendente || !data || !hora || exames.length === 0}
          onClick={() =>
            startTransition(async () => {
              setErro(null);
              const r = await agendarAtendimento({
                cpf,
                nascimento,
                data,
                hora,
                examTypeIds: exames,
              });
              if (!r.ok) {
                setErro(r.error);
                return;
              }
              setData('');
              setHora('');
              setExames([]);
              aoAgendar(r.message ?? 'Agendamento confirmado!');
            })
          }
          className="h-12 w-full rounded-lg font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: primaryColor }}
        >
          {pendente ? 'Agendando...' : 'Confirmar agendamento'}
        </button>
      </Cartao>
    </>
  );
}
