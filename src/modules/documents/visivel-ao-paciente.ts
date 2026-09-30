/**
 * Quem pode ver cada documento.
 *
 * ---------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------
 * Todo gerador de documento gravava `is_patient_visible: true`, fixo. A
 * coluna nasce `false` na migration justamente porque a decisao era para
 * ser tomada por tipo de documento — e nunca foi.
 *
 * O portal do paciente (`/meu`) autentica com CPF + data de nascimento. Os
 * dois campos vem impressos no A.S.O. que a clinica entrega ao RH da
 * empresa. Com "true" em tudo, quem tivesse aquele papel na mao baixava a
 * ficha clinica e a avaliacao psicossocial da pessoa — pressao, IMC,
 * glicemia, antecedentes, estilo de vida, saude mental.
 *
 * Entao a regra passa a ser explicita: no portal de baixo atrito so
 * aparece documento administrativo. Documento clinico continua saindo
 * normalmente pela clinica — impresso, entregue em maos, anexado ao
 * A.S.O. — e continua visivel para a equipe com permissao clinica.
 *
 * Nao e restricao de funcionalidade: e a funcionalidade que faltava.
 */

/**
 * Tipos que o paciente abre sozinho no portal.
 *
 * Todos sao papel de balcao: comprovam que ele esteve aqui, o que pagou,
 * o que agendou, ou trazem de volta algo que ele mesmo assinou.
 */
const ADMINISTRATIVOS = new Set<string>([
  'recibo',
  'comprovante_comparecimento',
  'atestado_comparecimento',
  'comprovante_agendamento',
  'comprovante_compra',
  'resumo_pedido',
  // A guia leva o paciente ao laboratorio ou ao raio X: sem ela em maos,
  // ele volta ao balcao so para pedir a segunda via.
  'guia_exame',
  // Autorizacao de envio de resultado: e a declaracao dele proprio.
  'autorizacao_envio_resultados',
]);

/**
 * Papel da empresa, nao do paciente: nao vai ao portal, e tambem nao pede
 * permissao clinica para abrir — quem cuida de contrato e do faturamento.
 */
const EMPRESARIAIS = new Set<string>(['contrato_empresa', 'relatorio_empresarial']);

/**
 * Tipos que carregam dado clinico. Nao entram no portal e, na clinica, so
 * abrem para quem tem permissao clinica.
 */
const CLINICOS = new Set<string>([
  'ficha_clinica',
  'avaliacao_psicossocial',
  'resultado_exame',
  'resumo_atendimento',
  'aso',
  'documento_final',
  'relacao_exames',
]);

/** O paciente pode abrir este tipo no portal com CPF + nascimento? */
export function pacientePodeVer(kind: string): boolean {
  return ADMINISTRATIVOS.has(kind);
}

/**
 * Este tipo carrega dado clinico?
 *
 * Tipo desconhecido conta como clinico de proposito: documento novo entra
 * fechado e alguem decide abrir, nunca o contrario. Foi o "true" fixo que
 * criou o problema.
 */
export function ehDocumentoClinico(kind: string): boolean {
  if (CLINICOS.has(kind)) return true;
  if (ADMINISTRATIVOS.has(kind) || EMPRESARIAIS.has(kind)) return false;
  return true;
}
