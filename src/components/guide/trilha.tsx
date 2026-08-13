'use client';

import { CheckCircle2, Clock, Hand, MapPin } from 'lucide-react';
import { formatCPF, formatTime } from '@/lib/format';
import { duracaoEmPalavras } from '@/modules/guide/etapas';
import type { TrilhaCompleta } from '@/modules/guide/trilha-actions';

/**
 * Trilha do paciente: onde esta, por onde passou e o que falta.
 *
 * O texto e o mesmo que a recepcao usaria ao responder "cade o fulano?" —
 * "esta na sala de triagem ha 12 minutos" diz mais do que
 * `stage_code = em_triagem`.
 */
export function TrilhaDoPaciente({ dados }: { dados: TrilhaCompleta }) {
  const { paciente, trilha } = dados;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-base font-semibold text-slate-900">{paciente.nome}</p>
        <p className="text-xs text-slate-500">
          {[
            paciente.cpf ? formatCPF(paciente.cpf) : null,
            paciente.empresa,
            paciente.senha ? `senha ${paciente.senha}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* Onde está agora, em uma frase. */}
      <div
        className="rounded-xl p-3 text-sm"
        style={{ backgroundColor: `${trilha.atual.cor}18`, border: `1px solid ${trilha.atual.cor}55` }}
      >
        <p className="flex items-center gap-2 font-semibold" style={{ color: trilha.atual.cor }}>
          {trilha.encerrado ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <MapPin className="h-4 w-4" />
          )}
          {trilha.atual.rotulo}
        </p>
        <p className="mt-1 leading-relaxed text-slate-700">{trilha.resumo}</p>
      </div>

      {/* Por onde passou. */}
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
          Por onde passou
        </p>
        <ol className="relative space-y-0 border-l-2 border-slate-200 pl-4">
          {trilha.passos.map((passo, i) => (
            <li key={`${passo.code}-${i}`} className="relative pb-4 last:pb-0">
              <span
                className="absolute top-1 -left-[22px] h-3 w-3 rounded-full ring-2 ring-white"
                style={{ backgroundColor: passo.cor }}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-slate-800">
                  {passo.rotulo}
                  {passo.manual && (
                    <span
                      title="Movido à mão no CRM, fora do fluxo normal"
                      className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                    >
                      <Hand className="h-2.5 w-2.5" /> manual
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {formatTime(passo.entrouEm)}
                  {passo.segundos !== null && (
                    <span className="ml-1.5 text-slate-400">
                      · ficou {duracaoEmPalavras(passo.segundos)}
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}

          {!trilha.encerrado && (
            <li className="relative">
              <span
                className="absolute top-1 -left-[22px] h-3 w-3 animate-pulse rounded-full ring-2 ring-white"
                style={{ backgroundColor: trilha.atual.cor }}
              />
              <p className="text-sm font-medium text-slate-800">
                {trilha.atual.rotulo}
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  agora, há {duracaoEmPalavras(trilha.segundosNaAtual)}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">Próximo: {trilha.atual.proximo}</p>
            </li>
          )}
        </ol>
      </div>

      <p className="flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <Clock className="h-3.5 w-3.5" />
        {trilha.encerrado ? 'Permaneceu' : 'Está na clínica há'}{' '}
        <strong className="text-slate-700">{duracaoEmPalavras(trilha.esperaTotalSegundos)}</strong>
      </p>
    </div>
  );
}
