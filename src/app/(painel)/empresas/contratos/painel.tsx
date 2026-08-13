'use client';

import { useState, useTransition } from 'react';
import { ExternalLink, FileDown, FileText, Plus, Save, Trash2, XCircle } from 'lucide-react';
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
import { formatDate, formatMoney } from '@/lib/format';
import { abrirDocumentoEmNovaAba } from '@/lib/abrir-documento';
import {
  encerrarContrato,
  gerarContratoPdf,
  salvarContrato,
} from '@/modules/companies/contract-actions';
import {
  CORES_SITUACAO,
  diasAteVencer,
  situacaoDoContrato,
} from '@/modules/companies/contract-template';
import type { ContratoNaLista, ItemDoContratoNaLista } from './tipos';

interface ItemEditavel {
  chave: string;
  kind: 'exame' | 'servico';
  name: string;
  exam_type_id: string | null;
  quantity_included: string;
  unit_price: string;
  extra_price: string;
}

type Rascunho = {
  id: string | null;
  company_id: string;
  name: string;
  code: string;
  status: string;
  starts_on: string;
  ends_on: string;
  signed_on: string;
  pcmso_valid_until: string;
  employees_count: string;
  monthly_amount: string;
  amount: string;
  billing_day: string;
  readjustment_index: string;
  auto_renew: boolean;
  esocial_enabled: boolean;
  coordinator_name: string;
  coordinator_crm: string;
  schedule_email: string;
  billing_email: string;
  technical_hour_rate: string;
  late_fee_percent: string;
  late_interest_percent: string;
  notes: string;
  itens: ItemEditavel[];
};

const chave = () => Math.random().toString(36).slice(2);

const itemVazio = (): ItemEditavel => ({
  chave: chave(),
  kind: 'exame',
  name: '',
  exam_type_id: null,
  quantity_included: '0',
  unit_price: '',
  extra_price: '',
});

function novoRascunho(companyId = ''): Rascunho {
  return {
    id: null,
    company_id: companyId,
    name: 'Contrato de prestação de serviços e gestão em saúde ocupacional',
    code: '',
    status: 'ativo',
    starts_on: '',
    ends_on: '',
    signed_on: '',
    pcmso_valid_until: '',
    employees_count: '',
    monthly_amount: '',
    amount: '',
    billing_day: '10',
    readjustment_index: 'IGP-M',
    auto_renew: true,
    esocial_enabled: false,
    coordinator_name: '',
    coordinator_crm: '',
    schedule_email: '',
    billing_email: '',
    technical_hour_rate: '',
    late_fee_percent: '2',
    late_interest_percent: '1',
    notes: '',
    itens: [],
  };
}

function paraRascunho(c: ContratoNaLista): Rascunho {
  const texto = (v: string | number | null) => (v === null || v === undefined ? '' : String(v));
  return {
    id: c.id,
    company_id: c.company_id,
    name: c.name,
    code: texto(c.code),
    status: c.status,
    starts_on: texto(c.starts_on),
    ends_on: texto(c.ends_on),
    signed_on: texto(c.signed_on),
    pcmso_valid_until: texto(c.pcmso_valid_until),
    employees_count: texto(c.employees_count),
    monthly_amount: texto(c.monthly_amount),
    amount: texto(c.amount),
    billing_day: texto(c.billing_day),
    readjustment_index: texto(c.readjustment_index),
    auto_renew: c.auto_renew,
    esocial_enabled: c.esocial_enabled,
    coordinator_name: texto(c.coordinator_name),
    coordinator_crm: texto(c.coordinator_crm),
    schedule_email: texto(c.schedule_email),
    billing_email: texto(c.billing_email),
    technical_hour_rate: texto(c.technical_hour_rate),
    late_fee_percent: texto(c.late_fee_percent),
    late_interest_percent: texto(c.late_interest_percent),
    notes: texto(c.notes),
    itens: (c.company_contract_items ?? []).map((i: ItemDoContratoNaLista) => ({
      chave: i.id,
      kind: i.kind === 'servico' ? 'servico' : 'exame',
      name: i.name,
      exam_type_id: i.exam_type_id,
      quantity_included: String(i.quantity_included ?? 0),
      unit_price: texto(i.unit_price),
      extra_price: texto(i.extra_price),
    })),
  };
}

/**
 * Painel de contratos: lista à esquerda com o alerta de vencimento,
 * edição à direita.
 *
 * A cota de exames aparece com o consumo ao lado porque é a pergunta que
 * a clínica faz todo mês — quanto ainda cabe no contrato antes de virar
 * excedente.
 */
export function PainelContratos({
  contratos,
  empresas,
  examTypes,
}: {
  contratos: ContratoNaLista[];
  empresas: { id: string; label: string }[];
  examTypes: { id: string; name: string; price: number | null }[];
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [linkDireto, setLinkDireto] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  const campo = <K extends keyof Rascunho>(chaveCampo: K, valor: Rascunho[K]) =>
    setRascunho((prev) => (prev ? { ...prev, [chaveCampo]: valor } : prev));

  const atualizarItem = (id: string, campoItem: keyof ItemEditavel, valor: string) =>
    setRascunho((prev) =>
      prev
        ? {
            ...prev,
            itens: prev.itens.map((i) =>
              i.chave === id ? { ...i, [campoItem]: valor } : i,
            ),
          }
        : prev,
    );

  const escolherExame = (id: string, examTypeId: string) => {
    const exame = examTypes.find((e) => e.id === examTypeId);
    setRascunho((prev) =>
      prev
        ? {
            ...prev,
            itens: prev.itens.map((i) =>
              i.chave === id
                ? {
                    ...i,
                    exam_type_id: examTypeId || null,
                    name: exame?.name ?? i.name,
                    unit_price: exame?.price !== null && exame?.price !== undefined
                      ? String(exame.price)
                      : i.unit_price,
                  }
                : i,
            ),
          }
        : prev,
    );
  };

  const numero = (v: string) => (v.trim() === '' ? null : Number(v));

  const salvar = () => {
    if (!rascunho) return;
    startTransition(async () => {
      const r = await salvarContrato({
        id: rascunho.id,
        company_id: rascunho.company_id,
        name: rascunho.name,
        code: rascunho.code || null,
        status: rascunho.status as 'rascunho' | 'ativo' | 'suspenso' | 'encerrado' | 'cancelado',
        starts_on: rascunho.starts_on || null,
        ends_on: rascunho.ends_on || null,
        signed_on: rascunho.signed_on || null,
        pcmso_valid_until: rascunho.pcmso_valid_until || null,
        employees_count: numero(rascunho.employees_count),
        monthly_amount: numero(rascunho.monthly_amount),
        amount: numero(rascunho.amount),
        billing_day: numero(rascunho.billing_day),
        readjustment_index: rascunho.readjustment_index || null,
        auto_renew: rascunho.auto_renew,
        esocial_enabled: rascunho.esocial_enabled,
        coordinator_name: rascunho.coordinator_name || null,
        coordinator_crm: rascunho.coordinator_crm || null,
        schedule_email: rascunho.schedule_email || null,
        billing_email: rascunho.billing_email || null,
        technical_hour_rate: numero(rascunho.technical_hour_rate),
        late_fee_percent: numero(rascunho.late_fee_percent),
        late_interest_percent: numero(rascunho.late_interest_percent),
        notes: rascunho.notes || null,
        itens: rascunho.itens
          .filter((i) => i.name.trim().length > 0)
          .map((i) => ({
            kind: i.kind,
            name: i.name,
            exam_type_id: i.exam_type_id,
            quantity_included: Number(i.quantity_included || 0),
            unit_price: numero(i.unit_price),
            extra_price: numero(i.extra_price),
          })),
      });
      setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Salvo.') : r.error });
      if (r.ok) setRascunho(null);
    });
  };

  const gerarPdf = (contractId: string) =>
    startTransition(async () => {
      setLinkDireto(null);
      const r = await gerarContratoPdf(contractId);
      setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Gerado.') : r.error });
      if (r.ok && r.data) {
        const aberto = await abrirDocumentoEmNovaAba(r.data.documentId);
        if (aberto.ok && !aberto.abriu) setLinkDireto(aberto.url);
      }
    });

  return (
    <div className="space-y-4">
      {mensagem && <Alert variant={mensagem.ok ? 'success' : 'error'}>{mensagem.texto}</Alert>}
      {linkDireto && (
        <a
          href={linkDireto}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Abrir o contrato em PDF
        </a>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title="Contratos"
            description={`${contratos.length} cadastrado(s)`}
            action={
              <Button size="sm" onClick={() => setRascunho(novoRascunho())}>
                <Plus className="h-3.5 w-3.5" /> Novo
              </Button>
            }
          />
          <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {contratos.map((c) => {
              const dias = diasAteVencer(c.ends_on);
              const situacao = situacaoDoContrato(dias);
              const { cor, rotulo } = CORES_SITUACAO[situacao];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setRascunho(paraRascunho(c))}
                  className={`w-full p-3 text-left hover:bg-slate-50 ${
                    rascunho?.id === c.id ? 'bg-slate-100' : ''
                  }`}
                >
                  <p className="truncate text-sm font-medium">
                    {c.companies?.trade_name ?? c.companies?.legal_name ?? 'Empresa'}
                  </p>
                  <p className="truncate text-xs text-slate-500">{c.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge color={cor}>{rotulo}</Badge>
                    {c.status !== 'ativo' && <Badge color="#94A3B8">{c.status}</Badge>}
                    {c.ends_on && (
                      <span className="text-[11px] text-slate-500">até {formatDate(c.ends_on)}</span>
                    )}
                  </div>
                </button>
              );
            })}
            {contratos.length === 0 && (
              <p className="p-4 text-sm text-slate-500">
                Nenhum contrato cadastrado. Clique em “Novo” para começar.
              </p>
            )}
          </div>
        </Card>

        <div className="lg:col-span-2">
          {rascunho ? (
            <Card>
              <CardHeader
                title={rascunho.id ? 'Editar contrato' : 'Novo contrato'}
                action={
                  <div className="flex flex-wrap gap-2">
                    {rascunho.id && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={pendente}
                          onClick={() => gerarPdf(rascunho.id as string)}
                        >
                          <FileDown className="h-3.5 w-3.5" /> Gerar PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={pendente}
                          onClick={() => {
                            const motivo = window.prompt('Motivo do encerramento:') ?? '';
                            if (motivo === null) return;
                            startTransition(async () => {
                              const r = await encerrarContrato(rascunho.id as string, motivo);
                              setMensagem({
                                ok: r.ok,
                                texto: r.ok ? (r.message ?? 'Encerrado.') : r.error,
                              });
                              if (r.ok) setRascunho(null);
                            });
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Encerrar
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setRascunho(null)}>
                      Cancelar
                    </Button>
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Empresa" className="md:col-span-2" required>
                    <Select
                      value={rascunho.company_id}
                      onChange={(e) => campo('company_id', e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {empresas.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Situação">
                    <Select value={rascunho.status} onChange={(e) => campo('status', e.target.value)}>
                      <option value="rascunho">Rascunho</option>
                      <option value="ativo">Ativo</option>
                      <option value="suspenso">Suspenso</option>
                      <option value="encerrado">Encerrado</option>
                      <option value="cancelado">Cancelado</option>
                    </Select>
                  </Field>

                  <Field label="Nome do contrato" className="md:col-span-2" required>
                    <Input value={rascunho.name} onChange={(e) => campo('name', e.target.value)} />
                  </Field>
                  <Field label="Código interno">
                    <Input value={rascunho.code} onChange={(e) => campo('code', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Assinado em">
                    <Input
                      type="date"
                      value={rascunho.signed_on}
                      onChange={(e) => campo('signed_on', e.target.value)}
                    />
                  </Field>
                  <Field label="Início da vigência">
                    <Input
                      type="date"
                      value={rascunho.starts_on}
                      onChange={(e) => campo('starts_on', e.target.value)}
                    />
                  </Field>
                  <Field label="Fim da vigência" hint="Base do alerta de 60 e 30 dias">
                    <Input
                      type="date"
                      value={rascunho.ends_on}
                      onChange={(e) => campo('ends_on', e.target.value)}
                    />
                  </Field>
                  <Field label="PCMSO válido até">
                    <Input
                      type="date"
                      value={rascunho.pcmso_valid_until}
                      onChange={(e) => campo('pcmso_valid_until', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Nº de funcionários">
                    <Input
                      type="number"
                      value={rascunho.employees_count}
                      onChange={(e) => campo('employees_count', e.target.value)}
                    />
                  </Field>
                  <Field label="Mensalidade (R$)">
                    <Input
                      type="number"
                      step="0.01"
                      value={rascunho.monthly_amount}
                      onChange={(e) => campo('monthly_amount', e.target.value)}
                    />
                  </Field>
                  <Field label="Valor total (R$)">
                    <Input
                      type="number"
                      step="0.01"
                      value={rascunho.amount}
                      onChange={(e) => campo('amount', e.target.value)}
                    />
                  </Field>
                  <Field label="Dia do vencimento" hint="1 a 28">
                    <Input
                      type="number"
                      min="1"
                      max="28"
                      value={rascunho.billing_day}
                      onChange={(e) => campo('billing_day', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Índice de reajuste">
                    <Input
                      value={rascunho.readjustment_index}
                      onChange={(e) => campo('readjustment_index', e.target.value)}
                    />
                  </Field>
                  <Field label="Multa por atraso (%)">
                    <Input
                      type="number"
                      step="0.01"
                      value={rascunho.late_fee_percent}
                      onChange={(e) => campo('late_fee_percent', e.target.value)}
                    />
                  </Field>
                  <Field label="Juros ao mês (%)">
                    <Input
                      type="number"
                      step="0.01"
                      value={rascunho.late_interest_percent}
                      onChange={(e) => campo('late_interest_percent', e.target.value)}
                    />
                  </Field>
                  <Field label="Hora técnica (R$)">
                    <Input
                      type="number"
                      step="0.01"
                      value={rascunho.technical_hour_rate}
                      onChange={(e) => campo('technical_hour_rate', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Médico coordenador">
                    <Input
                      value={rascunho.coordinator_name}
                      onChange={(e) => campo('coordinator_name', e.target.value)}
                    />
                  </Field>
                  <Field label="CRM do coordenador">
                    <Input
                      value={rascunho.coordinator_crm}
                      onChange={(e) => campo('coordinator_crm', e.target.value)}
                    />
                  </Field>
                  <Field label="E-mail de agendamento">
                    <Input
                      value={rascunho.schedule_email}
                      onChange={(e) => campo('schedule_email', e.target.value)}
                    />
                  </Field>
                  <Field label="E-mail do financeiro">
                    <Input
                      value={rascunho.billing_email}
                      onChange={(e) => campo('billing_email', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rascunho.auto_renew}
                      onChange={(e) => campo('auto_renew', e.target.checked)}
                    />
                    Renovação automática
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rascunho.esocial_enabled}
                      onChange={(e) => campo('esocial_enabled', e.target.checked)}
                    />
                    Inclui envio ao e-Social
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">Exames e serviços da cota</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRascunho((prev) =>
                          prev ? { ...prev, itens: [...prev.itens, itemVazio()] } : prev,
                        )
                      }
                    >
                      <Plus className="h-3.5 w-3.5" /> Incluir item
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {rascunho.itens.map((item) => (
                      <div
                        key={item.chave}
                        className="grid items-end gap-2 rounded-lg border border-slate-200 p-2 md:grid-cols-[110px_1fr_90px_110px_110px_40px]"
                      >
                        <Field label="Tipo">
                          <Select
                            value={item.kind}
                            onChange={(e) => atualizarItem(item.chave, 'kind', e.target.value)}
                          >
                            <option value="exame">Exame</option>
                            <option value="servico">Serviço</option>
                          </Select>
                        </Field>
                        <Field label="Item">
                          {item.kind === 'exame' && examTypes.length > 0 ? (
                            <Select
                              value={item.exam_type_id ?? ''}
                              onChange={(e) => escolherExame(item.chave, e.target.value)}
                            >
                              <option value="">Selecione o exame</option>
                              {examTypes.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Input
                              value={item.name}
                              onChange={(e) => atualizarItem(item.chave, 'name', e.target.value)}
                              placeholder="Ex.: Relatório anual"
                            />
                          )}
                        </Field>
                        <Field label="Cota">
                          <Input
                            type="number"
                            value={item.quantity_included}
                            onChange={(e) =>
                              atualizarItem(item.chave, 'quantity_included', e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Na cota (R$)">
                          <Input
                            type="number"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) =>
                              atualizarItem(item.chave, 'unit_price', e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Excedente (R$)">
                          <Input
                            type="number"
                            step="0.01"
                            value={item.extra_price}
                            onChange={(e) =>
                              atualizarItem(item.chave, 'extra_price', e.target.value)
                            }
                          />
                        </Field>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRascunho((prev) =>
                              prev
                                ? { ...prev, itens: prev.itens.filter((i) => i.chave !== item.chave) }
                                : prev,
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    {rascunho.itens.length === 0 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                        Sem itens na cota. O contrato sai com a cláusula de valores em branco.
                      </p>
                    )}
                  </div>
                </div>

                <Field label="Observações internas">
                  <Textarea
                    rows={2}
                    value={rascunho.notes}
                    onChange={(e) => campo('notes', e.target.value)}
                  />
                </Field>

                <Button
                  loading={pendente}
                  disabled={!rascunho.company_id || rascunho.name.trim().length < 3}
                  onClick={salvar}
                >
                  <Save className="h-4 w-4" /> Salvar contrato
                </Button>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="space-y-3">
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <FileText className="h-4 w-4" />
                  Selecione um contrato na lista ou clique em “Novo”.
                </p>
                {contratos.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs tracking-wide text-slate-500 uppercase">
                      Consumo da cota nos contratos ativos
                    </p>
                    {contratos
                      .filter((c) => c.status === 'ativo' && c.company_contract_items.length > 0)
                      .slice(0, 6)
                      .map((c) => (
                        <div key={c.id} className="rounded-lg border border-slate-200 p-2">
                          <p className="text-sm font-medium">
                            {c.companies?.trade_name ?? c.companies?.legal_name}
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                            {c.company_contract_items.slice(0, 4).map((i) => (
                              <li key={i.id} className="flex justify-between gap-2">
                                <span className="truncate">{i.name}</span>
                                <span className="tabular-nums">
                                  {i.quantity_used}/{i.quantity_included || '∞'}
                                  {i.extra_price !== null &&
                                    ` · excedente ${formatMoney(i.extra_price)}`}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
