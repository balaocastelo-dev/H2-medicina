'use client';

import { useState, useTransition } from 'react';
import { Save } from 'lucide-react';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { saveExamResult } from './actions';
import { alertasDaFicha, fichaDoExame } from './fichas-de-exame';

/**
 * Ficha do exame preenchida na propria sala, montada a partir do modelo.
 *
 * Os campos marcados como alerta ligam sozinhos o "resultado alterado", que
 * e o que faz a resposta aparecer destacada para o medico na consulta.
 */
export function FichaDeExameForm({
  patientExamId,
  codigoExame,
  valoresIniciais = {},
  conclusaoInicial = '',
  aoSalvar,
}: {
  patientExamId: string;
  codigoExame: string | null | undefined;
  valoresIniciais?: Record<string, string>;
  conclusaoInicial?: string;
  aoSalvar?: () => void;
}) {
  const ficha = fichaDoExame(codigoExame);
  const [valores, setValores] = useState<Record<string, string>>(valoresIniciais);
  const [conclusao, setConclusao] = useState(conclusaoInicial);
  const [pendente, iniciarTransicao] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const alertas = ficha ? alertasDaFicha(ficha, valores) : [];
  const marcar = (chave: string, valor: string) =>
    setValores((atual) => ({ ...atual, [chave]: valor }));

  const salvar = () =>
    iniciarTransicao(async () => {
      const resultado = await saveExamResult(
        patientExamId,
        valores,
        conclusao,
        alertas.length > 0,
      );
      setAviso({
        ok: resultado.ok,
        texto: resultado.ok ? (resultado.message ?? 'Registrado.') : resultado.error,
      });
      if (resultado.ok) aoSalvar?.();
    });

  return (
    <div className="space-y-3">
      {aviso && <Alert variant={aviso.ok ? 'success' : 'error'}>{aviso.texto}</Alert>}

      {!ficha && (
        <p className="text-xs text-slate-500">
          Este exame não tem ficha própria. Registre o resultado na conclusão abaixo.
        </p>
      )}

      {ficha && (
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
          {ficha.campos.map((campo) => {
            if (campo.tipo === 'titulo') {
              return (
                <p
                  key={campo.chave}
                  className="pt-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"
                >
                  {campo.rotulo}
                </p>
              );
            }

            if (campo.tipo === 'longo') {
              return (
                <Field key={campo.chave} label={campo.rotulo}>
                  <Textarea
                    rows={2}
                    value={valores[campo.chave] ?? ''}
                    onChange={(e) => marcar(campo.chave, e.target.value)}
                  />
                </Field>
              );
            }

            if (campo.tipo === 'opcoes' || campo.tipo === 'sim_nao') {
              const opcoes = campo.tipo === 'sim_nao' ? ['sim', 'não'] : (campo.opcoes ?? []);
              const atual = valores[campo.chave] ?? '';
              return (
                <div
                  key={campo.chave}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <span className="text-sm text-slate-700">{campo.rotulo}</span>
                  <div className="flex flex-wrap gap-1">
                    {opcoes.map((op) => {
                      const marcado = atual === op;
                      const alerta = (campo.alertaEm ?? []).includes(op);
                      return (
                        <button
                          key={op}
                          type="button"
                          onClick={() => marcar(campo.chave, marcado ? '' : op)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            marcado
                              ? alerta
                                ? 'bg-amber-500 text-white'
                                : 'bg-emerald-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {op}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }

            return (
              <label
                key={campo.chave}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 flex-1 text-slate-700">
                  {campo.rotulo}
                  {campo.unidade && (
                    <span className="ml-1 text-xs text-slate-400">({campo.unidade})</span>
                  )}
                </span>
                <Input
                  type={campo.tipo === 'numero' ? 'number' : 'text'}
                  step={campo.tipo === 'numero' ? 'any' : undefined}
                  className="h-8 w-32"
                  value={valores[campo.chave] ?? ''}
                  onChange={(e) => marcar(campo.chave, e.target.value)}
                />
              </label>
            );
          })}
        </div>
      )}

      {alertas.length > 0 && (
        <Alert variant="warning" title="Será marcado como resultado alterado">
          <ul className="list-disc pl-4 text-xs">
            {alertas.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Field label="Conclusão">
        <Textarea rows={2} value={conclusao} onChange={(e) => setConclusao(e.target.value)} />
      </Field>

      <Button size="sm" loading={pendente} onClick={salvar}>
        <Save className="h-4 w-4" /> Salvar ficha
      </Button>
    </div>
  );
}
