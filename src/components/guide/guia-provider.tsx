'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { BalaoDoGuia } from './balao';
import { registrarGuia } from '@/modules/guide/actions';
import { roteiroDaRota, type Roteiro } from '@/modules/guide/roteiros';

interface Contexto {
  /** Roteiro disponível na tela atual, se houver. */
  roteiro: Roteiro | null;
  abrir: () => void;
  ativo: boolean;
}

const GuiaContexto = createContext<Contexto>({ roteiro: null, abrir: () => {}, ativo: false });

export function useGuia() {
  return useContext(GuiaContexto);
}

/**
 * Guia de uso com baloes.
 *
 * Roda sozinho na primeira vez que a pessoa abre cada tela e, dali em
 * diante, so quando ela pedir. Quem ja sabe trabalhar nao e interrompido;
 * quem e novo nao precisa descobrir que existe um guia escondido.
 *
 * A lista de telas ja vistas vem do servidor no primeiro render e e
 * mantida em memoria durante a navegacao — o guia nao pode depender de uma
 * ida ao banco para decidir se aparece.
 */
export function GuiaProvider({
  jaVistos,
  children,
}: {
  jaVistos: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const roteiro = useMemo(() => roteiroDaRota(pathname), [pathname]);

  const vistos = useRef(new Set(jaVistos));
  const [indice, setIndice] = useState<number | null>(null);

  // Abertura automatica: so na primeira visita e depois de a tela pintar,
  // senao o holofote mede o elemento antes de ele existir.
  useEffect(() => {
    if (!roteiro || vistos.current.has(roteiro.chave)) return;
    const t = window.setTimeout(() => setIndice(0), 700);
    return () => window.clearTimeout(t);
  }, [roteiro]);

  const encerrar = useCallback(
    (desfecho: 'concluido' | 'pulado', ultimoPasso: number) => {
      setIndice(null);
      if (!roteiro) return;
      vistos.current.add(roteiro.chave);
      void registrarGuia(roteiro.chave, desfecho, ultimoPasso);
    },
    [roteiro],
  );

  const abrir = useCallback(() => {
    if (roteiro) setIndice(0);
  }, [roteiro]);

  const valor = useMemo<Contexto>(
    () => ({ roteiro, abrir, ativo: indice !== null }),
    [roteiro, abrir, indice],
  );

  return (
    <GuiaContexto.Provider value={valor}>
      {children}
      {roteiro && indice !== null && (
        <BalaoDoGuia
          roteiro={roteiro}
          indice={indice}
          onAnterior={() => setIndice((i) => Math.max(0, (i ?? 0) - 1))}
          onProximo={() => {
            const proximo = (indice ?? 0) + 1;
            if (proximo >= roteiro.passos.length) encerrar('concluido', indice ?? 0);
            else setIndice(proximo);
          }}
          onFechar={() => encerrar('pulado', indice ?? 0)}
        />
      )}
    </GuiaContexto.Provider>
  );
}

/** Botao de ajuda da barra superior: reabre o guia da tela atual. */
export function BotaoAjuda() {
  const { roteiro, abrir, ativo } = useGuia();
  if (!roteiro) return null;

  return (
    <button
      type="button"
      data-guia="botao-ajuda"
      onClick={abrir}
      disabled={ativo}
      title={`Rever: ${roteiro.titulo}`}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
    >
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ backgroundColor: 'var(--brand-primary)' }}
      >
        ?
      </span>
      <span className="hidden sm:inline">Ajuda</span>
    </button>
  );
}
