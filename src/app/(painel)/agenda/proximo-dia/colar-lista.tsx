'use client';

import { useState, useTransition } from 'react';
import { ClipboardPaste, FileSpreadsheet, Trash2, Wand2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { lerTextoColado, type RegistroExtraido } from '@/modules/import/texto-livre';
import { aplicarTextoColado, type ResultadoTexto } from '@/modules/import/texto-actions';

/** Colunas mostradas na conferencia, na ordem em que a recepcao le. */
const COLUNAS: { chave: keyof RegistroExtraido; rotulo: string; largura: string }[] = [
  { chave: 'nome', rotulo: 'Nome', largura: 'min-w-52' },
  { chave: 'cpf', rotulo: 'CPF', largura: 'w-32' },
  { chave: 'nascimento', rotulo: 'Nascimento', largura: 'w-32' },
  { chave: 'rg', rotulo: 'RG', largura: 'w-28' },
  { chave: 'telefone', rotulo: 'Telefone', largura: 'w-32' },
  { chave: 'matricula', rotulo: 'Matrícula', largura: 'w-28' },
  { chave: 'empresa', rotulo: 'Empresa', largura: 'min-w-40' },
  { chave: 'tipoAtendimento', rotulo: 'Tipo', largura: 'w-32' },
  { chave: 'cargo', rotulo: 'Profissão', largura: 'min-w-32' },
  { chave: 'setor', rotulo: 'Setor', largura: 'min-w-28' },
  { chave: 'cep', rotulo: 'CEP', largura: 'w-28' },
  { chave: 'logradouro', rotulo: 'Endereço', largura: 'min-w-40' },
  { chave: 'numero', rotulo: 'Nº', largura: 'w-20' },
  { chave: 'bairro', rotulo: 'Bairro', largura: 'min-w-28' },
  { chave: 'cidade', rotulo: 'Cidade', largura: 'min-w-28' },
  { chave: 'uf', rotulo: 'UF', largura: 'w-16' },
  { chave: 'hora', rotulo: 'Hora', largura: 'w-24' },
];

const NOME_FORMATO: Record<string, string> = {
  pericias: 'lista de perícias agendadas',
  tabela: 'tabela com colunas',
  blocos: 'blocos separados por linha em branco',
  linhas: 'uma pessoa por linha',
  unico: 'texto corrido',
};

/**
 * Celula de data vira texto ISO antes de gerar o TSV.
 *
 * O Excel guarda o formato de exibicao junto com o valor, e a planilha do
 * SisPer vem com "mm-dd-yy". Exportado assim, 20/08/2026 sai como
 * "08-20-26" e seria lido de tras para frente. Reescrevendo aqui, a data
 * chega ao leitor sem ambiguidade nenhuma.
 */
function normalizarDatasDaAba(aba: XLSX.WorkSheet): void {
  for (const endereco of Object.keys(aba)) {
    if (endereco.startsWith('!')) continue;
    const celula = aba[endereco] as XLSX.CellObject | undefined;
    if (!celula || celula.t !== 'd' || !(celula.v instanceof Date)) continue;

    const d = celula.v;
    const p = (n: number) => String(n).padStart(2, '0');
    const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;

    celula.t = 's';
    celula.v = d.getHours() || d.getMinutes() ? `${iso} ${hora}` : iso;
    celula.w = celula.v;
    delete celula.z;
  }
}

export function ColarLista({ data }: { data: string }) {
  const [texto, setTexto] = useState('');
  const [registros, setRegistros] = useState<RegistroExtraido[] | null>(null);
  const [formato, setFormato] = useState<string>('');
  const [dataAlvo, setDataAlvo] = useState(data);
  const [horaPadrao, setHoraPadrao] = useState('08:00');
  const [aviso, setAviso] = useState<{ tipo: 'success' | 'error' | 'info'; texto: string } | null>(null);
  const [resultado, setResultado] = useState<ResultadoTexto | null>(null);
  const [gravando, iniciarGravacao] = useTransition();

  const analisar = () => {
    const lido = lerTextoColado(texto);
    setFormato(lido.formato);
    setRegistros(lido.registros);
    setResultado(null);
    setAviso(
      lido.registros.length === 0
        ? { tipo: 'error', texto: 'Não reconheci nenhuma pessoa nesse texto. Confira se o conteúdo foi colado inteiro.' }
        : {
            tipo: 'info',
            texto:
              `Li ${lido.registros.length} pessoa(s) — formato reconhecido: ${NOME_FORMATO[lido.formato]}.` +
              (lido.comAviso > 0
                ? ` ${lido.comAviso} precisa(m) de conferência (marcadas em amarelo).`
                : ''),
          },
    );
  };

  /**
   * Planilha vira texto com tabulacao e cai no mesmo leitor do texto colado.
   * Assim so existe um caminho de leitura para manter — a planilha nao ganha
   * regras proprias que possam divergir das do texto.
   */
  const abrirPlanilha = (arquivo: File) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const pasta = XLSX.read(leitor.result, { type: 'array', cellDates: true });
        const nomeAba = pasta.SheetNames[0];
        const aba = nomeAba ? pasta.Sheets[nomeAba] : undefined;
        if (!aba) {
          setAviso({ tipo: 'error', texto: 'A planilha está vazia.' });
          return;
        }
        normalizarDatasDaAba(aba);
        const tsv = XLSX.utils.sheet_to_csv(aba, { FS: '\t', blankrows: false });
        setTexto(tsv);
        const lido = lerTextoColado(tsv);
        setFormato(lido.formato);
        setRegistros(lido.registros);
        setAviso(
          lido.registros.length === 0
            ? { tipo: 'error', texto: `Li a planilha "${arquivo.name}" mas não reconheci nenhuma pessoa. Confira se a primeira aba é a da lista.` }
            : {
                tipo: 'info',
                texto:
                  `Planilha "${arquivo.name}": ${lido.registros.length} pessoa(s).` +
                  (lido.comAviso > 0 ? ` ${lido.comAviso} precisa(m) de conferência.` : ''),
              },
        );
      } catch {
        setAviso({ tipo: 'error', texto: 'Não consegui abrir esse arquivo. Se for .xls antigo, salve como .xlsx.' });
      }
    };
    leitor.onerror = () => setAviso({ tipo: 'error', texto: 'Falha ao ler o arquivo.' });
    leitor.readAsArrayBuffer(arquivo);
  };

  const editar = (indice: number, chave: keyof RegistroExtraido, valor: string) => {
    setRegistros((atual) =>
      (atual ?? []).map((r, i) => (i === indice ? { ...r, [chave]: valor || null } : r)),
    );
  };

  const remover = (indice: number) =>
    setRegistros((atual) => (atual ?? []).filter((_, i) => i !== indice));

  const confirmar = () => {
    if (!registros?.length) return;
    iniciarGravacao(async () => {
      const r = await aplicarTextoColado({
        data: dataAlvo,
        horaPadrao,
        criarEmpresas: true,
        registros: registros.map((reg) => ({
          nome: reg.nome ?? '',
          cpf: reg.cpf,
          rg: reg.rg,
          nascimento: reg.nascimento,
          sexo: reg.sexo,
          mae: reg.mae,
          telefone: reg.telefone,
          email: reg.email,
          cep: reg.cep,
          logradouro: reg.logradouro,
          numero: reg.numero,
          complemento: reg.complemento,
          bairro: reg.bairro,
          cidade: reg.cidade,
          uf: reg.uf,
          empresa: reg.empresa,
          cnpjEmpresa: reg.cnpjEmpresa,
          cargo: reg.cargo,
          setor: reg.setor,
          matricula: reg.matricula,
          protocolo: reg.protocolo,
          tipoAtendimento: reg.tipoAtendimento,
          hora: reg.hora,
          observacoes: reg.observacoes,
        })),
      });

      if (r.ok) {
        setResultado(r.data ?? null);
        setAviso({ tipo: 'success', texto: r.message ?? 'Agenda atualizada.' });
        setRegistros(null);
        setTexto('');
      } else {
        setAviso({ tipo: 'error', texto: r.error });
      }
    });
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title="Colar lista do próximo dia"
        description="Cole o texto em qualquer formato. O sistema identifica os dados e mostra a conferência antes de gravar."
      />
      <CardBody>
        {aviso && <Alert variant={aviso.tipo}>{aviso.texto}</Alert>}

        {resultado && (
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p>
              {resultado.agendamentosCriados} agendamento(s) · {resultado.pacientesCriados} paciente(s)
              novo(s) · {resultado.pacientesAtualizados} atualizado(s)
              {resultado.empresasCriadas > 0 && ` · ${resultado.empresasCriadas} empresa(s) criada(s)`}
            </p>
            {resultado.ignorados.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                {resultado.ignorados.map((i, n) => (
                  <li key={n}>
                    {i.nome}: {i.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!registros && (
          <>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={8}
              placeholder={
                'Cole aqui a lista de pacientes do próximo dia.\n\n' +
                'Aceita a lista de perícias do SisPer, planilha copiada, blocos com "Nome: ... CPF: ...", uma pessoa por linha ou texto corrido.\n' +
                'Para arquivo .xlsx, use o botão Abrir planilha.'
              }
              className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs focus:border-slate-500 focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={analisar} disabled={!texto.trim()}>
                <Wand2 className="h-4 w-4" /> Analisar texto
              </Button>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
                <FileSpreadsheet className="h-4 w-4" /> Abrir planilha
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) abrirPlanilha(arquivo);
                    e.target.value = '';
                  }}
                />
              </label>
              {texto && (
                <Button variant="outline" onClick={() => setTexto('')}>
                  Limpar
                </Button>
              )}
              <span className="text-xs text-slate-400">
                <ClipboardPaste className="mr-1 inline h-3 w-3" />
                nada é gravado antes da sua conferência
              </span>
            </div>
          </>
        )}

        {registros && registros.length > 0 && (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <Field label="Agendar para o dia">
                <Input type="date" value={dataAlvo} onChange={(e) => setDataAlvo(e.target.value)} />
              </Field>
              <Field label="Hora padrão" hint="Usada em quem não trouxe horário">
                <Input type="time" value={horaPadrao} onChange={(e) => setHoraPadrao(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Badge color="#64748B">{registros.length} pessoa(s)</Badge>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {COLUNAS.map((c) => (
                      <th key={c.chave} className="px-2 py-2 text-left font-semibold text-slate-600">
                        {c.rotulo}
                      </th>
                    ))}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {registros.map((reg, i) => (
                    <tr
                      key={i}
                      className={reg.avisos.length > 0 ? 'bg-amber-50' : 'odd:bg-white even:bg-slate-50/50'}
                    >
                      {COLUNAS.map((c) => (
                        <td key={c.chave} className="px-1 py-1">
                          <input
                            value={String(reg[c.chave] ?? '')}
                            onChange={(e) => editar(i, c.chave, e.target.value)}
                            className={`${c.largura} rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-slate-300 focus:border-slate-500 focus:bg-white focus:outline-none`}
                          />
                        </td>
                      ))}
                      <td className="px-1">
                        <button
                          type="button"
                          onClick={() => remover(i)}
                          aria-label={`Remover ${reg.nome ?? 'linha'}`}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Formato reconhecido: {NOME_FORMATO[formato]}. Qualquer campo pode ser corrigido aqui
              antes de gravar — linhas em amarelo vieram sem nome ou sem CPF válido.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={confirmar} loading={gravando}>
                Confirmar e agendar {registros.length} paciente(s)
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRegistros(null);
                  setAviso(null);
                }}
              >
                Voltar ao texto
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
