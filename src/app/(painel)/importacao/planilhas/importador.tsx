'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
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
  Table,
  Td,
  Th,
} from '@/components/ui';
import { formatCPF, formatDateTime, todayISO } from '@/lib/format';
import { ORIGIN_KINDS, REGRAS, type OriginKind } from '@/modules/queue/origin-kind';
import {
  CAMPOS,
  normalizarPlanilha,
  ROTULO_ORIGEM,
  sugerirMapeamento,
  type CampoPlanilha,
  type LinhaNormalizada,
} from '@/modules/import/planilha';
import { aplicarImportacaoPlanilha } from '@/modules/import/actions';

/**
 * Importador de planilha em tres passos: arquivo, conferencia, gravacao.
 *
 * A leitura acontece no navegador de proposito — a planilha nunca sobe
 * inteira para o servidor antes de alguem olhar. O que vai para o banco e
 * a lista ja normalizada e conferida na tela.
 */
export function ImportadorPlanilha({
  companies,
  examTypes,
}: {
  companies: { id: string; label: string }[];
  examTypes: { id: string; name: string }[];
}) {
  const [originKind, setOriginKind] = useState<OriginKind>('sisper');
  const [companyId, setCompanyId] = useState('');
  const [dataPadrao, setDataPadrao] = useState(todayISO());
  const [horaPadrao, setHoraPadrao] = useState('08:00');
  const [exames, setExames] = useState<string[]>([]);

  const [nomeArquivo, setNomeArquivo] = useState('');
  const [cabecalhos, setCabecalhos] = useState<string[]>([]);
  const [linhasBrutas, setLinhasBrutas] = useState<Record<string, unknown>[]>([]);
  const [mapeamento, setMapeamento] = useState<Partial<Record<CampoPlanilha, string>>>({});

  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [aplicado, setAplicado] = useState(false);
  const [pendente, startTransition] = useTransition();

  const normalizadas: LinhaNormalizada[] = useMemo(() => {
    if (linhasBrutas.length === 0) return [];
    return normalizarPlanilha({
      linhas: linhasBrutas,
      mapeamento,
      dataPadrao: dataPadrao || null,
      horaPadrao,
    });
  }, [linhasBrutas, mapeamento, dataPadrao, horaPadrao]);

  const validas = normalizadas.filter((l) => l.erros.length === 0);
  const comErro = normalizadas.filter((l) => l.erros.length > 0);

  const lerArquivo = (arquivo: File) => {
    setMensagem(null);
    setAplicado(false);
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const planilha = XLSX.read(leitor.result, { type: 'array', cellDates: true });
        const primeira = planilha.SheetNames[0];
        const aba = primeira ? planilha.Sheets[primeira] : undefined;
        if (!aba) {
          setMensagem({ ok: false, texto: 'A planilha não tem nenhuma aba.' });
          return;
        }
        const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, {
          defval: null,
          raw: false,
          dateNF: 'yyyy-mm-dd',
        });
        const primeiraLinha = linhas[0];
        if (!primeiraLinha) {
          setMensagem({ ok: false, texto: 'A primeira aba da planilha está vazia.' });
          return;
        }
        const colunas = Object.keys(primeiraLinha);
        setNomeArquivo(arquivo.name);
        setCabecalhos(colunas);
        setLinhasBrutas(linhas);
        setMapeamento(sugerirMapeamento(colunas));
      } catch {
        setMensagem({
          ok: false,
          texto: 'Não foi possível ler o arquivo. Envie um .xlsx, .xls ou .csv.',
        });
      }
    };
    leitor.readAsArrayBuffer(arquivo);
  };

  const aplicar = () =>
    startTransition(async () => {
      const r = await aplicarImportacaoPlanilha({
        originKind,
        companyId: companyId || null,
        fileName: nomeArquivo,
        linhas: normalizadas,
        examTypeIds: exames,
      });
      setMensagem({ ok: r.ok, texto: r.ok ? (r.message ?? 'Importado.') : r.error });
      if (r.ok) setAplicado(true);
    });

  return (
    <div className="space-y-4">
      {mensagem && <Alert variant={mensagem.ok ? 'success' : 'error'}>{mensagem.texto}</Alert>}

      <Card>
        <CardHeader
          title="1. Origem e arquivo"
          description="A procedência define por onde o paciente andará na clínica"
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORIGIN_KINDS.map((kind) => {
              const r = REGRAS[kind];
              const ativo = originKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setOriginKind(kind)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 text-center transition ${
                    ativo ? 'text-white' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  style={ativo ? { backgroundColor: r.color, borderColor: r.color } : undefined}
                >
                  <span className="text-lg leading-none font-bold">{r.letter}</span>
                  <span className="text-[11px] leading-tight">{r.short}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Field
              label="Empresa / órgão (opcional)"
              className="md:col-span-2"
              hint="Vincula todos os pacientes da planilha a este cadastro"
            >
              <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Sem vínculo</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Data padrão" hint="Usada quando a linha não traz data">
              <Input
                type="date"
                value={dataPadrao}
                onChange={(e) => setDataPadrao(e.target.value)}
              />
            </Field>
            <Field label="Hora padrão">
              <Input type="time" value={horaPadrao} onChange={(e) => setHoraPadrao(e.target.value)} />
            </Field>
          </div>

          <div>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-slate-400">
              <FileSpreadsheet className="h-8 w-8 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">
                {nomeArquivo || 'Selecionar planilha (.xlsx, .xls ou .csv)'}
              </span>
              <span className="text-xs text-slate-500">
                A leitura acontece no seu computador — nada sobe antes da conferência
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) lerArquivo(arquivo);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </CardBody>
      </Card>

      {cabecalhos.length > 0 && (
        <Card>
          <CardHeader
            title="2. Conferir as colunas"
            description="O sistema reconheceu o que pôde. Ajuste o que estiver errado."
          />
          <CardBody className="grid gap-3 md:grid-cols-3">
            {CAMPOS.map(({ campo, label, obrigatorio }) => (
              <Field key={campo} label={label} required={obrigatorio}>
                <Select
                  value={mapeamento[campo] ?? ''}
                  onChange={(e) =>
                    setMapeamento((prev) => ({
                      ...prev,
                      [campo]: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">— não usar —</option>
                  {cabecalhos.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </CardBody>
        </Card>
      )}

      {examTypes.length > 0 && cabecalhos.length > 0 && (
        <Card>
          <CardHeader
            title="Exames aplicados a todos"
            description="Opcional — os mesmos exames entram em cada agendamento da planilha"
          />
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {examTypes.map((e) => (
                <label
                  key={e.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm"
                >
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
                </label>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {normalizadas.length > 0 && (
        <Card>
          <CardHeader
            title="3. Conferir e importar"
            description={`${validas.length} linha(s) prontas · ${comErro.length} com problema`}
            action={
              <Button
                loading={pendente}
                disabled={validas.length === 0 || aplicado}
                onClick={aplicar}
              >
                <Upload className="h-4 w-4" />
                {aplicado ? 'Importado' : `Importar ${validas.length} agendamento(s)`}
              </Button>
            }
          />
          <CardBody className="p-0">
            {comErro.length > 0 && (
              <div className="border-b border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  {comErro.length} linha(s) não serão importadas
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                  {comErro.slice(0, 8).map((l) => (
                    <li key={l.linha}>
                      Linha {l.linha}
                      {l.nome ? ` (${l.nome})` : ''}: {l.erros.join(', ')}
                    </li>
                  ))}
                  {comErro.length > 8 && <li>… e mais {comErro.length - 8}.</li>}
                </ul>
              </div>
            )}

            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Nome</Th>
                    <Th>CPF</Th>
                    <Th>Agendamento</Th>
                    <Th>Cargo / setor</Th>
                    <Th>Situação</Th>
                  </tr>
                </thead>
                <tbody>
                  {normalizadas.slice(0, 200).map((l) => (
                    <tr key={l.linha} className={l.erros.length > 0 ? 'bg-amber-50' : undefined}>
                      <Td>{l.linha}</Td>
                      <Td>{l.nome || '—'}</Td>
                      <Td>{l.cpf ? formatCPF(l.cpf) : '—'}</Td>
                      <Td>{l.agendadoEm ? formatDateTime(l.agendadoEm) : '—'}</Td>
                      <Td>{[l.cargo, l.setor].filter(Boolean).join(' · ') || '—'}</Td>
                      <Td>
                        {l.erros.length === 0 ? (
                          <Badge color="#22C55E">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />
                            pronta
                          </Badge>
                        ) : (
                          <span className="text-xs text-amber-800">{l.erros.join(', ')}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {normalizadas.length > 200 && (
                <p className="p-3 text-xs text-slate-500">
                  Mostrando as 200 primeiras de {normalizadas.length}. A importação processa todas.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {cabecalhos.length === 0 && (
        <Alert variant="info" title={`Procedência selecionada: ${ROTULO_ORIGEM[originKind]}`}>
          {REGRAS[originKind].description}
        </Alert>
      )}
    </div>
  );
}
