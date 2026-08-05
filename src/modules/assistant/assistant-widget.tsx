'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Bot, CornerDownLeft, Loader2, Sparkles, X } from 'lucide-react';
import { executarComando, interpretarComando, type RespostaAssistente } from './actions';

interface Bolha {
  de: 'voce' | 'assistente';
  texto: string;
  detalhes?: string[];
  sugestoes?: string[];
  erro?: boolean;
}

/**
 * Assistente do sistema.
 *
 * Fica disponivel em todas as telas do painel. O usuario descreve o que quer
 * em portugues; o servidor interpreta, mostra o que vai fazer e so executa
 * depois da confirmacao. Toda execucao passa pela mesma checagem de permissao
 * das telas e fica registrada na auditoria.
 */
export function AssistantWidget({ nomeUsuario }: { nomeUsuario: string }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [pendente, setPendente] = useState<string | null>(null);
  const [conversa, setConversa] = useState<Bolha[]>([]);
  const [processando, startTransition] = useTransition();
  const fim = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversa, aberto]);

  useEffect(() => {
    if (aberto) entrada.current?.focus();
  }, [aberto]);

  // Atalho: Ctrl/Cmd + K
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAberto((v) => !v);
      }
      if (e.key === 'Escape') setAberto(false);
    };
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, []);

  const responder = (r: RespostaAssistente) =>
    setConversa((c) => [
      ...c,
      {
        de: 'assistente',
        texto: r.mensagem,
        detalhes: r.detalhes,
        sugestoes: r.sugestoes,
        erro: !r.ok,
      },
    ]);

  const enviar = (frase: string) => {
    const limpa = frase.trim();
    if (!limpa || processando) return;
    setConversa((c) => [...c, { de: 'voce', texto: limpa }]);
    setTexto('');
    setPendente(null);

    startTransition(async () => {
      const leitura = await interpretarComando(limpa);
      responder(leitura);
      if (leitura.ok && leitura.confirmar) setPendente(limpa);
    });
  };

  const confirmar = () => {
    if (!pendente || processando) return;
    const frase = pendente;
    setPendente(null);
    startTransition(async () => {
      responder(await executarComando(frase));
    });
  };

  return (
    <>
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full py-3 pr-5 pl-4 text-sm font-medium text-white shadow-xl transition hover:scale-105"
          style={{ backgroundColor: 'var(--brand-primary)' }}
        >
          <Bot className="h-5 w-5" />
          Assistente
          <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
        </button>
      )}

      {aberto && (
        <div className="fixed right-5 bottom-5 z-50 flex h-[560px] max-h-[80vh] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div
            className="flex items-center justify-between px-4 py-3 text-white"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold">Assistente</p>
                <p className="text-[11px] opacity-80">Sempre disponível</p>
              </div>
            </div>
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar">
              <X className="h-4 w-4 opacity-80 hover:opacity-100" />
            </button>
          </div>

          <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
            {conversa.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                  <Sparkles className="h-4 w-4" style={{ color: 'var(--brand-primary)' }} />
                  Ola, {nomeUsuario.split(' ')[0]}!
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Escreva o que precisa e eu executo. Antes de gravar qualquer coisa, mostro o que
                  vou fazer para voce confirmar.
                </p>
                <div className="mt-3 space-y-1.5">
                  {[
                    'chamar o próximo da fila na sala de audiometria',
                    'criar uma cobrança para o paciente do cpf 529.982.247-25 no valor de 200,00',
                    'cadastrar o médico dr miguel crm 00002520',
                    'buscar paciente maria',
                  ].map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => enviar(ex)}
                      className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-xs text-slate-700 transition hover:bg-white"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {conversa.map((b, i) => (
              <div key={i} className={b.de === 'voce' ? 'flex justify-end' : ''}>
                <div
                  className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
                    b.de === 'voce'
                      ? 'text-white'
                      : b.erro
                        ? 'border border-amber-200 bg-amber-50 text-amber-900'
                        : 'border border-slate-200 bg-white text-slate-800'
                  }`}
                  style={b.de === 'voce' ? { backgroundColor: 'var(--brand-primary)' } : undefined}
                >
                  <p>{b.texto}</p>

                  {b.detalhes && b.detalhes.length > 0 && (
                    <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-600">
                      {b.detalhes.map((d, j) => (
                        <li key={j}>• {d}</li>
                      ))}
                    </ul>
                  )}

                  {b.sugestoes && b.sugestoes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {b.sugestoes.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => enviar(s)}
                          className="block w-full rounded-md bg-slate-100 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-200"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {processando && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> processando...
              </div>
            )}

            <div ref={fim} />
          </div>

          {pendente && (
            <div className="border-t border-slate-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-900">Confirma esta operação?</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={processando}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--brand-primary)' }}
                >
                  Sim, executar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendente(null);
                    setConversa((c) => [
                      ...c,
                      { de: 'assistente', texto: 'Operação cancelada.', erro: false },
                    ]);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              enviar(texto);
            }}
            className="flex items-center gap-2 border-t border-slate-200 p-2.5"
          >
            <input
              ref={entrada}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ex.: chamar o próximo na sala de audiometria"
              className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus:ring-2 focus:outline-none ring-brand"
            />
            <button
              type="submit"
              disabled={processando || !texto.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white disabled:opacity-40"
              style={{ backgroundColor: 'var(--brand-primary)' }}
              aria-label="Enviar"
            >
              <CornerDownLeft className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
