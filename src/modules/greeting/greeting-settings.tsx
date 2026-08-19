'use client';

import { useActionState, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { saveTenantSettings } from '@/modules/settings/actions';
import { escolherVoz } from './voice';
import { montarSaudacao } from './phrases';
import type { ActionResult } from '@/lib/action-result';

/**
 * Configuracao da saudacao, com escuta das vozes instaladas.
 *
 * A qualidade da fala depende do navegador e do sistema: o Chrome expoe a voz
 * do Google, o Edge expoe as neurais da Microsoft. Aqui a pessoa ouve o que
 * existe na maquina dela e escolhe.
 */
export function GreetingSettings({
  valores,
  nomeExemplo,
}: {
  valores: Record<string, unknown>;
  nomeExemplo: string;
}) {
  const acao = saveTenantSettings.bind(null, 'saudacao');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(acao, null);

  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([]);
  const [voz, setVoz] = useState(String(valores.voz ?? ''));
  const [velocidade, setVelocidade] = useState(Number(valores.velocidade ?? 0.97));
  const [tratamento, setTratamento] = useState(String(valores.tratamento_padrao ?? ''));

  useEffect(() => {
    const carregar = () => {
      const todas = window.speechSynthesis?.getVoices() ?? [];
      setVozes(todas.filter((v) => /^pt/i.test(v.lang)));
    };
    carregar();
    window.speechSynthesis?.addEventListener('voiceschanged', carregar);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', carregar);
  }, []);

  const frase = montarSaudacao({
    nome: nomeExemplo,
    tratamento,
    hora: new Date().getHours(),
    semente: 0,
  });

  const testar = (nomeVoz?: string) => {
    const sintese = window.speechSynthesis;
    if (!sintese) return;
    sintese.cancel();
    const escolhida =
      vozes.find((v) => v.name === nomeVoz) ?? escolherVoz(vozes, nomeVoz || voz || null);
    const fala = new SpeechSynthesisUtterance(frase);
    if (escolhida) fala.voice = escolhida;
    fala.lang = escolhida?.lang ?? 'pt-BR';
    fala.rate = velocidade;
    fala.pitch = 1;
    sintese.speak(fala);
  };

  const recomendada = escolherVoz(vozes, null);

  return (
    <Card>
      <CardHeader
        title="Saudação de boas-vindas"
        description="Cartao de boas-vindas ao entrar no sistema"
      />
      <CardBody>
        <form action={formAction} className="space-y-4">
          {state?.ok && <Alert variant="success">{state.message}</Alert>}
          {state && !state.ok && <Alert variant="error">{state.error}</Alert>}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Ativa?">
              <Select name="ativa" defaultValue={String(valores.ativa ?? 'sim')}>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </Select>
            </Field>
            <Field
              label="Falar ao entrar"
              hint="Desligado, o cartao aparece em silencio e a fala fica no botao Ouvir"
            >
              <Select
                name="falar_ao_entrar"
                defaultValue={String(valores.falar_ao_entrar ?? 'nao')}
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </Select>
            </Field>
            <Field
              label="Tratamento padrao"
              hint="Usado quando a pessoa não tem tratamento proprio"
            >
              <Select
                name="tratamento_padrao"
                value={tratamento}
                onChange={(e) => setTratamento(e.target.value)}
              >
                <option value="">Somente o nome</option>
                <option value="Dra.">Dra.</option>
                <option value="Dr.">Dr.</option>
                <option value="Sra.">Sra.</option>
                <option value="Sr.">Sr.</option>
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">
              Vozes em portugues neste computador
            </p>

            {vozes.length === 0 ? (
              <Alert variant="warning">
                Nenhuma voz em portugues encontrada neste navegador. No Chrome, verifique se ha
                conexao (a voz do Google e carregada da internet). O Edge costuma trazer as vozes
                neurais da Microsoft, que soam mais naturais.
              </Alert>
            ) : (
              <div className="space-y-1.5">
                {vozes.map((v) => {
                  const ehRecomendada = recomendada?.name === v.name;
                  const selecionada = voz ? v.name.toLowerCase().includes(voz.toLowerCase()) : ehRecomendada;
                  return (
                    <div
                      key={v.name}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${
                        selecionada ? 'border-transparent bg-white ring-2 ring-brand' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="__voz_escolha"
                          checked={selecionada}
                          onChange={() => setVoz(v.name)}
                        />
                        <span className="truncate">
                          {v.name}
                          <span className="ml-1 text-xs text-slate-400">{v.lang}</span>
                          {ehRecomendada && (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              recomendada
                            </span>
                          )}
                          {!v.localService && (
                            <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">
                              neural
                            </span>
                          )}
                        </span>
                      </label>
                      <Button type="button" size="sm" variant="outline" onClick={() => testar(v.name)}>
                        <Play className="h-3.5 w-3.5" /> Ouvir
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <input type="hidden" name="voz" value={voz} />
          </div>

          <Field label={`Velocidade da fala: ${velocidade.toFixed(2)}`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.75"
                max="1.25"
                step="0.01"
                value={velocidade}
                onChange={(e) => setVelocidade(Number(e.target.value))}
                className="flex-1"
              />
              <Input type="hidden" name="velocidade" value={String(velocidade)} readOnly />
              <Button type="button" variant="outline" onClick={() => testar()}>
                <Play className="h-4 w-4" /> Testar frase
              </Button>
            </div>
          </Field>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
            <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">Prévia</span>
            <p className="mt-1">{frase}</p>
          </div>

          <Button type="submit" loading={pending}>
            Salvar
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
