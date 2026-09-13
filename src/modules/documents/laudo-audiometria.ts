import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { desenharAudiograma, desenharLegenda } from './audiograma-pdf';
import { lerLimiares, resumirOrelha, rotuloFrequencia, FREQUENCIAS } from './audiograma';

/**
 * Laudo da audiometria tonal ocupacional.
 *
 * Traz o cabecalho com os dados do paciente e da empresa, os dados do
 * aparelho exigidos pela clinica, os dois audiogramas e a tabela de
 * limiares — e deixa a conclusao para o medico escrever.
 *
 * O sistema descreve o que foi medido; nao diagnostica.
 */

export interface DadosDoLaudo {
  clinica: {
    nome: string;
    endereco: string | null;
    telefone: string | null;
    cor: string;
  };
  emitidoEm: Date;
  paciente: {
    nome: string;
    cpf: string | null;
    nascimento: string;
    idade: number | null;
    sexo: string;
    cargo: string | null;
    setor: string | null;
  };
  empresa: { razaoSocial: string; cnpj: string | null } | null;
  tipoExame: string;
  aparelho: {
    modelo: string | null;
    fabricante: string | null;
    calibracao: string | null;
    repousoAuditivo: string | null;
  };
  /** Campos crus da ficha (od_500, oe_4000...). */
  medicoes: Record<string, unknown>;
  meatoscopia: { od: string | null; oe: string | null };
  conclusao: string | null;
  medico: { nome: string; conselho: string; numero: string | null; uf: string | null };
  assinaturaMedico?: string | null;
  codigoVerificacao: string;
  rodape: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 42;

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

export async function buildLaudoAudiometria(d: DadosDoLaudo): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pagina = pdf.addPage(A4);

  const cor = hexParaRgb(d.clinica.cor);
  const cinza = rgb(0.42, 0.45, 0.5);
  const preto = rgb(0.1, 0.1, 0.12);
  const largura = A4[0] - MARGEM * 2;

  let y = A4[1] - MARGEM;
  pagina.drawRectangle({ x: 0, y: A4[1] - 5, width: A4[0], height: 5, color: cor });

  // Cabecalho
  pagina.drawText('AUDIOMETRIA TONAL OCUPACIONAL', {
    x: MARGEM, y, size: 13, font: negrito, color: preto,
  });
  y -= 15;
  pagina.drawText(d.clinica.nome, { x: MARGEM, y, size: 8, font: negrito, color: cor });
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d.emitidoEm);
  pagina.drawText(`Data do exame: ${data}`, {
    x: A4[0] - MARGEM - 110, y, size: 8.5, font: negrito, color: preto,
  });
  y -= 10;
  for (const linha of [d.clinica.endereco, d.clinica.telefone].filter(Boolean)) {
    pagina.drawText(String(linha), { x: MARGEM, y, size: 7, font: fonte, color: cinza });
    y -= 8.5;
  }
  y -= 8;

  const faixa = (titulo: string) => {
    pagina.drawRectangle({ x: MARGEM, y: y - 12, width: largura, height: 15, color: rgb(0.9, 0.92, 0.93) });
    pagina.drawText(titulo, { x: MARGEM + 6, y: y - 8.5, size: 8.5, font: negrito, color: rgb(0.2, 0.22, 0.25) });
    y -= 20;
  };

  const pares = (lista: [string, string | null][]) => {
    const validos = lista.filter(([, v]) => v && String(v).trim() !== '');
    for (let i = 0; i < validos.length; i += 2) {
      validos.slice(i, i + 2).forEach(([rotulo, valor], coluna) => {
        const x = MARGEM + 4 + coluna * (largura / 2);
        pagina.drawText(`${rotulo}:`, { x, y, size: 7.5, font: negrito, color: cinza });
        const desloc = negrito.widthOfTextAtSize(`${rotulo}: `, 7.5);
        pagina.drawText(String(valor), { x: x + desloc, y, size: 8, font: fonte, color: preto });
      });
      y -= 12.5;
    }
    y -= 4;
  };

  faixa('Identificação');
  pares([
    ['Colaborador', d.paciente.nome],
    ['CPF', d.paciente.cpf],
    ['Nascimento', d.paciente.nascimento],
    ['Idade', d.paciente.idade !== null ? `${d.paciente.idade} anos` : null],
    ['Sexo', d.paciente.sexo],
    ['Tipo de exame', d.tipoExame],
    ['Cargo', d.paciente.cargo],
    ['Setor', d.paciente.setor],
    ['Empresa', d.empresa?.razaoSocial ?? null],
    ['CNPJ', d.empresa?.cnpj ?? null],
  ]);

  faixa('Condições do exame');
  pares([
    ['Aparelho', d.aparelho.modelo],
    ['Fabricante', d.aparelho.fabricante],
    ['Calibração', d.aparelho.calibracao],
    ['Repouso auditivo', d.aparelho.repousoAuditivo ? `${d.aparelho.repousoAuditivo} h` : null],
    ['Meatoscopia O.D.', d.meatoscopia.od],
    ['Meatoscopia O.E.', d.meatoscopia.oe],
  ]);

  // ---------------------------------------------------------------
  // Audiogramas, lado a lado
  // ---------------------------------------------------------------
  faixa('Audiograma — via aérea');
  y -= 6;

  const od = lerLimiares(d.medicoes, 'od');
  const oe = lerLimiares(d.medicoes, 'oe');

  const alturaGrafico = 132;
  const larguraGrafico = (largura - 60) / 2;
  const baseGrafico = y - alturaGrafico;

  desenharAudiograma({
    pagina,
    caixa: { x: MARGEM + 22, y: baseGrafico, largura: larguraGrafico, altura: alturaGrafico },
    fonte,
    negrito,
    titulo: 'Orelha direita',
    limiares: od,
    orelha: 'od',
  });

  desenharAudiograma({
    pagina,
    caixa: {
      x: MARGEM + larguraGrafico + 60,
      y: baseGrafico,
      largura: larguraGrafico,
      altura: alturaGrafico,
    },
    fonte,
    negrito,
    titulo: 'Orelha esquerda',
    limiares: oe,
    orelha: 'oe',
  });

  y = baseGrafico - 22;
  desenharLegenda(pagina, MARGEM + 4, y, fonte);
  y -= 18;

  // ---------------------------------------------------------------
  // Tabela de limiares
  // ---------------------------------------------------------------
  faixa('Limiares em dB');

  const colunaLargura = (largura - 60) / FREQUENCIAS.length;
  pagina.drawText('Hz', { x: MARGEM + 4, y, size: 7, font: negrito, color: cinza });
  FREQUENCIAS.forEach((hz, i) => {
    pagina.drawText(rotuloFrequencia(hz), {
      x: MARGEM + 60 + i * colunaLargura,
      y,
      size: 7,
      font: negrito,
      color: cinza,
    });
  });
  y -= 12;

  for (const [orelha, limiares, rotulo] of [
    ['od', od, 'Orelha direita'],
    ['oe', oe, 'Orelha esquerda'],
  ] as const) {
    pagina.drawText(rotulo, { x: MARGEM + 4, y, size: 7.5, font: fonte, color: preto });
    FREQUENCIAS.forEach((hz, i) => {
      const valor = limiares[hz];
      pagina.drawText(valor === undefined ? '—' : String(valor), {
        x: MARGEM + 60 + i * colunaLargura,
        y,
        size: 7.5,
        font: fonte,
        color: preto,
      });
    });
    y -= 12;
    void orelha;
  }
  y -= 6;

  // Leitura descritiva — sem diagnostico.
  const resumoOd = resumirOrelha(od);
  const resumoOe = resumirOrelha(oe);
  const descrever = (rotulo: string, r: ReturnType<typeof resumirOrelha>) => {
    const partes: string[] = [];
    if (r.media !== null) partes.push(`média quadritonal ${r.media} dB`);
    partes.push(
      r.alteradas.length === 0
        ? 'todas as frequências medidas dentro de 25 dB'
        : `acima de 25 dB em ${r.alteradas.map((hz) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`)).join(', ')}`,
    );
    pagina.drawText(`${rotulo}: ${partes.join(' · ')}`, {
      x: MARGEM + 4, y, size: 7.5, font: fonte, color: preto,
    });
    y -= 11;
  };
  descrever('O.D.', resumoOd);
  descrever('O.E.', resumoOe);
  y -= 6;

  // ---------------------------------------------------------------
  // Conclusao e assinatura
  // ---------------------------------------------------------------
  faixa('Conclusão');
  const conclusao = d.conclusao?.trim() || '—';
  for (const linha of conclusao.split('\n').slice(0, 6)) {
    pagina.drawText(linha.slice(0, 120), { x: MARGEM + 4, y, size: 8, font: fonte, color: preto });
    y -= 10;
  }

  const yAss = 110;
  let assinou = false;
  if (d.assinaturaMedico) {
    try {
      const png = await pdf.embedPng(d.assinaturaMedico);
      const escala = Math.min(150 / png.width, 38 / png.height);
      pagina.drawImage(png, {
        x: MARGEM + 10, y: yAss + 12, width: png.width * escala, height: png.height * escala,
      });
      assinou = true;
    } catch {
      /* assinatura ilegivel nao impede a emissao */
    }
  }
  if (!assinou) {
    pagina.drawText('Assinado eletronicamente', {
      x: MARGEM + 10, y: yAss + 24, size: 6.5, font: fonte, color: cinza,
    });
  }

  pagina.drawLine({
    start: { x: MARGEM, y: yAss + 8 },
    end: { x: MARGEM + 220, y: yAss + 8 },
    thickness: 0.8,
    color: rgb(0.3, 0.3, 0.3),
  });
  pagina.drawText(d.medico.nome, { x: MARGEM, y: yAss - 2, size: 8.5, font: negrito, color: preto });
  const registro = d.medico.numero
    ? `${d.medico.conselho} ${d.medico.numero}${d.medico.uf ? '/' + d.medico.uf : ''}`
    : '';
  pagina.drawText(registro, { x: MARGEM, y: yAss - 12, size: 7.5, font: fonte, color: cinza });

  let yr = 36;
  for (const parte of [
    `Código de verificação: ${d.codigoVerificacao}`,
    d.rodape,
  ].filter(Boolean) as string[]) {
    pagina.drawText(parte.slice(0, 150), { x: MARGEM, y: yr, size: 6.5, font: fonte, color: cinza });
    yr += 9;
  }

  return pdf.save();
}
