'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Save } from 'lucide-react';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { saveExamResult } from './actions';
import { alertasDaFicha, fichaDoExame, padroesDaFicha } from './fichas-de-exame';

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
  concluirAoSalvar = false,
  comBotaoConcluir = false,
}: {
  patientExamId: string;
  codigoExame: string | null | undefined;
  valoresIniciais?: Record<string, string>;
  conclusaoInicial?: string;
  /** Recebe se o exame foi CONCLUIDO, para quem precisa emitir o laudo. */
  aoSalvar?: (concluido: boolean) => void;
  /**
   * Mostra os DOIS botoes: "Salvar" e "Salvar e concluir exame".
   *
   * Nas salas do quadro de Filas o examinador termina o exame na propria
   * ficha. Antes ele tinha de clicar "Iniciar" no alto do cartao, descer,
   * preencher, clicar "Salvar ficha" — que nao fechava nada — e subir de
   * volta para clicar "Concluir". Com quatro exames na mesma chamada, oito
   * cliques em ordem fixa, e o botao de baixo, que parece o final, nao
   * finalizava o exame.
   */
  comBotaoConcluir?: boolean;
  /**
   * Salvar tambem conclui o exame.
   *
   * Vale na bancada da triagem, onde nao ha chamada de sala nem botao de
   * concluir: preencher a ficha e o exame. Nas salas do quadro de Filas
   * continua sendo o operador quem decide quando o exame terminou.
   */
  concluirAoSalvar?: boolean;
}) {
  const ficha = fichaDoExame(codigoExame);
  // Os padroes so valem para campo que ninguem preencheu ainda: reabrir um
  // exame salvo nao pode sobrescrever o que o examinador digitou.
  const [valores, setValores] = useState<Record<string, string>>({
    ...padroesDaFicha(ficha),
    ...valoresIniciais,
  });
  const [conclusao, setConclusao] = useState(conclusaoInicial);
  const [pendente, iniciarTransicao] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const alertas = ficha ? alertasDaFicha(ficha, valores) : [];
  const marcar = (chave: string, valor: string) =>
    setValores((atual) => ({ ...atual, [chave]: valor }));

  const salvar = (concluir: boolean) =>
    iniciarTransicao(async () => {
      const resultado = await saveExamResult(
        patientExamId,
        valores,
        conclusao,
        alertas.length > 0,
        concluir,
      );
      setAviso({
        ok: resultado.ok,
        texto: resultado.ok ? (resultado.message ?? 'Registrado.') : resultado.error,
      });
      if (resultado.ok) aoSalvar?.(concluir);
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

      <div className="flex flex-wrap gap-2">
        {/*
          "Salvar" guarda o que ja foi medido e deixa o exame em andamento —
          serve para quem precisa sair da tela no meio. "Salvar e concluir"
          e o botao do dia a dia: o examinador digitou o resultado, o exame
          acabou, o proximo paciente pode entrar na sala.
        */}
        <Button
          size="sm"
          variant={comBotaoConcluir ? 'outline' : 'primary'}
          loading={pendente}
          disabled={pendente}
          onClick={() => salvar(concluirAoSalvar)}
        >
          <Save className="h-4 w-4" />
          {concluirAoSalvar ? 'Salvar e concluir exame' : 'Salvar ficha'}
        </Button>

        {comBotaoConcluir && (
          <Button
            size="sm"
            variant="success"
            loading={pendente}
            disabled={pendente}
            onClick={() => salvar(true)}
          >
            <CheckCircle2 className="h-4 w-4" /> Salvar e concluir exame
          </Button>
        )}
      </div>
    </div>
  );
}
