'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface OpcaoBusca {
  id: string;
  /** O que aparece na linha. */
  rotulo: string;
  /** Segunda linha, menor: CPF, empresa, o que ajudar a distinguir. */
  detalhe?: string | null;
  /** Texto extra usado na busca sem aparecer na tela. */
  busca?: string;
}

function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Campo de escolha com busca.
 *
 * Uma lista suspensa comum obriga a rolar centenas de nomes com o paciente
 * esperando no balcao. Aqui digita-se parte do nome, do CPF ou da empresa
 * e a lista filtra. Todas as palavras digitadas precisam bater, entao
 * "maria seduc" acha a Maria da SEDUC sem trazer todas as Marias.
 *
 * O valor vai para o formulario por um input escondido, entao o componente
 * funciona dentro de uma `<form action={...}>` como qualquer campo nativo.
 */
export function BuscaSelecao({
  name,
  opcoes,
  valor,
  onChange,
  placeholder = 'Digite para buscar',
  vazioRotulo = 'Nenhum resultado',
  permiteLimpar = true,
  required = false,
  id,
}: {
  name: string;
  opcoes: OpcaoBusca[];
  valor: string;
  onChange: (id: string) => void;
  placeholder?: string;
  vazioRotulo?: string;
  permiteLimpar?: boolean;
  required?: boolean;
  id?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const caixa = useRef<HTMLDivElement>(null);

  const selecionada = opcoes.find((o) => o.id === valor) ?? null;

  const filtradas = useMemo(() => {
    const busca = normalizar(termo);
    if (!busca) return opcoes.slice(0, 50);
    const palavras = busca.split(' ').filter(Boolean);
    return opcoes
      .filter((o) => {
        const alvo = normalizar(`${o.rotulo} ${o.detalhe ?? ''} ${o.busca ?? ''}`);
        return palavras.every((p) => alvo.includes(p));
      })
      .slice(0, 50);
  }, [opcoes, termo]);

  // Clique fora fecha a lista, senão ela fica aberta por cima do resto do
  // formulário depois que a pessoa desiste de escolher.
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto]);

  const escolher = (opcaoId: string) => {
    onChange(opcaoId);
    setTermo('');
    setAberto(false);
  };

  return (
    <div ref={caixa} className="relative">
      <input type="hidden" name={name} value={valor} required={required} />

      <button
        type="button"
        id={id}
        onClick={() => setAberto((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm hover:border-slate-400 focus:border-slate-500 focus:outline-none"
      >
        <span className={selecionada ? 'truncate' : 'truncate text-slate-400'}>
          {selecionada ? selecionada.rotulo : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selecionada && permiteLimpar && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar seleção"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </span>
      </button>

      {selecionada?.detalhe && (
        <p className="mt-1 truncate text-xs text-slate-500">{selecionada.detalhe}</p>
      )}

      {aberto && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              autoFocus
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder={placeholder}
              className="w-full text-sm outline-none"
            />
          </div>

          <ul className="max-h-64 overflow-y-auto py-1">
            {filtradas.length === 0 && (
              <li className="px-3 py-3 text-sm text-slate-500">{vazioRotulo}</li>
            )}
            {filtradas.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => escolher(o.id)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <Check
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      o.id === valor ? 'text-emerald-600' : 'text-transparent'
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{o.rotulo}</span>
                    {o.detalhe && (
                      <span className="block truncate text-xs text-slate-500">{o.detalhe}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {opcoes.length > filtradas.length && !termo && (
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
              Mostrando 50 de {opcoes.length}. Digite para encontrar os demais.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
