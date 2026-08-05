/**
 * Interpretador de comandos em linguagem natural (pt-BR).
 *
 * E deterministico de proposito: o mesmo texto sempre produz a mesma intencao.
 * Isso permite que o servidor reinterprete o comando na hora de executar, sem
 * confiar em nada vindo do navegador — e torna o comportamento testavel.
 *
 * Quando um provedor de IA estiver configurado, ele pode ser usado para
 * traduzir frases fora dos padroes conhecidos para uma destas intencoes; a
 * execucao continua passando por aqui.
 */

export interface SalaContexto {
  id: string;
  nome: string;
  codigo: string;
}

export interface ContextoComando {
  salas: SalaContexto[];
}

export type Intencao =
  | { tipo: 'chamar_proximo'; salaId: string; salaNome: string }
  | {
      tipo: 'criar_cobranca';
      cpf: string;
      valor: number;
      descricao: string;
      metodo: 'pix' | 'cartao' | 'dinheiro' | 'faturamento';
    }
  | {
      tipo: 'criar_profissional';
      nome: string;
      papel: 'medico_examinador' | 'atendimento' | 'administrativo';
      conselhoTipo: string | null;
      conselhoNumero: string | null;
      conselhoUf: string | null;
      email: string | null;
    }
  | { tipo: 'buscar_paciente'; termo: string }
  | { tipo: 'ajuda' }
  | { tipo: 'desconhecida'; motivo: string; sugestoes: string[] };

export interface Leitura {
  intencao: Intencao;
  /** Frase que descreve o que sera feito, para o usuario confirmar. */
  resumo: string;
  /** Permissao exigida para executar. */
  permissao: string | null;
}

export const EXEMPLOS = [
  'chamar o próximo da fila na sala de audiometria',
  'criar uma cobrança para o paciente do cpf 529.982.247-25 no valor de 200,00',
  'cadastrar o médico dr miguel crm 00002520',
  'buscar paciente maria',
];

/** Remove acentos e normaliza espacos para facilitar a comparacao. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function extrairCpf(texto: string): string | null {
  const m = texto.match(/(\d[\d.\-\s]{9,16}\d)/g);
  if (!m) return null;
  for (const bruto of m) {
    const digitos = bruto.replace(/\D/g, '');
    if (digitos.length === 11) return digitos;
  }
  return null;
}

/**
 * Le valores em reais: "200", "200,00", "R$ 1.250,50", "1250.50".
 * Assume o formato brasileiro quando ha virgula.
 */
export function extrairValor(texto: string): number | null {
  const limpo = texto.replace(/r\$\s*/gi, '');
  const m = limpo.match(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2}|\d+)/g);
  if (!m) return null;

  // Ignora numeros que sao claramente CPF/CRM (muitos digitos seguidos).
  const candidatos = m.filter((v) => v.replace(/\D/g, '').length <= 8);
  const bruto = candidatos[candidatos.length - 1];
  if (!bruto) return null;

  let numero: number;
  if (bruto.includes(',')) {
    numero = Number(bruto.replace(/\./g, '').replace(',', '.'));
  } else {
    numero = Number(bruto);
  }
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

export function extrairConselho(texto: string): {
  tipo: string | null;
  numero: string | null;
  uf: string | null;
} {
  const m = texto.match(/\b(crm|coren|crf|crp|cro)\b[\s:/-]*([a-z]{2})?[\s:/-]*(\d{3,10})/i);
  if (!m) return { tipo: null, numero: null, uf: null };
  const ufDepois = texto.match(
    new RegExp(`${m[3]}\\s*[/-]?\\s*([a-z]{2})\\b`, 'i'),
  );
  return {
    tipo: (m[1] ?? '').toUpperCase(),
    numero: m[3] ?? null,
    uf: (m[2] ?? ufDepois?.[1] ?? '').toUpperCase() || null,
  };
}

/** Similaridade simples por sobreposicao de palavras e prefixos. */
export function pontuarSala(consulta: string, sala: SalaContexto): number {
  const alvo = normalizar(`${sala.nome} ${sala.codigo}`);
  const termos = normalizar(consulta)
    .split(' ')
    .filter((t) => t.length >= 3);
  if (termos.length === 0) return 0;

  let pontos = 0;
  for (const termo of termos) {
    if (alvo.includes(termo)) pontos += termo.length * 2;
    else if (alvo.split(' ').some((p) => p.startsWith(termo.slice(0, 4)))) pontos += 3;
  }
  return pontos;
}

export function acharSala(consulta: string, salas: SalaContexto[]): SalaContexto | null {
  let melhor: SalaContexto | null = null;
  let melhorPonto = 0;
  for (const sala of salas) {
    const p = pontuarSala(consulta, sala);
    if (p > melhorPonto) {
      melhorPonto = p;
      melhor = sala;
    }
  }
  return melhorPonto >= 6 ? melhor : null;
}

export function extrairNomePessoa(texto: string): string | null {
  // Frases reais encadeiam titulos ("cadastro médico para o médico dr miguel").
  // Por isso o nome e procurado depois do ULTIMO titulo encontrado.
  const titulos =
    /\b(?:dr\.?a?|doutora?|medic[oa]|profissional|usuari[oa]|atendente|recepcionista|enfermeir[oa])\b/gi;

  let ultimoFim = -1;
  for (const m of texto.matchAll(titulos)) {
    if (m.index !== undefined) ultimoFim = m.index + m[0].length;
  }
  if (ultimoFim < 0) return null;

  const parada = new Set([
    'crm','coren','crf','crp','cro','com','para','no','na','de','do','da','em','e','o','a','os','as',
    'numero','registro','novo','nova','cadastro','sistema',
  ]);

  const partes: string[] = [];
  for (const bruto of texto.slice(ultimoFim).split(/\s+/)) {
    const palavra = bruto.replace(/[^a-zA-Zà-úÀ-Ú]/g, '');
    if (!palavra) {
      if (partes.length > 0) break; // chegou num numero: o nome acabou
      continue;
    }
    if (parada.has(normalizar(palavra))) {
      if (partes.length > 0) break;
      continue;
    }
    partes.push(palavra);
    if (partes.length === 3) break;
  }

  if (partes.length === 0) return null;
  return partes
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function metodoDe(texto: string): 'pix' | 'cartao' | 'dinheiro' | 'faturamento' {
  if (/\bcartao\b|\bcartão\b/i.test(texto)) return 'cartao';
  if (/\bdinheiro\b|\bespecie\b/i.test(texto)) return 'dinheiro';
  if (/\bfatur|\bboleto|\bempresa\b/i.test(texto)) return 'faturamento';
  return 'pix';
}

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Traduz o texto digitado em uma intencao executavel. */
export function interpretar(texto: string, contexto: ContextoComando): Leitura {
  const t = normalizar(texto);

  if (!t || t.length < 3) {
    return {
      intencao: { tipo: 'ajuda' },
      resumo: 'Digite o que você precisa fazer.',
      permissao: null,
    };
  }

  if (/^(ajuda|help|o que voce faz|comandos|\?)$/.test(t)) {
    return { intencao: { tipo: 'ajuda' }, resumo: 'Lista de comandos', permissao: null };
  }

  // ---- chamar proximo da fila ----
  if (/(chamar|chama|chame|proximo|próximo)/.test(t) && /(fila|sala|guiche|chamar)/.test(t)) {
    const consulta = t.replace(/.*?(?:sala|guiche|consultorio)\s*(?:de|da|do)?\s*/, '');
    const sala = acharSala(consulta || t, contexto.salas);
    if (!sala) {
      return {
        intencao: {
          tipo: 'desconhecida',
          motivo: 'Não identifiquei a sala.',
          sugestoes: contexto.salas.map((s) => `chamar proximo na sala ${s.nome.toLowerCase()}`),
        },
        resumo: 'Sala não encontrada',
        permissao: null,
      };
    }
    return {
      intencao: { tipo: 'chamar_proximo', salaId: sala.id, salaNome: sala.nome },
      resumo: `Chamar o proximo paciente da fila em ${sala.nome}.`,
      permissao: 'filas.operar',
    };
  }

  // ---- criar cobranca ----
  if (/(cobranca|cobrança|cobrar|pagamento|fatura)/.test(t) && /(criar|gerar|lancar|fazer|nova|novo)/.test(t)) {
    const cpf = extrairCpf(texto);
    const valor = extrairValor(texto);

    if (!cpf) {
      return {
        intencao: {
          tipo: 'desconhecida',
          motivo: 'Informe o CPF do paciente (11 digitos).',
          sugestoes: ['criar cobrança para o paciente do cpf 529.982.247-25 no valor de 200,00'],
        },
        resumo: 'CPF não informado',
        permissao: null,
      };
    }
    if (!valor) {
      return {
        intencao: {
          tipo: 'desconhecida',
          motivo: 'Informe o valor da cobrança.',
          sugestoes: [`criar cobranca para o cpf ${cpf} no valor de 200,00`],
        },
        resumo: 'Valor não informado',
        permissao: null,
      };
    }

    const metodo = metodoDe(t);
    const descMatch = texto.match(/(?:referente a|para o exame de|descricao|descrição)\s+([^,.;]+)/i);
    const descricao = (descMatch?.[1] ?? 'Cobrança lancada pelo assistente').trim();

    return {
      intencao: { tipo: 'criar_cobranca', cpf, valor, descricao, metodo },
      resumo: `Criar cobranca de ${moeda(valor)} (${metodo}) para o paciente do CPF ${cpf}.`,
      permissao: 'financeiro.registrar',
    };
  }

  // ---- cadastrar profissional / usuario ----
  if (/(cadastrar|criar|adicionar|incluir)/.test(t) && /(medic|usuari|profissional|atendente|recepcionista|cadastro)/.test(t)) {
    const nome = extrairNomePessoa(texto);
    if (!nome) {
      return {
        intencao: {
          tipo: 'desconhecida',
          motivo: 'Não identifiquei o nome do profissional.',
          sugestoes: ['cadastrar o médico dr miguel crm 00002520'],
        },
        resumo: 'Nome não identificado',
        permissao: null,
      };
    }

    const conselho = extrairConselho(texto);
    const ehMedico = /medic|dr\.?a?\b|doutora?/.test(t) || !!conselho.numero;
    const ehAtendimento = /atendente|recepcionista|recepcao/.test(t);
    const papel = ehMedico
      ? 'medico_examinador'
      : ehAtendimento
        ? 'atendimento'
        : 'administrativo';

    const emailMatch = texto.match(/[\w.+-]+@[\w-]+\.[\w.]+/);

    return {
      intencao: {
        tipo: 'criar_profissional',
        nome,
        papel,
        conselhoTipo: conselho.tipo,
        conselhoNumero: conselho.numero,
        conselhoUf: conselho.uf,
        email: emailMatch?.[0] ?? null,
      },
      resumo:
        `Cadastrar ${nome} como ${papel === 'medico_examinador' ? 'médico e examinador' : papel === 'atendimento' ? 'atendimento e recepção' : 'administrativo'}` +
        (conselho.numero ? ` (${conselho.tipo} ${conselho.numero}${conselho.uf ? '/' + conselho.uf : ''})` : '') +
        '.',
      permissao: 'usuarios.administrar',
    };
  }

  // ---- buscar paciente ----
  if (/(buscar|procurar|localizar|achar|encontrar)/.test(t) && /(paciente|pessoa|cpf)/.test(t)) {
    const cpf = extrairCpf(texto);
    const termo =
      cpf ??
      texto
        .replace(/.*?(?:paciente|pessoa)\s*/i, '')
        .replace(/[?.!]/g, '')
        .trim();
    if (!termo) {
      return {
        intencao: {
          tipo: 'desconhecida',
          motivo: 'Informe o nome ou o CPF do paciente.',
          sugestoes: ['buscar paciente maria'],
        },
        resumo: 'Termo não informado',
        permissao: null,
      };
    }
    return {
      intencao: { tipo: 'buscar_paciente', termo },
      resumo: `Buscar pacientes por "${termo}".`,
      permissao: 'pacientes.ver',
    };
  }

  return {
    intencao: {
      tipo: 'desconhecida',
      motivo: 'Ainda não sei fazer isso.',
      sugestoes: EXEMPLOS,
    },
    resumo: 'Comando não reconhecido',
    permissao: null,
  };
}
