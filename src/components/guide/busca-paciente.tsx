'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';
import { Alert } from '@/components/ui';
import { formatCPF } from '@/lib/format';
import { etapaDe } from '@/modules/guide/etapas';
import {
  procurarPaciente,
  trilhaDoAtendimento,
  ultimoAtendimentoDoPaciente,
  type PacienteEncontrado,
  type TrilhaCompleta,
} from '@/modules/guide/trilha-actions';
import { TrilhaDoPaciente } from './trilha';

/**
 * Busca de paciente na barra superior.
 *
 * Existe para responder a pergunta que mais aparece no balcao: "cade o
 * fulano?". Digita o nome, ve onde a pessoa esta — sem abrir tela por tela.
 */
export function BuscaDePaciente() {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [resultados, setResultados] = useState<PacienteEncontrado[]>([]);
  const [detalhe, setDetalhe] = useState<TrilhaCompleta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const caixa = useRef<HTMLDivElement>(null);

  // Termo curto demais não consulta e não mostra nada. Derivar aqui, em vez
  // de limpar o estado num efeito, evita um render extra a cada tecla.
  const suficiente = termo.trim().length >= 3;
  const visiveis = suficiente ? resultados : [];

  // Espera a digitacao parar antes de consultar: cada tecla viraria uma
  // consulta ao banco.
  useEffect(() => {
    if (!suficiente) return;
    const t = window.setTimeout(() => {
      startTransition(async () => {
        const r = await procurarPaciente(termo);
        if (r.ok) {
          setResultados(r.data ?? []);
          setErro(null);
        } else {
          setErro(r.error);
        }
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [termo, suficiente]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const abrirTrilha = (p: PacienteEncontrado) =>
    startTransition(async () => {
      setErro(null);
      let attendanceId = p.attendanceId;

      // Buscou pelo cadastro: cai para a última visita registrada.
      if (!attendanceId) {
        const ultimo = await ultimoAtendimentoDoPaciente(p.patientId);
        attendanceId = ultimo.ok ? (ultimo.data?.attendanceId ?? null) : null;
      }

      if (!attendanceId) {
        setErro(`${p.nome} não tem nenhum atendimento registrado ainda.`);
        setDetalhe(null);
        return;
      }

      const r = await trilhaDoAtendimento(attendanceId);
      if (r.ok && r.data) setDetalhe(r.data);
      else if (!r.ok) setErro(r.error);
    });

  const limpar = () => {
    setTermo('');
    setResultados([]);
    setDetalhe(null);
    setErro(null);
  };

  return (
    <div ref={caixa} className="relative" data-guia="busca-paciente">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setDetalhe(null);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          placeholder="Onde está o paciente? Nome ou CPF"
          aria-label="Procurar paciente pelo nome ou CPF"
          className="w-44 rounded-lg border border-slate-200 py-1.5 pr-7 pl-8 text-sm transition focus:w-64 focus:ring-2 focus:ring-slate-200 focus:outline-none sm:w-56 sm:focus:w-72"
        />
        {termo && (
          <button
            type="button"
            onClick={limpar}
            aria-label="Limpar busca"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {aberto && termo.trim().length >= 3 && (
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          {erro && (
            <div className="mb-2">
              <Alert variant="error">{erro}</Alert>
            </div>
          )}

          {detalhe ? (
            <>
              <button
                type="button"
                onClick={() => setDetalhe(null)}
                className="mb-3 text-xs font-medium text-slate-500 underline hover:text-slate-700"
              >
                ← voltar aos resultados
              </button>
              <TrilhaDoPaciente dados={detalhe} />
            </>
          ) : pendente && visiveis.length === 0 ? (
            <p className="p-2 text-sm text-slate-500">Procurando…</p>
          ) : visiveis.length === 0 ? (
            <p className="p-2 text-sm text-slate-500">
              Ninguém encontrado com “{termo}”. Confira o nome ou tente pelo CPF.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visiveis.map((p) => {
                const etapa = p.stageCode ? etapaDe(p.stageCode) : null;
                return (
                  <li key={`${p.patientId}-${p.attendanceId ?? 'sem'}`}>
                    <button
                      type="button"
                      onClick={() => abrirTrilha(p)}
                      className="flex w-full items-center justify-between gap-3 p-2 text-left hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {p.nome}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {[p.cpf ? formatCPF(p.cpf) : null, p.empresa].filter(Boolean).join(' · ') ||
                            'sem empresa'}
                        </span>
                      </span>
                      {etapa ? (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                          style={{ backgroundColor: etapa.cor }}
                        >
                          {etapa.rotulo}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-slate-400">sem atendimento</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
