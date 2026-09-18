/**
 * Verificacao publica de documento pelo codigo impresso.
 *
 * Todo documento sai com "Codigo de verificacao: XXXXXXXXXX" no rodape.
 * Ate agora esse codigo nao levava a lugar nenhum: o A.S.O. chegava no RH
 * da empresa cliente prometendo uma conferencia que nao existia.
 *
 * Esta pagina e PUBLICA e sem login. Entao a regra e o contrario do resto
 * do sistema: ela confirma que o documento e autentico, e nao conta o que
 * ha dentro dele. Quem verifica ja tem o papel na mao -- precisa casar o
 * que ve com o que a clinica registrou, nao descobrir nada novo.
 *
 * Logica pura: sem banco, testavel direto.
 */

/**
 * Formato do codigo: 10 caracteres hexadecimais em maiuscula.
 *
 * Vem de `randomBytes(5).toString('hex').toUpperCase()`. Sao 16^10, algo
 * como um trilhao de combinacoes -- tentar adivinhar pela internet nao e
 * caminho. A conferencia de formato existe para barrar varredura antes de
 * chegar ao banco, nao como seguranca por si so.
 */
export const CODIGO_VALIDO = /^[0-9A-F]{10}$/;

/**
 * Aceita o codigo do jeito que a pessoa digita.
 *
 * Quem esta com o papel na mao copia com espaco, hifen, minuscula, e as
 * vezes o rotulo junto. Recusar por causa disso e empurrar o problema
 * para quem nao tem culpa.
 */
export function normalizarCodigo(bruto: string | null | undefined): string {
  return String(bruto ?? '')
    .toUpperCase()
    .replace(/^.*?VERIFICA[ÇC][ÃA]O\s*:?\s*/u, '')
    .replace(/[^0-9A-F]/g, '');
}

/**
 * Nome do paciente parcialmente escondido.
 *
 * "ROBERTO DA SILVA OLIVEIRA" -> "Roberto D. S. O."
 *
 * Quem tem o documento reconhece na hora; quem so tem o codigo nao
 * descobre de quem e. Sem isso a pagina viraria uma consulta de nomes.
 */
export function mascararNome(nome: string | null | undefined): string {
  const partes = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (partes.length === 0) return '—';

  const primeiro = partes[0]!;
  const capitalizado = primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
  const iniciais = partes.slice(1).map((p) => `${p.charAt(0).toUpperCase()}.`);

  return [capitalizado, ...iniciais].join(' ');
}

/** Nome amigavel de cada tipo de documento. */
export const NOME_DO_TIPO: Record<string, string> = {
  aso: 'Atestado de Saúde Ocupacional (A.S.O.)',
  ficha_clinica: 'Ficha clínica',
  resultado_exame: 'Laudo de exame',
  guia_exame: 'Guia de exame',
  comprovante_comparecimento: 'Comprovante de comparecimento',
  atestado_comparecimento: 'Atestado de comparecimento',
  relacao_exames: 'Relação de exames',
  resumo_atendimento: 'Resumo do atendimento',
  documento_final: 'Documento final',
  recibo: 'Recibo de pagamento',
  comprovante_agendamento: 'Comprovante de agendamento',
  contrato_empresa: 'Contrato',
  autorizacao_envio_resultados: 'Autorização de envio de resultados',
};

export function descreverTipo(kind: string | null | undefined): string {
  return NOME_DO_TIPO[String(kind ?? '')] ?? 'Documento';
}

/**
 * Endereco que sai impresso ao lado do codigo.
 *
 * A clinica pode configurar um proprio (dominio dela, por exemplo). Sem
 * configuracao, cai na propria pagina do sistema -- antes o codigo saia
 * sozinho, prometendo uma conferencia sem dizer onde fazer.
 */
export function urlDeVerificacao(
  configurada: string | null | undefined,
  baseUrl: string | null | undefined,
): string | null {
  const escolhida = String(configurada ?? '').trim();
  if (escolhida) return escolhida.replace(/\/+$/, '');

  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;

  return `${base.replace(/^https?:\/\//, '')}/verificar`;
}

export type SituacaoDoDocumento = 'autentico' | 'cancelado' | 'nao_encontrado';

export interface DocumentoVerificado {
  situacao: SituacaoDoDocumento;
  tipo: string;
  emitidoEm: string | null;
  paciente: string;
  assinante: string | null;
  conselho: string | null;
  clinica: string;
}

export interface LinhaDeDocumento {
  kind: string;
  title: string | null;
  generated_at: string | null;
  deleted_at: string | null;
  signer_name: string | null;
  signer_council: string | null;
  patients: { full_name: string } | null;
}

/**
 * Monta a resposta publica a partir da linha do banco.
 *
 * Documento apagado responde "cancelado", e nao "nao encontrado": a
 * diferenca importa para quem esta com o papel na mao. Um documento que a
 * clinica revogou nao pode passar por valido, e sumir sem explicacao faria
 * o RH achar que errou de codigo.
 */
export function montarResposta(
  linha: LinhaDeDocumento | null,
  nomeDaClinica: string,
): DocumentoVerificado {
  if (!linha) {
    return {
      situacao: 'nao_encontrado',
      tipo: '—',
      emitidoEm: null,
      paciente: '—',
      assinante: null,
      conselho: null,
      clinica: nomeDaClinica,
    };
  }

  return {
    situacao: linha.deleted_at ? 'cancelado' : 'autentico',
    tipo: descreverTipo(linha.kind),
    emitidoEm: linha.generated_at,
    paciente: mascararNome(linha.patients?.full_name),
    assinante: linha.signer_name,
    conselho: linha.signer_council,
    clinica: nomeDaClinica,
  };
}
