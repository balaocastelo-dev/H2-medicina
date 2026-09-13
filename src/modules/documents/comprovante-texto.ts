/**
 * Texto do comprovante de agendamento, no formato que a clinica ja usa.
 *
 * A recepcao digitava isso a mao no WhatsApp, paciente por paciente. O
 * modelo veio da propria clinica em 21/08 — mantemos a ordem, os emojis e
 * o "por ordem de chegada" em destaque, porque e o que os pacientes ja
 * reconhecem.
 *
 * Nada aqui e fixo para a H2: endereco, CEP e telefones vem das
 * configuracoes do tenant.
 *
 * Logica pura: sem banco, sem sessao, testavel direto.
 */

export interface DadosDoComprovante {
  paciente: string;
  /** AAAA-MM-DD */
  data: string;
  /** HH:MM */
  hora: string;
  /** admissional, periodico, demissional... */
  tipoAtendimento?: string | null;
  clinica: {
    nome: string;
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    cep?: string | null;
    /** "Próximo ao Clube Fonte São Paulo" */
    referencia?: string | null;
    whatsapp?: string | null;
    telefone?: string | null;
  };
}

const NOME_DO_EXAME: Record<string, string> = {
  admissional: 'EXAME ADMISSIONAL',
  periodico: 'EXAME PERIÓDICO',
  demissional: 'EXAME DEMISSIONAL',
  mudanca_funcao: 'EXAME DE MUDANÇA DE FUNÇÃO',
  retorno_trabalho: 'EXAME DE RETORNO AO TRABALHO',
  pericia: 'PERÍCIA',
  consulta: 'ATENDIMENTO',
  outro: 'ATENDIMENTO',
};

/** "2026-08-24" -> "24/08" */
export function diaEMes(dataISO: string): string {
  const [, mes, dia] = dataISO.split('-');
  return mes && dia ? `${dia}/${mes}` : dataISO;
}

/** "2026-08-24" -> "24/08/2026" */
export function dataPorExtenso(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : dataISO;
}

/** "13010210" -> "13010-210" */
export function cepFormatado(cep: string | null | undefined): string {
  const so = (cep ?? '').replace(/\D/g, '');
  return so.length === 8 ? `${so.slice(0, 5)}-${so.slice(5)}` : (cep ?? '');
}

/** Endereco numa linha so, pulando o que nao estiver preenchido. */
export function linhaDoEndereco(clinica: DadosDoComprovante['clinica']): string {
  const rua = [clinica.logradouro, clinica.numero ? `nº ${clinica.numero}` : null]
    .filter(Boolean)
    .join(' ');
  const cidade = [clinica.cidade, clinica.uf].filter(Boolean).join('/');
  return [rua, clinica.bairro, cidade].filter(Boolean).join(' – ');
}

/**
 * Monta o texto pronto para colar no WhatsApp.
 *
 * Linha que depende de dado ausente some inteira — comprovante com
 * "CEP: " vazio passa a impressao de sistema mal preenchido.
 */
export function montarComprovanteTexto(dados: DadosDoComprovante): string {
  const { clinica } = dados;
  const titulo = NOME_DO_EXAME[dados.tipoAtendimento ?? ''] ?? 'ATENDIMENTO';
  const endereco = linhaDoEndereco(clinica);
  const cep = cepFormatado(clinica.cep);

  const linhas: (string | null)[] = [
    `_*${diaEMes(dados.data)}* -  AGENDAMENTO ${titulo} – ${clinica.nome.toUpperCase()}-`,
    '',
    dados.paciente,
    '',
    `🏥${clinica.nome.toUpperCase()}`,
    endereco ? `📍 ${endereco}` : null,
    cep ? `📌 CEP: ${cep}${clinica.referencia ? ` (${clinica.referencia})` : ''}` : null,
    '',
    `⏰ Horário: ${dados.hora}`,
    `📅 Data: ${dataPorExtenso(dados.data)}`,
    '*Por ordem de chegada*',
    '',
    '⚠️ Obrigatório:',
    '• Levar documento pessoal com foto',
    '',
    '❗ Caso não possa comparecer por favor, avisar com antecedência.',
    '',
    clinica.whatsapp ? `📱 WhatsApp: ${clinica.whatsapp}` : null,
    clinica.telefone && clinica.telefone !== clinica.whatsapp
      ? `☎️ Telefone: ${clinica.telefone}`
      : null,
  ];

  return linhas.filter((l) => l !== null).join('\n').trim();
}

/**
 * Versao para o PDF, sem emoji.
 *
 * A fonte embutida no PDF nao tem os simbolos, e eles sairiam como
 * quadradinhos no papel entregue ao paciente.
 */
export function montarComprovanteImpresso(dados: DadosDoComprovante): string {
  return montarComprovanteTexto(dados)
    .replace(/[🏥📍📌⏰📅⚠️❗📱☎️•]/gu, '')
    .replace(/[_*]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
