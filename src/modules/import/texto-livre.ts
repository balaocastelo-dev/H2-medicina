/**
 * Leitura de texto colado, em qualquer formato.
 *
 * A recepcao copia a lista do proximo dia de onde vier — planilha, e-mail,
 * PDF, tela de portal — e cola numa caixa. Nao da para exigir um modelo
 * fixo, entao aqui o texto e lido por evidencia: CPF valida por digito
 * verificador, CEP tem oito digitos, data tem barra, empresa termina em
 * LTDA. O que o sistema nao tiver certeza vira aviso, e a conferencia
 * acontece na tela antes de gravar qualquer coisa.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

import { isValidCNPJ, isValidCPF } from '@/lib/validators';
import { normalizar, paraDataISO } from './planilha';

export interface RegistroExtraido {
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  nascimento: string | null;
  sexo: 'masculino' | 'feminino' | null;
  mae: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  empresa: string | null;
  cnpjEmpresa: string | null;
  cargo: string | null;
  setor: string | null;
  matricula: string | null;
  data: string | null;
  hora: string | null;
  observacoes: string | null;
  /** Trecho original, para a conferencia na tela. */
  bruto: string;
  /** O que ficou duvidoso. Vazio significa leitura limpa. */
  avisos: string[];
}

const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR',
  'RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

/** Rotulo (ja normalizado) -> campo do registro. */
const ROTULOS: Record<string, keyof RegistroExtraido> = {
  nome: 'nome', 'nome completo': 'nome', 'nome do servidor': 'nome', paciente: 'nome',
  servidor: 'nome', funcionario: 'nome', candidato: 'nome', aluno: 'nome', trabalhador: 'nome',
  cpf: 'cpf', 'cpf do servidor': 'cpf',
  rg: 'rg', identidade: 'rg', 'registro geral': 'rg', 'doc identidade': 'rg',
  nascimento: 'nascimento', 'data de nascimento': 'nascimento', 'data nascimento': 'nascimento',
  'dt nascimento': 'nascimento', dn: 'nascimento',
  sexo: 'sexo', genero: 'sexo',
  mae: 'mae', 'nome da mae': 'mae', 'filiacao': 'mae',
  telefone: 'telefone', fone: 'telefone', celular: 'telefone', contato: 'telefone',
  whatsapp: 'telefone', tel: 'telefone',
  email: 'email', 'e mail': 'email',
  cep: 'cep',
  endereco: 'logradouro', logradouro: 'logradouro', rua: 'logradouro', av: 'logradouro',
  avenida: 'logradouro',
  numero: 'numero', 'n': 'numero', 'no': 'numero', 'nro': 'numero',
  complemento: 'complemento', compl: 'complemento',
  bairro: 'bairro', distrito: 'bairro',
  cidade: 'cidade', municipio: 'cidade', localidade: 'cidade',
  uf: 'uf', estado: 'uf',
  empresa: 'empresa', orgao: 'empresa', secretaria: 'empresa', instituicao: 'empresa',
  contratante: 'empresa', 'razao social': 'empresa', empregador: 'empresa',
  cnpj: 'cnpjEmpresa',
  cargo: 'cargo', funcao: 'cargo', profissao: 'cargo', ocupacao: 'cargo',
  'funcao exercida': 'cargo',
  setor: 'setor', lotacao: 'setor', departamento: 'setor', unidade: 'setor', escola: 'setor',
  matricula: 'matricula', rgf: 'matricula', registro: 'matricula', re: 'matricula',
  data: 'data', 'data do agendamento': 'data', 'data agendamento': 'data', 'data exame': 'data',
  dia: 'data',
  hora: 'hora', horario: 'hora', 'hora do agendamento': 'hora',
  obs: 'observacoes', observacao: 'observacoes', observacoes: 'observacoes', motivo: 'observacoes',
};

const PALAVRAS_EMPRESA = /\b(ltda|eireli|epp|s\.?\/?a\b|me\b|mei\b|prefeitura|secretaria|municipio|instituto|fundacao|associacao|cooperativa|industria|comercio)\b/i;
const PALAVRAS_ENDERECO = /^(rua|r\.|av|av\.|avenida|travessa|tv\.|alameda|al\.|estrada|est\.|rodovia|rod\.|praca|praça|largo|viela|passagem|quadra|conjunto)\b/i;

function vazio(bruto: string): RegistroExtraido {
  return {
    nome: null, cpf: null, rg: null, nascimento: null, sexo: null, mae: null,
    telefone: null, email: null, cep: null, logradouro: null, numero: null,
    complemento: null, bairro: null, cidade: null, uf: null, empresa: null,
    cnpjEmpresa: null, cargo: null, setor: null, matricula: null, data: null,
    hora: null, observacoes: null, bruto, avisos: [],
  };
}

function limpar(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim().replace(/^[:\-–—,;.]+|[:\-–—,;]+$/g, '').trim();
}

/** Só dígitos. */
function digitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

// ---------------------------------------------------------------------
// Separacao em registros
// ---------------------------------------------------------------------

export type Formato = 'tabela' | 'blocos' | 'linhas' | 'unico';

export interface Deteccao {
  formato: Formato;
  /** Delimitador da tabela, quando for o caso. */
  delimitador?: string;
  /** A primeira linha da tabela parece cabecalho. */
  temCabecalho?: boolean;
}

/** Descobre como o texto esta organizado antes de tentar ler os campos. */
export function detectarFormato(texto: string): Deteccao {
  const linhas = texto.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (linhas.length === 0) return { formato: 'unico' };

  // Tabela: o mesmo delimitador aparece em quase toda linha, sempre a mesma
  // quantidade de vezes. Virgula fica de fora porque texto corrido tem virgula.
  for (const delim of ['\t', ';', '|']) {
    const contagens = linhas.map((l) => l.split(delim).length - 1);
    const comDelim = contagens.filter((c) => c > 0).length;
    if (comDelim >= Math.max(2, Math.ceil(linhas.length * 0.7))) {
      const moda = contagens.filter((c) => c > 0).sort()[Math.floor(comDelim / 2)] ?? 0;
      if (moda >= 1) {
        return {
          formato: 'tabela',
          delimitador: delim,
          temCabecalho: pareceCabecalho(linhas[0]!.split(delim)),
        };
      }
    }
  }

  // Blocos separados por linha em branco.
  const blocos = texto.split(/\r?\n\s*\r?\n/).filter((b) => b.trim() !== '');
  if (blocos.length >= 2) return { formato: 'blocos' };

  // Uma pessoa por linha (lista simples). Exige que a maioria das linhas
  // traga CPF: se o CPF vier numa linha e o nome noutra, isso aqui nao e
  // uma lista, e um bloco por pessoa — e quem resolve e a ancora de CPF.
  if (linhas.length >= 2) {
    const comCpf = linhas.filter((l) => acharCPF(l)).length;
    if (comCpf >= 2 && comCpf >= linhas.length * 0.7) return { formato: 'linhas' };
  }

  return { formato: 'unico' };
}

function pareceCabecalho(celulas: string[]): boolean {
  const conhecidas = celulas.filter((c) => ROTULOS[normalizar(c)]).length;
  const temCpfNaLinha = celulas.some((c) => acharCPF(c));
  return conhecidas >= 2 && !temCpfNaLinha;
}

/**
 * Quebra o texto colado em um trecho por pessoa.
 *
 * Quando o formato nao e obvio, o CPF serve de ancora: encontrar um segundo
 * CPF significa que comecou outra pessoa.
 */
export function dividirRegistros(texto: string): string[] {
  const det = detectarFormato(texto);
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (det.formato === 'tabela') {
    return det.temCabecalho ? linhas : linhas.slice();
  }
  if (det.formato === 'blocos') {
    return texto.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  }
  if (det.formato === 'linhas') {
    return linhas.map((l) => l.trim());
  }

  // Texto corrido: agrupa linhas ate aparecer o CPF seguinte.
  const grupos: string[] = [];
  let atual: string[] = [];
  let jaTemCpf = false;
  for (const linha of linhas) {
    const temCpf = !!acharCPF(linha);
    if (temCpf && jaTemCpf) {
      grupos.push(atual.join('\n'));
      atual = [];
      jaTemCpf = false;
    }
    atual.push(linha);
    if (temCpf) jaTemCpf = true;
  }
  if (atual.length) grupos.push(atual.join('\n'));
  return grupos.filter((g) => g.trim() !== '');
}

// ---------------------------------------------------------------------
// Achadores de campo
// ---------------------------------------------------------------------

/** Primeiro CPF valido do texto. Valida digito, entao nao pega numero solto. */
export function acharCPF(texto: string): string | null {
  const candidatos = texto.match(/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}/g) ?? [];
  for (const c of candidatos) {
    const so = digitos(c);
    if (so.length === 11 && isValidCPF(so)) return so;
  }
  return null;
}

export function acharCNPJ(texto: string): string | null {
  const candidatos = texto.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g) ?? [];
  for (const c of candidatos) {
    const so = digitos(c);
    if (so.length === 14 && isValidCNPJ(so)) return so;
  }
  return null;
}

/** Data em qualquer notacao comum, devolvida em AAAA-MM-DD. */
export function acharDatas(texto: string): string[] {
  const achados = texto.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const saida: string[] = [];
  for (const bruto of achados) {
    const iso = paraDataISO(bruto.replace(/[.\-]/g, '/').replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3'));
    if (iso && !saida.includes(iso)) saida.push(iso);
  }
  return saida;
}

/** Telefone brasileiro com DDD. */
export function acharTelefone(texto: string): string | null {
  const achados =
    texto.match(/\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g) ?? [];
  for (const bruto of achados) {
    const so = digitos(bruto);
    if (so.length === 10 || so.length === 11) return so;
  }
  return null;
}

export function acharCEP(texto: string): string | null {
  const achado = texto.match(/\b\d{5}[-\s]?\d{3}\b/);
  return achado ? digitos(achado[0]) : null;
}

export function acharEmail(texto: string): string | null {
  const achado = texto.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return achado ? achado[0].toLowerCase() : null;
}

function acharSexo(texto: string): 'masculino' | 'feminino' | null {
  const t = normalizar(texto);
  if (/\b(feminino|fem|mulher)\b/.test(t)) return 'feminino';
  if (/\b(masculino|masc|homem)\b/.test(t)) return 'masculino';
  if (/\bsexo\s*f\b/.test(t)) return 'feminino';
  if (/\bsexo\s*m\b/.test(t)) return 'masculino';
  return null;
}

/**
 * Um nome de pessoa: duas palavras ou mais, so letras, sem cara de empresa
 * nem de endereco. Serve de ultimo recurso quando nao ha rotulo "Nome:".
 */
function pareceNome(trecho: string): boolean {
  const limpo = limpar(trecho);
  if (limpo.length < 5 || limpo.length > 80) return false;
  if (/\d/.test(limpo)) return false;
  if (PALAVRAS_EMPRESA.test(limpo) || PALAVRAS_ENDERECO.test(limpo)) return false;
  const palavras = limpo.split(/\s+/).filter((p) => p.length > 1);
  if (palavras.length < 2) return false;
  return /^[A-Za-zÀ-ÿ\s'.]+$/.test(limpo);
}

// ---------------------------------------------------------------------
// Leitura de um registro
// ---------------------------------------------------------------------

const CAMPOS_TEXTO = new Set<keyof RegistroExtraido>([
  'nome','rg','mae','logradouro','numero','complemento','bairro','cidade','uf',
  'empresa','cargo','setor','matricula','observacoes','hora',
]);

/**
 * Localiza os rotulos conhecidos no texto.
 *
 * Um rotulo pode ter ate tres palavras ("data de nascimento"), e a mesma
 * linha pode trazer varios ("Nome: X  CPF: Y"). Como o regex nao sabe onde
 * um valor termina e o proximo rotulo comeca, ele captura de forma folgada
 * e depois vai encurtando o candidato pela direita ate cair num rotulo
 * conhecido — assim "Maria da Silva  CPF" acaba reconhecido como "CPF".
 */
interface Achado {
  campo: keyof RegistroExtraido;
  /** Onde o rotulo comeca, para o valor anterior parar aqui. */
  inicio: number;
  /** Onde o valor comeca. */
  fim: number;
}

function localizarRotulos(texto: string): Achado[] {
  const re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.]*(?:[ \t]+[A-Za-zÀ-ÿ.]+){0,3})[ \t]*:[ \t]*/g;
  const achados: Achado[] = [];

  for (const casa of texto.matchAll(re)) {
    const bruto = casa[1] ?? '';
    const palavras = bruto.split(/[ \t]+/).filter(Boolean);

    // Tenta o rotulo inteiro, depois so as ultimas palavras.
    for (let corte = 0; corte < palavras.length; corte += 1) {
      const candidato = palavras.slice(corte).join(' ');
      const campo = ROTULOS[normalizar(candidato)];
      if (!campo) continue;

      const deslocamento = bruto.indexOf(candidato);
      achados.push({
        campo,
        inicio: casa.index + (deslocamento < 0 ? 0 : deslocamento),
        fim: casa.index + casa[0].length,
      });
      break;
    }
  }

  return achados;
}

/** Le "Rotulo: valor" em qualquer lugar do texto, inclusive varios na mesma linha. */
function lerRotulados(texto: string, reg: RegistroExtraido): string {
  const achados = localizarRotulos(texto);
  if (achados.length === 0) return texto;

  // Marca o que foi consumido para o restante nao ser lido de novo.
  const consumido: [number, number][] = [];

  achados.forEach((achado, i) => {
    const limite = achados[i + 1]?.inicio ?? texto.length;
    const bruto = texto.slice(achado.fim, limite);
    // Valor nao atravessa quebra de linha: o proximo campo comeca ali.
    const valor = limpar(bruto.split(/\r?\n/)[0] ?? '');
    if (!valor) return;

    consumido.push([achado.inicio, achado.fim + valor.length]);
    aplicarCampo(reg, achado.campo, valor);
  });

  // Devolve o texto sem os trechos ja lidos.
  let restante = '';
  let cursor = 0;
  for (const [ini, fim] of consumido.sort((a, b) => a[0] - b[0])) {
    if (ini > cursor) restante += texto.slice(cursor, ini);
    cursor = Math.max(cursor, fim);
  }
  restante += texto.slice(cursor);
  return restante;
}

/** Grava um valor ja isolado no campo certo, validando conforme o tipo. */
function aplicarCampo(
  reg: RegistroExtraido,
  campo: keyof RegistroExtraido,
  valor: string,
): void {
  if (campo === 'cpf') {
    reg.cpf = acharCPF(valor) ?? reg.cpf;
  } else if (campo === 'cnpjEmpresa') {
    reg.cnpjEmpresa = acharCNPJ(valor) ?? reg.cnpjEmpresa;
  } else if (campo === 'nascimento' || campo === 'data') {
    const datas = acharDatas(valor);
    if (datas[0] && !reg[campo]) reg[campo] = datas[0];
  } else if (campo === 'telefone') {
    reg.telefone = acharTelefone(valor) ?? reg.telefone;
  } else if (campo === 'email') {
    reg.email = acharEmail(valor) ?? reg.email;
  } else if (campo === 'cep') {
    reg.cep = acharCEP(valor) ?? reg.cep;
  } else if (campo === 'sexo') {
    reg.sexo = acharSexo(valor) ?? reg.sexo;
  } else if (campo === 'logradouro') {
    // "Endereco: Rua X, 100 - Centro - Cidade/UF" traz varios campos juntos.
    lerEndereco(valor, reg);
  } else if (campo === 'uf') {
    const uf = valor.toUpperCase().slice(0, 2);
    if (UFS.includes(uf)) reg.uf = uf;
  } else if (CAMPOS_TEXTO.has(campo) && !reg[campo]) {
    (reg as unknown as Record<string, unknown>)[campo] = valor;
  }
}

/** Quebra "Rua X, 100 - Centro - Cidade/UF" nas partes que der. */
export function lerEndereco(linha: string, reg: RegistroExtraido): void {
  const partes = linha.split(/\s+-\s+|\s*–\s*/);
  const primeira = partes[0] ?? '';

  const comNumero = primeira.match(/^(.*?),?\s*(?:n[.ºo°]?\s*)?(\d+[A-Za-z]?)\s*(?:,\s*(.*))?$/);
  if (comNumero) {
    if (!reg.logradouro) reg.logradouro = limpar(comNumero[1]!);
    if (!reg.numero) reg.numero = comNumero[2]!;
    if (comNumero[3] && !reg.complemento) reg.complemento = limpar(comNumero[3]);
  } else if (!reg.logradouro) {
    reg.logradouro = limpar(primeira);
  }

  for (const parte of partes.slice(1)) {
    const limpo = limpar(parte);
    if (!limpo) continue;

    const cidadeUf = limpo.match(/^(.+?)\s*[/-]\s*([A-Za-z]{2})$/);
    if (cidadeUf && UFS.includes(cidadeUf[2]!.toUpperCase())) {
      if (!reg.cidade) reg.cidade = limpar(cidadeUf[1]!);
      reg.uf = cidadeUf[2]!.toUpperCase();
      continue;
    }
    if (/^\d{5}-?\d{3}$/.test(limpo)) {
      reg.cep = digitos(limpo);
      continue;
    }
    if (!reg.bairro) reg.bairro = limpo;
    else if (!reg.cidade) reg.cidade = limpo;
  }
}

/**
 * Decide qual data e nascimento e qual e agendamento.
 *
 * Nascimento fica no passado e da uma idade plausivel; agendamento fica
 * perto de hoje. Sem rotulo, e a idade que resolve.
 */
export function classificarDatas(
  datas: string[],
  reg: RegistroExtraido,
  hoje = new Date(),
): void {
  const anoHoje = hoje.getFullYear();
  for (const iso of datas) {
    const ano = Number(iso.slice(0, 4));
    const idade = anoHoje - ano;
    if (!reg.nascimento && idade >= 14 && idade <= 110) reg.nascimento = iso;
    else if (!reg.data && idade >= -1 && idade <= 1) reg.data = iso;
  }
}

/** Le um trecho de texto e devolve tudo que deu para identificar. */
export function extrairRegistro(bruto: string, hoje = new Date()): RegistroExtraido {
  const reg = vazio(bruto.trim());
  const restante = lerRotulados(bruto, reg);

  // Documentos e contatos aparecem em qualquer posicao.
  reg.cpf ??= acharCPF(bruto);
  reg.cnpjEmpresa ??= acharCNPJ(bruto);
  reg.telefone ??= acharTelefone(restante);
  reg.email ??= acharEmail(bruto);
  reg.sexo ??= acharSexo(bruto);

  // CEP so depois do CPF, senao o pedaco do CPF vira CEP.
  const semDocs = bruto
    .replace(/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}/g, ' ')
    .replace(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g, ' ');
  reg.cep ??= acharCEP(semDocs);

  const horaAchada = restante.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (!reg.hora && horaAchada) {
    reg.hora = `${horaAchada[1]!.padStart(2, '0')}:${horaAchada[2]}`;
  }

  classificarDatas(acharDatas(bruto), reg, hoje);

  // Linhas soltas: endereco, empresa e, por eliminacao, o nome.
  // Os documentos saem antes, senao "Maria da Silva 529.982.247-25" nunca
  // passaria no teste de nome (que recusa qualquer digito).
  const linhas = restante
    .replace(/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}/g, ' ')
    .replace(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g, ' ')
    .split(/\r?\n|\s{3,}|\t|;|\|/)
    .map((l) => limpar(l))
    .filter(Boolean);

  for (const linha of linhas) {
    if (!reg.logradouro && PALAVRAS_ENDERECO.test(linha)) {
      lerEndereco(linha, reg);
      continue;
    }
    if (!reg.empresa && PALAVRAS_EMPRESA.test(linha) && !pareceNome(linha)) {
      reg.empresa = linha;
      continue;
    }
    if (!reg.nome && pareceNome(linha)) {
      reg.nome = tituloDeNome(linha);
    }
  }

  if (reg.nome) reg.nome = tituloDeNome(reg.nome);
  if (!reg.uf) {
    const uf = restante.match(/\b([A-Z]{2})\b/g)?.find((u) => UFS.includes(u));
    if (uf) reg.uf = uf;
  }

  if (!reg.nome) reg.avisos.push('Nome não identificado');
  if (!reg.cpf) reg.avisos.push('CPF não identificado ou inválido');

  return reg;
}

/** "MARIA DA SILVA" -> "Maria da Silva". Preposicao fica minuscula. */
export function tituloDeNome(nome: string): string {
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return limpar(nome)
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

// ---------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------

export interface ResultadoLeitura {
  formato: Formato;
  registros: RegistroExtraido[];
  /** Quantos vieram sem nome ou sem CPF valido. */
  comAviso: number;
}

/**
 * Le o texto colado inteiro.
 *
 * Nunca lanca excecao: texto ilegivel devolve lista vazia, e a tela mostra
 * que nada foi reconhecido em vez de quebrar.
 */
export function lerTextoColado(texto: string, hoje = new Date()): ResultadoLeitura {
  const limpo = (texto ?? '').replace(/ /g, ' ').trim();
  if (!limpo) return { formato: 'unico', registros: [], comAviso: 0 };

  const det = detectarFormato(limpo);

  let registros: RegistroExtraido[];
  if (det.formato === 'tabela' && det.delimitador) {
    registros = lerTabela(limpo, det.delimitador, det.temCabecalho ?? false, hoje);
  } else {
    registros = dividirRegistros(limpo).map((bloco) => extrairRegistro(bloco, hoje));
  }

  // Trecho que nao rendeu nada nao vira linha na tela.
  registros = registros.filter((r) => r.nome || r.cpf);

  return {
    formato: det.formato,
    registros,
    comAviso: registros.filter((r) => r.avisos.length > 0).length,
  };
}

/** Tabela com delimitador: usa o cabecalho quando existe, senao adivinha. */
function lerTabela(
  texto: string,
  delimitador: string,
  temCabecalho: boolean,
  hoje: Date,
): RegistroExtraido[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = temCabecalho ? linhas[0]!.split(delimitador).map((c) => limpar(c)) : null;
  const corpo = temCabecalho ? linhas.slice(1) : linhas;

  return corpo.map((linha) => {
    const celulas = linha.split(delimitador).map((c) => limpar(c));

    if (!cabecalho) {
      // Sem cabecalho, cada celula e avaliada isolada e o registro sai da
      // juncao — o mesmo caminho do texto corrido.
      return extrairRegistro(celulas.join('\n'), hoje);
    }

    // Com cabecalho, monta "Rotulo: valor" e reaproveita o leitor rotulado,
    // que ja sabe validar CPF, data e telefone.
    const rotulado = cabecalho
      .map((titulo, i) => (celulas[i] ? `${titulo}: ${celulas[i]}` : ''))
      .filter(Boolean)
      .join('\n');
    const reg = extrairRegistro(rotulado, hoje);
    reg.bruto = linha.trim();
    return reg;
  });
}
