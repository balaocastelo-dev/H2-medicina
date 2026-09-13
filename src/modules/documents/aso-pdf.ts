import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { CATEGORIAS, type Riscos } from './riscos';

/**
 * A.S.O. no modelo que a clinica ja usa em papel.
 *
 * A estrutura veio do ASO_BRANCO.docx entregue pela clinica: blocos com
 * faixa de titulo e pares rotulo/valor, o quadro de perigos e fatores de
 * risco exigido pela NR-7, o parecer em caixas de marcar e o espaco de
 * carimbo e assinatura no rodape.
 *
 * A ordem dos blocos e a redacao dos rotulos sao as do documento deles:
 * quem confere o A.S.O. na empresa procura a informacao onde sempre esteve.
 */

export interface DadosAso {
  clinica: {
    nome: string;
    razaoSocial: string;
    cnpj: string | null;
    endereco: string | null;
    telefone: string | null;
    cor: string;
  };
  emitidoEm: Date;
  empresaContratante: {
    razaoSocial: string;
    cnpj: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    cep: string | null;
  };
  funcionario: {
    nome: string;
    matricula: string | null;
    cpf: string | null;
    rg: string | null;
    nascimento: string;
    idade: number | null;
    sexo: string;
    cargo: string | null;
    setor: string | null;
  };
  medicoPcmso: {
    nome: string | null;
    conselho: string;
    numero: string | null;
    uf: string | null;
    rqe: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    cep: string | null;
    telefone: string | null;
  };
  medicoExaminador: {
    nome: string;
    conselho: string;
    numero: string | null;
    uf: string | null;
  };
  riscos: Riscos;
  tipoExame: string;
  /** Exame e data de realizacao, como sai no modelo da clinica. */
  exames: { nome: string; data: string | null }[];
  /** apto | apto_com_restricoes | inapto | inconclusivo */
  parecer: string;
  restricoes: string | null;
  validade: string | null;
  observacoes: string | null;
  assinaturaPaciente: string | null;
  assinaturaMedico?: string | null;
  codigoVerificacao: string;
  urlVerificacao: string | null;
  rodape: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 38;
const LARGURA = A4[0] - MARGEM * 2;

const PORTARIAS =
  'EM CUMPRIMENTO ÀS PORTARIAS Nºs 3214/78, 3164/82, 12/83, 24/94 E 08/96 NR7 DO ' +
  'MINISTÉRIO DO TRABALHO E EMPREGO PARA FINS DE EXAME:';

function hexParaRgb(hex: string) {
  const limpo = (hex ?? '').replace('#', '');
  const cheio = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  const n = (i: number) => parseInt(cheio.slice(i, i + 2), 16) / 255;
  const [r, g, b] = [n(0), n(2), n(4)];
  return rgb(
    Number.isFinite(r) ? r : 0.06,
    Number.isFinite(g) ? g : 0.46,
    Number.isFinite(b) ? b : 0.43,
  );
}

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of (texto ?? '').split(/\s+/)) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(teste, tamanho) > largura && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export async function buildAsoPdf(d: DadosAso): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cor = hexParaRgb(d.clinica.cor);
  const cinza = rgb(0.42, 0.45, 0.5);
  const preto = rgb(0.1, 0.1, 0.12);
  const borda = rgb(0.75, 0.78, 0.81);

  let pagina: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGEM;

  const novaPagina = () => {
    pagina = pdf.addPage(A4);
    pagina.drawRectangle({ x: 0, y: A4[1] - 5, width: A4[0], height: 5, color: cor });
    y = A4[1] - MARGEM;
    pagina.drawText(`${d.funcionario.nome} — continuação do A.S.O.`, {
      x: MARGEM, y, size: 8, font: negrito, color: cinza,
    });
    y -= 18;
  };

  const espaco = (altura: number) => {
    if (y - altura < 150) novaPagina();
  };

  /** Faixa de titulo de bloco, como no modelo em Word. */
  const faixa = (titulo: string) => {
    espaco(26);
    pagina.drawRectangle({ x: MARGEM, y: y - 12, width: LARGURA, height: 15, color: rgb(0.9, 0.92, 0.93) });
    pagina.drawText(titulo, { x: MARGEM + 6, y: y - 8.5, size: 8.5, font: negrito, color: rgb(0.2, 0.22, 0.25) });
    y -= 20;
  };

  /** Linha com duas colunas de rotulo/valor, como as tabelas do modelo. */
  const paresEmDuasColunas = (pares: [string, string | null][]) => {
    const validos = pares.filter(([, v]) => v !== null && String(v).trim() !== '');
    for (let i = 0; i < validos.length; i += 2) {
      espaco(14);
      validos.slice(i, i + 2).forEach(([rotulo, valor], coluna) => {
        const x = MARGEM + 4 + coluna * (LARGURA / 2);
        pagina.drawText(`${rotulo}:`, { x, y, size: 7.5, font: negrito, color: cinza });
        const desloc = negrito.widthOfTextAtSize(`${rotulo}: `, 7.5);
        const larguraValor = LARGURA / 2 - desloc - 10;
        const texto = quebrar(String(valor), fonte, 8, larguraValor)[0] ?? '';
        pagina.drawText(texto, { x: x + desloc, y, size: 8, font: fonte, color: preto });
      });
      y -= 12.5;
    }
    y -= 4;
  };

  // -------------------------------------------------------------------
  // Cabecalho
  // -------------------------------------------------------------------
  pagina.drawRectangle({ x: 0, y: A4[1] - 5, width: A4[0], height: 5, color: cor });

  pagina.drawText('A S O – ATESTADO DE SAÚDE OCUPACIONAL', {
    x: MARGEM, y: y - 4, size: 14, font: negrito, color: preto,
  });
  y -= 20;

  pagina.drawText(d.clinica.razaoSocial, { x: MARGEM, y, size: 8, font: negrito, color: cor });
  const dataEmissao = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d.emitidoEm);
  pagina.drawText(`Emitido em ${dataEmissao}`, {
    x: A4[0] - MARGEM - fonte.widthOfTextAtSize(`Emitido em ${dataEmissao}`, 8.5),
    y, size: 8.5, font: negrito, color: preto,
  });
  y -= 10;

  for (const linha of [d.clinica.cnpj, d.clinica.endereco, d.clinica.telefone].filter(Boolean)) {
    pagina.drawText(String(linha), { x: MARGEM, y, size: 7, font: fonte, color: cinza });
    y -= 8.5;
  }
  y -= 6;

  // -------------------------------------------------------------------
  // Empresa
  // -------------------------------------------------------------------
  faixa('Empresa');
  paresEmDuasColunas([
    ['Razão Social', d.empresaContratante.razaoSocial],
    ['Cidade / UF', d.empresaContratante.cidade],
    ['CNPJ / CPF', d.empresaContratante.cnpj],
    ['Bairro', d.empresaContratante.bairro],
    ['Endereço', d.empresaContratante.endereco],
    ['CEP', d.empresaContratante.cep],
  ]);

  // -------------------------------------------------------------------
  // Funcionario
  // -------------------------------------------------------------------
  faixa('Funcionário');
  paresEmDuasColunas([
    ['Nome', d.funcionario.nome],
    ['Código / Matrícula', d.funcionario.matricula],
    ['RG / CPF', [d.funcionario.rg, d.funcionario.cpf].filter(Boolean).join(' / ') || null],
    ['Sexo', d.funcionario.sexo],
    ['Nascimento', d.funcionario.nascimento],
    ['Idade', d.funcionario.idade !== null ? `${d.funcionario.idade} ANOS` : null],
    ['Cargo', d.funcionario.cargo],
    ['Setor', d.funcionario.setor],
  ]);

  // -------------------------------------------------------------------
  // Medico responsavel pelo PCMSO
  // -------------------------------------------------------------------
  faixa('Médico responsável pelo PCMSO');
  const registroPcmso = d.medicoPcmso.numero
    ? `${d.medicoPcmso.numero}${d.medicoPcmso.uf ? ` / ${d.medicoPcmso.uf}` : ''}`
    : null;
  paresEmDuasColunas([
    ['Nome', d.medicoPcmso.nome],
    [d.medicoPcmso.conselho, registroPcmso],
    ['Endereço', d.medicoPcmso.endereco],
    ['Cidade / UF', d.medicoPcmso.cidade],
    ['Bairro', d.medicoPcmso.bairro],
    ['CEP', d.medicoPcmso.cep],
    ['Telefone', d.medicoPcmso.telefone],
    ['RQE', d.medicoPcmso.rqe],
  ]);

  // -------------------------------------------------------------------
  // Perigos e fatores de risco — exigencia da NR-7
  // -------------------------------------------------------------------
  faixa('Perigos / Fatores de Risco');
  for (const { chave, rotulo } of CATEGORIAS) {
    const linhas = quebrar(d.riscos[chave], fonte, 7.5, LARGURA - 90);
    espaco(linhas.length * 10 + 4);
    pagina.drawText(rotulo, { x: MARGEM + 4, y, size: 7.5, font: negrito, color: cinza });
    linhas.forEach((linha, i) => {
      pagina.drawText(linha, { x: MARGEM + 82, y: y - i * 9.5, size: 7.5, font: fonte, color: preto });
    });
    y -= Math.max(12, linhas.length * 9.5 + 3);
  }
  y -= 4;

  // -------------------------------------------------------------------
  // Portarias e finalidade do exame
  // -------------------------------------------------------------------
  espaco(40);
  for (const linha of quebrar(PORTARIAS, fonte, 6.5, LARGURA - 8)) {
    pagina.drawText(linha, { x: MARGEM + 4, y, size: 6.5, font: fonte, color: cinza });
    y -= 8;
  }
  pagina.drawText(d.tipoExame, { x: MARGEM + 4, y: y - 3, size: 11, font: negrito, color: preto });
  y -= 20;

  // -------------------------------------------------------------------
  // Avaliacao clinica e exames realizados
  // -------------------------------------------------------------------
  faixa('Avaliação Clínica e Exames Realizados');
  const exames = d.exames.length > 0 ? d.exames : [{ nome: 'Exame Clínico', data: null }];
  for (const exame of exames) {
    espaco(13);
    pagina.drawText(exame.nome, { x: MARGEM + 4, y, size: 8, font: fonte, color: preto });
    if (exame.data) {
      pagina.drawText(exame.data, {
        x: A4[0] - MARGEM - 60, y, size: 8, font: fonte, color: preto,
      });
    }
    y -= 11.5;
  }
  y -= 6;

  // -------------------------------------------------------------------
  // Parecer, em caixas de marcar como no modelo da clinica
  // -------------------------------------------------------------------
  faixa('Parecer');
  const opcoes: [string, string][] = [
    ['inapto', 'Inapto para função'],
    ['apto_com_restricoes', 'Apto para função com restrições'],
    ['apto', 'Apto para função'],
  ];
  for (const [chave, rotulo] of opcoes) {
    espaco(15);
    const marcada = d.parecer === chave;
    pagina.drawRectangle({
      x: MARGEM + 5, y: y - 1.5, width: 9, height: 9,
      borderColor: marcada ? cor : borda, borderWidth: marcada ? 1.4 : 0.8,
      color: marcada ? cor : rgb(1, 1, 1),
    });
    if (marcada) {
      pagina.drawText('X', { x: MARGEM + 7.2, y: y + 0.6, size: 8, font: negrito, color: rgb(1, 1, 1) });
    }
    pagina.drawText(rotulo, {
      x: MARGEM + 20, y, size: marcada ? 9.5 : 8.5,
      font: marcada ? negrito : fonte, color: marcada ? preto : cinza,
    });
    y -= 14;
  }

  if (d.validade) {
    pagina.drawText(`Validade do exame: ${d.validade}`, {
      x: MARGEM + 5, y, size: 8, font: negrito, color: preto,
    });
    y -= 13;
  }
  if (d.restricoes) {
    for (const linha of quebrar(`Restrições: ${d.restricoes}`, fonte, 8, LARGURA - 10)) {
      espaco(11);
      pagina.drawText(linha, { x: MARGEM + 5, y, size: 8, font: fonte, color: preto });
      y -= 10;
    }
  }
  y -= 6;

  // -------------------------------------------------------------------
  // Observacoes
  // -------------------------------------------------------------------
  faixa('Observações');
  const observacoes = d.observacoes?.trim() || '—';
  for (const linha of quebrar(observacoes, fonte, 8, LARGURA - 10).slice(0, 8)) {
    espaco(11);
    pagina.drawText(linha, { x: MARGEM + 4, y, size: 8, font: fonte, color: preto });
    y -= 10;
  }

  // -------------------------------------------------------------------
  // Carimbo e assinatura
  // -------------------------------------------------------------------
  if (y < 210) novaPagina();
  const yAss = 130;
  const meia = LARGURA / 2;

  let assinou = false;
  if (d.assinaturaMedico) {
    try {
      const png = await pdf.embedPng(d.assinaturaMedico);
      const escala = Math.min((meia - 50) / png.width, 40 / png.height);
      pagina.drawImage(png, {
        x: MARGEM + 10, y: yAss + 14, width: png.width * escala, height: png.height * escala,
      });
      assinou = true;
    } catch {
      /* assinatura ilegivel nao pode impedir a emissao */
    }
  }
  if (!assinou) {
    pagina.drawText('Assinado eletronicamente', {
      x: MARGEM + 10, y: yAss + 26, size: 6.5, font: fonte, color: cinza,
    });
  }

  pagina.drawLine({
    start: { x: MARGEM, y: yAss + 10 }, end: { x: MARGEM + meia - 20, y: yAss + 10 },
    thickness: 0.8, color: rgb(0.3, 0.3, 0.3),
  });
  pagina.drawText(d.medicoExaminador.nome, {
    x: MARGEM, y: yAss, size: 8.5, font: negrito, color: preto,
  });
  const registro = d.medicoExaminador.numero
    ? `${d.medicoExaminador.conselho} ${d.medicoExaminador.numero}${d.medicoExaminador.uf ? '/' + d.medicoExaminador.uf : ''}`
    : '';
  pagina.drawText(`Carimbo e Assinatura — Médico Examinador ${registro}`.trim(), {
    x: MARGEM, y: yAss - 10, size: 7, font: fonte, color: cinza,
  });

  if (d.assinaturaPaciente) {
    try {
      const png = await pdf.embedPng(d.assinaturaPaciente);
      const escala = Math.min((meia - 40) / png.width, 40 / png.height);
      pagina.drawImage(png, {
        x: MARGEM + meia + 10, y: yAss + 14, width: png.width * escala, height: png.height * escala,
      });
    } catch {
      /* idem */
    }
  }
  pagina.drawLine({
    start: { x: MARGEM + meia + 10, y: yAss + 10 }, end: { x: A4[0] - MARGEM, y: yAss + 10 },
    thickness: 0.8, color: rgb(0.3, 0.3, 0.3),
  });
  pagina.drawText(d.funcionario.nome, {
    x: MARGEM + meia + 10, y: yAss, size: 8, font: fonte, color: preto,
  });
  pagina.drawText(
    d.assinaturaPaciente ? 'Assinatura coletada na recepção' : 'Assinatura do funcionário',
    { x: MARGEM + meia + 10, y: yAss - 10, size: 6.5, font: fonte, color: cinza },
  );

  // -------------------------------------------------------------------
  // Rodape
  // -------------------------------------------------------------------
  let yr = 40;
  const rodape = [
    d.rodape,
    `Código de verificação: ${d.codigoVerificacao}${d.urlVerificacao ? ` — ${d.urlVerificacao}` : ''}`,
  ].filter(Boolean) as string[];
  for (const parte of rodape.reverse()) {
    for (const linha of quebrar(parte, fonte, 6.5, LARGURA).reverse()) {
      pagina.drawText(linha, { x: MARGEM, y: yr, size: 6.5, font: fonte, color: cinza });
      yr += 9;
    }
  }

  return pdf.save();
}
