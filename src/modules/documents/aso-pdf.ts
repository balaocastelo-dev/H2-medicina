import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Desenho do A.S.O. em A4, no formato que a clinica ja usa em papel.
 *
 * O layout segue o modelo entregue pela doutora: identificacao da empresa
 * contratante, do funcionario, do medico responsavel pelo PCMSO, exames
 * realizados, parecer de aptidao e as duas assinaturas.
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
    cidade: string | null;
    cep: string | null;
  };
  funcionario: {
    nome: string;
    cpf: string | null;
    rg: string | null;
    nascimento: string;
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
  };
  medicoExaminador: {
    nome: string;
    conselho: string;
    numero: string | null;
    uf: string | null;
  };
  tipoExame: string;
  exames: string[];
  parecer: string;
  restricoes: string | null;
  validade: string | null;
  observacoes: string | null;
  /** PNG em data URI, coletada na entrada. */
  assinaturaPaciente: string | null;
  /** Assinatura manuscrita do medico examinador, quando registrada. */
  assinaturaMedico?: string | null;
  codigoVerificacao: string;
  urlVerificacao: string | null;
  rodape: string | null;
}

function hexParaRgb(hex: string) {
  const limpo = hex.replace('#', '');
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
  for (const palavra of texto.split(/\s+/)) {
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
  const linhaCor = rgb(0.85, 0.87, 0.89);

  let pagina: PDFPage = pdf.addPage([595.28, 841.89]);
  const margem = 42;
  const largura = 595.28 - margem * 2;
  let y = 841.89 - margem;

  pagina.drawRectangle({ x: 0, y: 841.89 - 6, width: 595.28, height: 6, color: cor });

  // Cabecalho
  pagina.drawText(d.clinica.nome, { x: margem, y, size: 15, font: negrito, color: cor });
  pagina.drawText('ATESTADO DE SAÚDE OCUPACIONAL', {
    x: margem + 250, y, size: 13, font: negrito, color: rgb(0.1, 0.1, 0.12),
  });
  y -= 14;
  for (const linha of [d.clinica.razaoSocial, d.clinica.cnpj, d.clinica.endereco, d.clinica.telefone]) {
    if (!linha) continue;
    pagina.drawText(String(linha), { x: margem, y, size: 7.5, font: fonte, color: cinza });
    y -= 9.5;
  }
  const dataEmissao = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d.emitidoEm);
  pagina.drawText(`Emitido em ${dataEmissao}`, {
    x: 595.28 - margem - 110, y: y + 12, size: 9, font: negrito, color: rgb(0.1, 0.1, 0.12),
  });

  y -= 8;
  pagina.drawLine({ start: { x: margem, y }, end: { x: 595.28 - margem, y }, thickness: 0.8, color: linhaCor });
  y -= 18;

  /** Bloco com titulo em faixa e pares rotulo/valor. */
  const bloco = (titulo: string, pares: [string, string | null][]) => {
    pagina.drawRectangle({ x: margem, y: y - 13, width: largura, height: 16, color: rgb(0.95, 0.96, 0.97) });
    pagina.drawText(titulo, { x: margem + 6, y: y - 9, size: 8.5, font: negrito, color: rgb(0.2, 0.22, 0.25) });
    y -= 22;
    const validos = pares.filter(([, v]) => v);
    for (let i = 0; i < validos.length; i += 2) {
      const par = validos.slice(i, i + 2);
      par.forEach(([rot, val], col) => {
        const x = margem + 6 + col * (largura / 2);
        pagina.drawText(`${rot}:`, { x, y, size: 8, font: negrito, color: cinza });
        const desloc = negrito.widthOfTextAtSize(`${rot}: `, 8);
        pagina.drawText(String(val), { x: x + desloc, y, size: 8, font: fonte, color: rgb(0.1, 0.1, 0.12) });
      });
      y -= 12;
    }
    y -= 6;
  };

  bloco('EMPRESA CONTRATANTE', [
    ['Razão social', d.empresaContratante.razaoSocial],
    ['CNPJ', d.empresaContratante.cnpj],
    ['Endereço', d.empresaContratante.endereco],
    ['Cidade/UF', d.empresaContratante.cidade],
    ['CEP', d.empresaContratante.cep],
  ]);

  bloco('FUNCIONÁRIO', [
    ['Nome', d.funcionario.nome],
    ['CPF', d.funcionario.cpf],
    ['RG', d.funcionario.rg],
    ['Nascimento', d.funcionario.nascimento],
    ['Sexo', d.funcionario.sexo],
    ['Cargo', d.funcionario.cargo],
    ['Setor', d.funcionario.setor],
    ['Tipo de exame', d.tipoExame],
  ]);

  bloco('MÉDICO RESPONSÁVEL PELO PCMSO', [
    ['Nome', d.medicoPcmso.nome],
    [
      'Registro',
      d.medicoPcmso.numero
        ? `${d.medicoPcmso.conselho} ${d.medicoPcmso.numero}${d.medicoPcmso.uf ? '/' + d.medicoPcmso.uf : ''}`
        : null,
    ],
    ['RQE', d.medicoPcmso.rqe],
  ]);

  // Exames realizados
  pagina.drawRectangle({ x: margem, y: y - 13, width: largura, height: 16, color: rgb(0.95, 0.96, 0.97) });
  pagina.drawText('AVALIAÇÃO CLÍNICA E EXAMES REALIZADOS', {
    x: margem + 6, y: y - 9, size: 8.5, font: negrito, color: rgb(0.2, 0.22, 0.25),
  });
  y -= 22;
  const listaExames = d.exames.length > 0 ? d.exames.join(' · ') : 'Avaliação clínica ocupacional';
  for (const linha of quebrar(listaExames, fonte, 8, largura - 12)) {
    pagina.drawText(linha, { x: margem + 6, y, size: 8, font: fonte, color: rgb(0.1, 0.1, 0.12) });
    y -= 11;
  }
  y -= 8;

  // Parecer — o coracao do documento
  pagina.drawRectangle({
    x: margem, y: y - 40, width: largura, height: 46,
    color: rgb(0.98, 0.98, 0.99), borderColor: cor, borderWidth: 1,
  });
  pagina.drawText('PARECER', { x: margem + 8, y: y - 8, size: 8.5, font: negrito, color: cinza });
  pagina.drawText(d.parecer, { x: margem + 8, y: y - 26, size: 13, font: negrito, color: cor });
  if (d.validade) {
    pagina.drawText(`Validade: ${d.validade}`, {
      x: 595.28 - margem - 120, y: y - 26, size: 9, font: fonte, color: rgb(0.1, 0.1, 0.12),
    });
  }
  y -= 54;

  if (d.restricoes) {
    pagina.drawText('Restrições:', { x: margem, y, size: 8, font: negrito, color: cinza });
    y -= 11;
    for (const linha of quebrar(d.restricoes, fonte, 8, largura)) {
      pagina.drawText(linha, { x: margem, y, size: 8, font: fonte, color: rgb(0.1, 0.1, 0.12) });
      y -= 10;
    }
    y -= 6;
  }

  if (d.observacoes) {
    pagina.drawText('Observações:', { x: margem, y, size: 8, font: negrito, color: cinza });
    y -= 11;
    for (const linha of quebrar(d.observacoes, fonte, 8, largura).slice(0, 6)) {
      pagina.drawText(linha, { x: margem, y, size: 8, font: fonte, color: rgb(0.1, 0.1, 0.12) });
      y -= 10;
    }
  }

  // Assinaturas. Se o parecer e as observacoes ocuparam a folha, elas vao
  // para uma segunda pagina em vez de escrever por cima do rodape.
  if (y < 230) {
    pagina = pdf.addPage([595.28, 841.89]);
    pagina.drawRectangle({ x: 0, y: 841.89 - 6, width: 595.28, height: 6, color: cor });
    pagina.drawText(`${d.funcionario.nome} — continuação do A.S.O.`, {
      x: margem, y: 841.89 - margem, size: 9, font: negrito, color: cinza,
    });
  }

  const yAssinatura = 150;
  const meia = largura / 2;

  // Assinatura manuscrita do medico, quando ele registrou a dele. Sem ela o
  // documento sai como sempre saiu: linha, nome e registro.
  let assinouAMao = false;
  if (d.assinaturaMedico) {
    try {
      const png = await pdf.embedPng(d.assinaturaMedico);
      const escala = Math.min((meia - 40) / png.width, 42 / png.height);
      pagina.drawImage(png, {
        x: margem + 10,
        y: yAssinatura + 16,
        width: png.width * escala,
        height: png.height * escala,
      });
      assinouAMao = true;
    } catch {
      /* assinatura ilegivel nao pode impedir a emissao do documento */
    }
  }

  if (!assinouAMao) {
    pagina.drawText('Assinado eletronicamente', {
      x: margem + 10, y: yAssinatura + 30, size: 7, font: fonte, color: cinza,
    });
    pagina.drawText(d.medicoExaminador.nome, {
      x: margem + 10, y: yAssinatura + 18, size: 9.5, font: negrito, color: rgb(0.1, 0.1, 0.12),
    });
  }
  pagina.drawLine({
    start: { x: margem, y: yAssinatura + 12 }, end: { x: margem + meia - 20, y: yAssinatura + 12 },
    thickness: 0.8, color: rgb(0.3, 0.3, 0.3),
  });
  const registro = d.medicoExaminador.numero
    ? `${d.medicoExaminador.conselho} ${d.medicoExaminador.numero}${d.medicoExaminador.uf ? '/' + d.medicoExaminador.uf : ''}`
    : '';
  pagina.drawText(d.medicoExaminador.nome, {
    x: margem, y: yAssinatura, size: 8.5, font: negrito, color: rgb(0.1, 0.1, 0.12),
  });
  pagina.drawText(`Médico examinador — ${registro}`, {
    x: margem, y: yAssinatura - 10, size: 7.5, font: fonte, color: cinza,
  });

  if (d.assinaturaPaciente) {
    try {
      const png = await pdf.embedPng(d.assinaturaPaciente);
      const escala = Math.min((meia - 40) / png.width, 46 / png.height);
      pagina.drawImage(png, {
        x: margem + meia + 10,
        y: yAssinatura + 16,
        width: png.width * escala,
        height: png.height * escala,
      });
    } catch {
      /* assinatura ilegivel nao pode impedir a emissao do documento */
    }
  }
  pagina.drawLine({
    start: { x: margem + meia + 10, y: yAssinatura + 12 },
    end: { x: 595.28 - margem, y: yAssinatura + 12 },
    thickness: 0.8, color: rgb(0.3, 0.3, 0.3),
  });
  pagina.drawText(d.funcionario.nome, { x: margem + meia + 10, y: yAssinatura, size: 8, font: fonte, color: cinza });
  pagina.drawText(
    d.assinaturaPaciente ? 'Assinatura coletada na recepção' : 'Assinatura do funcionário',
    { x: margem + meia + 10, y: yAssinatura - 10, size: 6.5, font: fonte, color: cinza },
  );

  // Rodape
  let yr = 46;
  const rodape = [
    d.rodape,
    `Código de verificação: ${d.codigoVerificacao}${d.urlVerificacao ? ` — ${d.urlVerificacao}` : ''}`,
    'Em cumprimento às portarias nº 3214/78, 3164/82, 12/83, 24/94 e 08/96 NR7 do Ministério do Trabalho e Emprego.',
  ].filter(Boolean) as string[];
  for (const parte of rodape.reverse()) {
    for (const linha of quebrar(parte, fonte, 6.5, largura).reverse()) {
      pagina.drawText(linha, { x: margem, y: yr, size: 6.5, font: fonte, color: cinza });
      yr += 9;
    }
  }

  return pdf.save();
}
