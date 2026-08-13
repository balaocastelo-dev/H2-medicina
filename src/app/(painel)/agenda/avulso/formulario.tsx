'use client';

import { useState, useTransition } from 'react';
import { CalendarPlus, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { formatCPF, formatMoney } from '@/lib/format';
import {
  agendarExamesAvulso,
  funcionariosDaEmpresa,
} from '@/modules/scheduling/avulso-actions';

interface ExamType {
  id: string;
  name: string;
  code: string;
  price: number | null;
  average_minutes: number;
}

interface Funcionario {
  chave: string;
  patient_id: string | null;
  full_name: string;
  cpf: string;
  birth_date: string;
  phone: string;
  job_title: string;
  department: string;
  registration_number: string;
}

const vazio = (): Funcionario => ({
  chave: Math.random().toString(36).slice(2),
  patient_id: null,
  full_name: '',
  cpf: '',
  birth_date: '',
  phone: '',
  job_title: '',
  department: '',
  registration_number: '',
});

const TIPOS = [
  { value: 'admissional', label: 'Admissional' },
  { value: 'periodico', label: 'Periódico' },
  { value: 'demissional', label: 'Demissional' },
  { value: 'mudanca_funcao', label: 'Mudança de função' },
  { value: 'retorno_trabalho', label: 'Retorno ao trabalho' },
  { value: 'consulta', label: 'Consulta' },
  { value: 'outro', label: 'Outro' },
];

/**
 * Agendamento avulso em lote para empresa contratante.
 *
 * O RH manda a lista de uma vez; a tela acompanha esse ritmo. Cada linha
 * pode ser um funcionario ja cadastrado (escolhido no seletor) ou alguem
 * novo, digitado ali mesmo.
 */
export function FormularioAvulso({
  companies,
  examTypes,
}: {
  companies: { id: string; label: string }[];
  examTypes: ExamType[];
}) {
  const [companyId, setCompanyId] = useState('');
  const [quando, setQuando] = useState('');
  const [tipo, setTipo] = useState('admissional');
  const [prioridade, setPrioridade] = useState<'normal' | 'prioritario' | 'encaixe'>('normal');
  const [exames, setExames] = useState<string[]>([]);
  const [observacoes, setObservacoes] = useState('');
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([vazio()]);
  const [cadastrados, setCadastrados] = useState<
    { id: string; full_name: string; cpf: string | null; job_title: string | null }[]
  >([]);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, startTransition] = useTransition();

  /**
   * Troca de empresa recarrega os funcionarios e zera a lista: manter as
   * linhas antigas vincularia gente da empresa anterior por engano.
   */
  const trocarEmpresa = (novaEmpresa: string) => {
    setCompanyId(novaEmpresa);
    setFuncionarios([vazio()]);
    setCadastrados([]);
    if (!novaEmpresa) return;
    startTransition(async () => {
      const r = await funcionariosDaEmpresa(novaEmpresa);
      if (r.ok && r.data) setCadastrados(r.data);
    });
  };

  const atualizar = (chave: string, campo: keyof Funcionario, valor: string) =>
    setFuncionarios((prev) =>
      prev.map((f) => (f.chave === chave ? { ...f, [campo]: valor } : f)),
    );

  const escolherCadastrado = (chave: string, patientId: string) => {
    const encontrado = cadastrados.find((c) => c.id === patientId);
    setFuncionarios((prev) =>
      prev.map((f) =>
        f.chave === chave
          ? encontrado
            ? {
                ...f,
                patient_id: encontrado.id,
                full_name: encontrado.full_name,
                cpf: encontrado.cpf ?? '',
                job_title: encontrado.job_title ?? '',
              }
            : { ...f, patient_id: null }
          : f,
      ),
    );
  };

  const duracao = examTypes
    .filter((e) => exames.includes(e.id))
    .reduce((soma, e) => soma + e.average_minutes, 0);
  const total = examTypes
    .filter((e) => exames.includes(e.id))
    .reduce((soma, e) => soma + Number(e.price ?? 0), 0);

  const preenchidos = funcionarios.filter((f) => f.full_name.trim().length >= 3);
  const podeEnviar = Boolean(companyId && quando && exames.length > 0 && preenchidos.length > 0);

  const enviar = () =>
    startTransition(async () => {
      const r = await agendarExamesAvulso({
        company_id: companyId,
        scheduled_at: quando,
        attendance_kind: tipo,
        priority: prioridade,
        exam_type_ids: exames,
        notes: observacoes || null,
        funcionarios: preenchidos.map((f) => ({
          patient_id: f.patient_id,
          full_name: f.full_name.trim(),
          cpf: f.cpf || null,
          birth_date: f.birth_date || null,
          phone: f.phone || null,
          job_title: f.job_title || null,
          department: f.department || null,
          registration_number: f.registration_number || null,
        })),
      });
      setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Agendado.') : r.error });
      if (r.ok) {
        setFuncionarios([vazio()]);
        setObservacoes('');
      }
    });

  return (
    <div className="space-y-4">
      {mensagem && <Alert variant={mensagem.ok ? 'success' : 'error'}>{mensagem.texto}</Alert>}

      <Card>
        <CardHeader
          title="Empresa e data"
          description="Todos os funcionários da lista abaixo são agendados neste horário"
        />
        <CardBody className="grid gap-3 md:grid-cols-4">
          <Field label="Empresa contratante" className="md:col-span-2" required>
            <Select value={companyId} onChange={(e) => trocarEmpresa(e.target.value)}>
              <option value="">Selecione</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data e hora" required>
            <Input
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
            />
          </Field>
          <Field label="Tipo de atendimento">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select
              value={prioridade}
              onChange={(e) =>
                setPrioridade(e.target.value as 'normal' | 'prioritario' | 'encaixe')
              }
            >
              <option value="normal">Normal</option>
              <option value="prioritario">Prioritário</option>
              <option value="encaixe">Encaixe</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Exames e consultas"
          description={
            exames.length > 0
              ? `${exames.length} selecionado(s) · ${duracao} min · ${formatMoney(total)} por funcionário`
              : 'Selecione o que será realizado'
          }
        />
        <CardBody>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {examTypes.map((e) => (
              <label
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={exames.includes(e.id)}
                    onChange={(ev) =>
                      setExames((prev) =>
                        ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                      )
                    }
                  />
                  <span className="truncate">{e.name}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                  {formatMoney(e.price ?? 0)}
                </span>
              </label>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Funcionários"
          description={`${preenchidos.length} pronto(s) para agendar`}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFuncionarios((prev) => [...prev, vazio()])}
            >
              <Plus className="h-3.5 w-3.5" /> Incluir funcionário
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {!companyId && (
            <Alert variant="info">Selecione a empresa para carregar os funcionários já cadastrados.</Alert>
          )}

          {funcionarios.map((f, indice) => (
            <div key={f.chave} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  {f.patient_id ? (
                    <Users className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <UserPlus className="h-4 w-4 text-slate-400" />
                  )}
                  Funcionário {indice + 1}
                  {f.patient_id && <Badge color="#22C55E">já cadastrado</Badge>}
                </p>
                {funcionarios.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setFuncionarios((prev) => prev.filter((x) => x.chave !== f.chave))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {cadastrados.length > 0 && (
                <Field label="Buscar entre os já cadastrados" className="mb-3">
                  <Select
                    value={f.patient_id ?? ''}
                    onChange={(e) => escolherCadastrado(f.chave, e.target.value)}
                  >
                    <option value="">Novo funcionário (digitar abaixo)</option>
                    {cadastrados.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                        {c.cpf ? ` — ${formatCPF(c.cpf)}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Nome completo" className="md:col-span-2" required>
                  <Input
                    value={f.full_name}
                    onChange={(e) => atualizar(f.chave, 'full_name', e.target.value)}
                    disabled={Boolean(f.patient_id)}
                  />
                </Field>
                <Field label="CPF">
                  <Input
                    value={f.cpf}
                    onChange={(e) => atualizar(f.chave, 'cpf', e.target.value)}
                    placeholder="000.000.000-00"
                    disabled={Boolean(f.patient_id)}
                  />
                </Field>
                <Field label="Nascimento">
                  <Input
                    type="date"
                    value={f.birth_date}
                    onChange={(e) => atualizar(f.chave, 'birth_date', e.target.value)}
                    disabled={Boolean(f.patient_id)}
                  />
                </Field>
                <Field label="Telefone">
                  <Input
                    value={f.phone}
                    onChange={(e) => atualizar(f.chave, 'phone', e.target.value)}
                    disabled={Boolean(f.patient_id)}
                  />
                </Field>
                <Field label="Cargo">
                  <Input
                    value={f.job_title}
                    onChange={(e) => atualizar(f.chave, 'job_title', e.target.value)}
                  />
                </Field>
                <Field label="Setor">
                  <Input
                    value={f.department}
                    onChange={(e) => atualizar(f.chave, 'department', e.target.value)}
                  />
                </Field>
                <Field label="Matrícula (e-Social)">
                  <Input
                    value={f.registration_number}
                    onChange={(e) => atualizar(f.chave, 'registration_number', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Field label="Observações do pedido">
            <Textarea
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Ex.: exames solicitados por e-mail pelo RH em 12/08"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button loading={pendente} disabled={!podeEnviar} onClick={enviar}>
              <CalendarPlus className="h-4 w-4" /> Agendar {preenchidos.length || ''}{' '}
              {preenchidos.length === 1 ? 'funcionário' : 'funcionários'}
            </Button>
            {exames.length > 0 && preenchidos.length > 0 && (
              <span className="text-sm text-slate-600">
                Total estimado: <strong>{formatMoney(total * preenchidos.length)}</strong>
              </span>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
