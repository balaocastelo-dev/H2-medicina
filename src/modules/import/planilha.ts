/**
 * Leitura de planilhas de agendamento do SISPER, do Estado e de ingresso.
 *
 * Cada origem exporta a planilha com o cabecalho que quer — "NOME",
 * "Nome do Servidor", "NOME COMPLETO". Em vez de exigir um modelo fixo,
 * o sistema reconhece os nomes mais comuns e deixa a conferencia na tela.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

import type { OriginKind } from '@/modules/queue/origin-kind';

export type CampoPlanilha =
  | 'nome'
  | 'cpf'
  | 'nascimento'
  | 'data'
  | 'hora'
  | 'matricula'
  | 'cargo'
  | 'setor'
  | 'empresa'
  | 'telefone'
  | 'observacoes';

export const CAMPOS: { campo: CampoPlanilha; label: string; obrigatorio: boolean }[] = [
  { campo: 'nome', label: 'Nome completo', obrigatorio: true },
  { campo: 'cpf', label: 'CPF', obrigatorio: false },
  { campo: 'nascimento', label: 'Data de nascimento', obrigatorio: false },
  { campo: 'data', label: 'Data do agendamento', obrigatorio: false },
  { campo: 'hora', label: 'Hora do agendamento', obrigatorio: false },
  { campo: 'matricula', label: 'Matrícula / RGF', obrigatorio: false },
  { campo: 'cargo', label: 'Cargo', obrigatorio: false },
  { campo: 'setor', label: 'Setor / lotação', obrigatorio: false },
  { campo: 'empresa', label: 'Empresa / órgão', obrigatorio: false },
  { campo: 'telefone', label: 'Telefone', obrigatorio: false },
  { campo: 'observacoes', label: 'Observações', obrigatorio: false },
];

/** Sinonimos aceitos por campo, ja normalizados (sem acento, minusculo). */
const SINONIMOS: Record<CampoPlanilha, string[]> = {
  nome: ['nome', 'nome completo', 'nome do servidor', 'nome do funcionario', 'servidor', 'paciente', 'funcionario', 'aluno', 'candidato'],
  cpf: ['cpf', 'cpf do servidor', 'n cpf', 'numero cpf', 'documento'],
  nascimento: ['nascimento', 'data nascimento', 'data de nascimento', 'dt nascimento', 'dn'],
  data: ['data', 'data agendamento', 'data do agendamento', 'data exame', 'data da pericia', 'data consulta', 'dia'],
  hora: ['hora', 'horario', 'hora agendamento', 'hora do agendamento', 'hr'],
  matricula: ['matricula', 'rgf', 'registro', 'matricula funcional', 're'],
  cargo: ['cargo', 'funcao', 'funcao exercida', 'posto'],
  setor: ['setor', 'lotacao', 'departamento', 'unidade', 'escola'],
  empresa: ['empresa', 'orgao', 'secretaria', 'instituicao', 'contratante'],
  telefone: ['telefone', 'fone', 'celular', 'contato', 'whatsapp'],
  observacoes: ['observacao', 'observacoes', 'obs', 'motivo', 'descricao'],
};

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Sugere a coluna da planilha para cada campo do sistema.
 *
 * Casamento exato primeiro, depois por prefixo. Assim "Nome" nao rouba a
 * coluna de "Nome da mae" quando as duas existem.
 */
export function sugerirMapeamento(cabecalhos: string[]): Partial<Record<CampoPlanilha, string>> {
  const mapa: Partial<Record<CampoPlanilha, string>> = {};
  const usados = new Set<string>();
  const normalizados = cabecalhos.map((h) => ({ original: h, chave: normalizar(h) }));

  for (const { campo } of CAMPOS) {
    const alternativas = SINONIMOS[campo];

    const exato = normalizados.find(
      (h) => !usados.has(h.original) && alternativas.includes(h.chave),
    );
    if (exato) {
      mapa[campo] = exato.original;
      usados.add(exato.original);
      continue;
    }

    const parcial = normalizados.find(
      (h) =>
        !usados.has(h.original) &&
        alternativas.some((a) => h.chave.startsWith(a) || h.chave.includes(a)),
    );
    if (parcial) {
      mapa[campo] = parcial.original;
      usados.add(parcial.original);
    }
  }

  return mapa;
}

/**
 * Converte data em varios formatos para ISO (aaaa-mm-dd).
 *
 * Aceita dd/mm/aaaa (o padrao das planilhas brasileiras), aaaa-mm-dd e o
 * numero serial do Excel, que aparece quando a celula foi formatada como
 * data e exportada sem tratamento.
 */
export function paraDataISO(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }

  if (typeof valor === 'number' && Number.isFinite(valor)) {
    // Serial do Excel: dias desde 30/12/1899.
    if (valor < 1 || valor > 100000) return null;
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + valor * 86400000).toISOString().slice(0, 10);
  }

  const texto = String(valor).trim();

  const brasileiro = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (brasileiro) {
    let dia = Number(brasileiro[1]);
    let mes = Number(brasileiro[2]);
    const a = brasileiro[3] ?? '';

    // Planilha exportada com formato americano manda mm-dd-aa. Quando o
    // segundo numero passa de 12 ele so pode ser dia, entao os dois trocam
    // de lugar. Sem isso "08-20-26" virava agosto de 2027 calado.
    if (mes > 12 && dia <= 12) [dia, mes] = [mes, dia];
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

    // Ano de dois digitos: acima de 50 e seculo passado (data de nascimento),
    // abaixo e este seculo.
    const ano = a.length === 2 ? Number(a) + (Number(a) > 50 ? 1900 : 2000) : Number(a);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (Number.isNaN(data.getTime())) return null;
    // 31/02 existe no construtor do Date, mas nao no calendario.
    if (data.getUTCDate() !== dia || data.getUTCMonth() !== mes - 1) return null;
    return data.toISOString().slice(0, 10);
  }

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}

/** Hora em HH:MM. Aceita "8", "8:30", "08h30" e o serial fracionario do Excel. */
export function paraHora(valor: unknown, padrao = '08:00'): string {
  if (valor === null || valor === undefined || valor === '') return padrao;

  if (typeof valor === 'number' && valor > 0 && valor < 1) {
    const minutosTotais = Math.round(valor * 24 * 60);
    const h = Math.floor(minutosTotais / 60);
    const m = minutosTotais % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const texto = String(valor).trim();
  const encontrado = texto.match(/^(\d{1,2})\s*[:h]?\s*(\d{2})?/i);
  if (!encontrado) return padrao;

  const h = Number(encontrado[1]);
  const m = Number(encontrado[2] ?? 0);
  if (h > 23 || m > 59) return padrao;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function somenteDigitos(valor: unknown): string {
  return String(valor ?? '').replace(/\D+/g, '');
}

export interface LinhaNormalizada {
  linha: number;
  nome: string;
  cpf: string | null;
  nascimento: string | null;
  agendadoEm: string | null;
  matricula: string | null;
  cargo: string | null;
  setor: string | null;
  empresa: string | null;
  telefone: string | null;
  observacoes: string | null;
  erros: string[];
}

/**
 * Normaliza a planilha inteira sem gravar nada.
 *
 * Linha com problema nao interrompe o lote: ela vem marcada com o motivo
 * para a tela mostrar antes de aplicar. Importacao que morre na linha 40
 * de 300 e pior que importacao que avisa.
 */
export function normalizarPlanilha(input: {
  linhas: Record<string, unknown>[];
  mapeamento: Partial<Record<CampoPlanilha, string>>;
  dataPadrao: string | null;
  horaPadrao?: string;
}): LinhaNormalizada[] {
  const { linhas, mapeamento } = input;
  const horaPadrao = input.horaPadrao ?? '08:00';

  const ler = (linha: Record<string, unknown>, campo: CampoPlanilha): unknown => {
    const coluna = mapeamento[campo];
    return coluna ? linha[coluna] : undefined;
  };

  const texto = (valor: unknown): string | null => {
    const v = String(valor ?? '').trim();
    return v.length > 0 ? v : null;
  };

  return linhas.map((linha, indice) => {
    const erros: string[] = [];

    const nome = texto(ler(linha, 'nome')) ?? '';
    if (nome.length < 3) erros.push('nome ausente ou muito curto');

    const cpfDigitos = somenteDigitos(ler(linha, 'cpf'));
    const cpf = cpfDigitos.length === 11 ? cpfDigitos : null;
    if (cpfDigitos.length > 0 && cpf === null) erros.push('CPF com número de dígitos inválido');

    const data = paraDataISO(ler(linha, 'data')) ?? input.dataPadrao;
    if (!data) erros.push('sem data de agendamento');

    const hora = paraHora(ler(linha, 'hora'), horaPadrao);
    const agendadoEm = data ? `${data}T${hora}:00` : null;

    return {
      linha: indice + 2, // +2: a linha 1 e o cabecalho e a contagem e humana
      nome,
      cpf,
      nascimento: paraDataISO(ler(linha, 'nascimento')),
      agendadoEm,
      matricula: texto(ler(linha, 'matricula')),
      cargo: texto(ler(linha, 'cargo')),
      setor: texto(ler(linha, 'setor')),
      empresa: texto(ler(linha, 'empresa')),
      telefone: texto(ler(linha, 'telefone')),
      observacoes: texto(ler(linha, 'observacoes')),
      erros,
    };
  });
}

/** Rotulo da procedencia usado no titulo da importacao. */
export const ROTULO_ORIGEM: Record<OriginKind, string> = {
  particular: 'Empresa / particular',
  estado: 'Estado (ESISLA)',
  sisper: 'SISPER',
  ingresso: 'Ingresso (escola)',
};
