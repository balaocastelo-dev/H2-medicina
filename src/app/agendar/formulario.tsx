'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarCheck, CheckCircle2, Download, FileText } from 'lucide-react';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/format';
import {
  reservarPeloSite,
  type ReservaCriada,
} from '@/modules/scheduling/publico-actions';
import type { DiaDisponivel } from '@/modules/scheduling/grade-publica';

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function rotuloDoDia(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const d = new Date(Date.UTC(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1));
  return `${DIAS_DA_SEMANA[d.getUTCDay()]}, ${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

/**
 * Agendamento publico em tres passos.
 *
 * A ordem e a da conversa no telefone: quem e voce, o que precisa fazer,
 * quando pode vir. So aparecem dias e horarios de fato livres — oferecer
 * e depois recusar seria pior do que nao oferecer.
 */
export function FormularioPublico({
  exames,
  dias,
}: {
  exames: { id: string; nome: string; minutos: number }[];
  dias: DiaDisponivel[];
}) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [observacao, setObservacao] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [reserva, setReserva] = useState<ReservaCriada | null>(null);
  const [pendente, startTransition] = useTransition();

  const horariosDoDia = useMemo(
    () => dias.find((d) => d.data === data)?.horarios ?? [],
    [dias, data],
  );

  const dadosOk =
    nome.trim().length >= 5 &&
    cpf.trim().length >= 11 &&
    nascimento.length > 0 &&
    telefone.trim().length >= 10;
  const podeEnviar = dadosOk && escolhidos.length > 0 && data.length > 0 && hora.length > 0;

  const enviar = () =>
    startTransition(async () => {
      setErro(null);
      const r = await reservarPeloSite({
        nome,
        cpf,
        nascimento,
        telefone,
        email,
        empresa,
        data,
        hora,
        examTypeIds: escolhidos,
        observacao,
      });
      if (r.ok && r.data) setReserva(r.data);
      else if (!r.ok) setErro(r.error);
    });

  // ---- Concluído: comprovante ------------------------------------------
  if (reserva) {
    const url = `/api/public/comprovante/${reserva.codigo}`;
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
        <p className="flex items-center gap-2 text-lg font-semibold text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          Pedido registrado
        </p>

        <p className="mt-2 text-sm text-slate-600">
          Guarde o código abaixo. A clínica vai confirmar seu horário e você pode acompanhar por
          ele a qualquer momento.
        </p>

        <div className="my-4 rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Código do comprovante</p>
          <p className="font-mono text-2xl font-bold tracking-widest text-slate-900">
            {reserva.codigo}
          </p>
        </div>

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Paciente</dt>
            <dd className="font-medium text-slate-800">{reserva.nome}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Data</dt>
            <dd className="font-medium text-slate-800">{formatDate(reserva.quando)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Horário</dt>
            <dd className="font-medium text-slate-800">{formatTime(reserva.quando)}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          {/* Link direto, e não window.open depois de await: o navegador
              bloquearia a aba e o botão pareceria morto. */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            <Download className="h-4 w-4" /> Baixar comprovante em PDF
          </a>
          <a
            href={url}
            download={`comprovante-${reserva.codigo}.pdf`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" /> Salvar no aparelho
          </a>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Seu horário fica reservado enquanto a clínica confirma. Em caso de imprevisto, ligue
          informando o código.
        </p>
      </div>
    );
  }

  // ---- Formulário ------------------------------------------------------
  return (
    <div className="space-y-4">
      {erro && <Alert variant="error">{erro}</Alert>}

      <Passo numero={1} titulo="Seus dados">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome completo" className="sm:col-span-2" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="CPF" required>
            <Input
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
          </Field>
          <Field label="Data de nascimento" required>
            <Input
              type="date"
              value={nascimento}
              onChange={(e) => setNascimento(e.target.value)}
            />
          </Field>
          <Field label="Telefone com DDD" required>
            <Input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(19) 90000-0000"
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Field label="E-mail" hint="Opcional">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field label="Empresa onde trabalha" className="sm:col-span-2" hint="Opcional">
            <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
          </Field>
        </div>
      </Passo>

      <Passo numero={2} titulo="O que você precisa fazer" liberado={dadosOk}>
        {exames.length === 0 ? (
          <Alert variant="warning">
            Nenhum exame está disponível para agendamento pelo site no momento.
          </Alert>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {exames.map((e) => (
              <label
                key={e.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm hover:border-slate-300"
              >
                <input
                  type="checkbox"
                  checked={escolhidos.includes(e.id)}
                  onChange={(ev) =>
                    setEscolhidos((prev) =>
                      ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate">{e.nome}</span>
                <span className="shrink-0 text-xs text-slate-400">~{e.minutos} min</span>
              </label>
            ))}
          </div>
        )}
      </Passo>

      <Passo
        numero={3}
        titulo="Quando você pode vir"
        liberado={dadosOk && escolhidos.length > 0}
      >
        {dias.length === 0 ? (
          <Alert variant="warning">
            Não há horários livres no momento. Entre em contato com a clínica por telefone.
          </Alert>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dia" required>
              <Select
                value={data}
                onChange={(e) => {
                  setData(e.target.value);
                  setHora('');
                }}
              >
                <option value="">Escolha o dia</option>
                {dias.map((d) => (
                  <option key={d.data} value={d.data}>
                    {rotuloDoDia(d.data)} — {d.horarios.length} horário(s)
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Horário" required>
              {data ? (
                <div className="flex flex-wrap gap-1.5">
                  {horariosDoDia.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHora(h)}
                      className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
                        hora === h
                          ? 'border-transparent text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                      style={hora === h ? { backgroundColor: 'var(--brand-primary)' } : undefined}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="pt-2 text-sm text-slate-400">Escolha o dia primeiro.</p>
              )}
            </Field>
          </div>
        )}

        <Field label="Alguma observação?" className="mt-3" hint="Opcional">
          <Textarea
            rows={2}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: preciso do exame para admissão na segunda-feira"
          />
        </Field>
      </Passo>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Button
          loading={pendente}
          disabled={!podeEnviar}
          onClick={enviar}
          className="w-full justify-center"
        >
          <CalendarCheck className="h-4 w-4" />
          {data && hora
            ? `Agendar para ${rotuloDoDia(data)} às ${hora}`
            : 'Agendar meu exame'}
        </Button>
        <p className="mt-2 text-center text-xs text-slate-500">
          O horário fica reservado e a clínica confirma em seguida.
        </p>
      </div>
    </div>
  );
}

function Passo({
  numero,
  titulo,
  liberado = true,
  children,
}: {
  numero: number;
  titulo: string;
  liberado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 transition ${
        liberado ? '' : 'pointer-events-none opacity-50'
      }`}
      // `inert` desliga o passo de verdade para teclado e leitor de tela;
      // opacidade sozinha só engana quem enxerga.
      inert={!liberado}
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: 'var(--brand-primary)' }}
        >
          {numero}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}
