import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { corDaMarca, desenharCabecalho, type DadosDoCabecalho } from './cabecalho';
import type { FichaDeExame } from '@/modules/clinical/fichas-de-exame';

/**
 * Laudo de qualquer exame que tenha ficha de preenchimento.
 *
 * "Nao ta gerando a ficha da Dinamometria palmar, Avaliacao psicossocial,
 *  Dinamometria escapular, Teste de fadiga, Dinamometria lombar, Teste de
 *  Romberg" -- Isabella, 23/09.
 *
 * Ate aqui so a audiometria tinha laudo, porque e o unico com grafico. Os
 * outros exames eram preenchidos na sala e o resultado ficava guardado sem
 * nunca virar papel -- a clinica preenchia a ficha e nao tinha o que
 * entregar ao paciente nem o que anexar ao A.S.O.
 *
 * Este gerador nao conhece exame nenhum: ele desenha a ficha que receber.
 * Exame novo com ficha ganha laudo no mesmo dia, sem codigo novo.
 */

const A4: [number, number] = [595.28, 841.89];
const M = 52;
const LARGURA = A4[0] - M * 2;

export interface DadosDoLaudoDeFicha {
  clinica: DadosDoCabecalho;
  ficha: FichaDeExame;
  /** O que foi preenchido na sala. */
  valores: Record<string, unknown>;
  conclusao: string | null;
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
  profissional: { nome: string; conselho: string; numero: string | null; uf: string | null };
  assinatura?: string | null;
  codigoVerificacao: string;
  rodape: string | null;
}

export async function buildLaudoDeFicha(d: DadosDoLaudoDeFicha): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const B = await pdf.embedFont(StandardFonts.HelveticaBold);

  const cor = corDaMarca(d.clinica.cor);
  const preto = rgb(0.1, 0.1, 0.12);
  const cinza = rgb(0.42, 0.45, 0.5);
  const claro = rgb(0.93, 0.95, 0.94);

  let pagina = pdf.addPage(A4);
  let y = await desenharCabecalho(pdf, pagina, d.clinica, {
    titulo: d.ficha.titulo.toUpperCase(),
    fonte: F,
    negrito: B,
    margem: M,
    largura: A4[0],
    alturaDaPagina: A4[1],
  });

  /** Abre pagina nova quando o que vem nao cabe. */
  const garantir = (altura: number) => {
    if (y - altura > 70) return;
    pagina = pdf.addPage(A4);
    pagina.drawRectangle({ x: 0, y: A4[1] - 5, width: A4[0], height: 5, color: cor });
    y = A4[1] - M;
  };

  const faixa = (texto: string) => {
    garantir(28);
    pagina.drawRectangle({ x: M, y: y - 13, width: LARGURA, height: 18, color: claro });
    pagina.drawText(texto, { x: M + 8, y: y - 8, size: 9, font: B, color: cor });
    y -= 26;
  };

  /** Uma ou duas colunas de rotulo/valor. */
  const par = (
    esquerda: [string, string | null],
    direita?: [string, string | null] | null,
  ) => {
    garantir(16);
    const meia = LARGURA / 2;
    const escrever = (x: number, [rotulo, valor]: [string, string | null], limite: number) => {
      pagina.drawText(`${rotulo}:`, { x, y, size: 8, font: B, color: cinza });
      const recuo = B.widthOfTextAtSize(`${rotulo}:`, 8) + 5;
      let texto = (valor ?? '').trim() || '—';
      while (F.widthOfTextAtSize(texto, 8.5) > limite - recuo && texto.length > 4) {
        texto = texto.slice(0, -2);
      }
      pagina.drawText(texto, { x: x + recuo, y, size: 8.5, font: F, color: preto });
    };
    escrever(M, esquerda, direita ? meia - 12 : LARGURA);
    if (direita) escrever(M + meia, direita, meia - 12);
    y -= 15;
  };

  const paragrafo = (texto: string) => {
    const palavras = texto.split(/\s+/);
    let linha = '';
    const linhas: string[] = [];
    for (const p of palavras) {
      const teste = linha ? `${linha} ${p}` : p;
      if (F.widthOfTextAtSize(teste, 8.5) > LARGURA) {
        linhas.push(linha);
        linha = p;
      } else linha = teste;
    }
    if (linha) linhas.push(linha);
    for (const l of linhas) {
      garantir(13);
      pagina.drawText(l, { x: M, y, size: 8.5, font: F, color: preto });
      y -= 12;
    }
  };

  // ------------------------------------------------------- identificacao
  faixa('Identificação');
  par(['Nome', d.paciente.nome], ['CPF', d.paciente.cpf]);
  par(
    ['Nascimento', d.paciente.nascimento],
    ['Idade', d.paciente.idade !== null ? `${d.paciente.idade} anos` : null],
  );
  par(['Sexo', d.paciente.sexo], ['Tipo de exame', d.tipoExame]);
  par(['Cargo', d.paciente.cargo], ['Setor', d.paciente.setor]);
  if (d.empresa) {
    par(['Empresa', d.empresa.razaoSocial], ['CNPJ', d.empresa.cnpj]);
  }
  par([
    'Data do exame',
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d.emitidoEm),
  ]);
  y -= 6;

  // ------------------------------------------------------------ resultado
  faixa('Resultado');

  let escreveuAlgo = false;
  // Duas respostas por linha economizam papel sem apertar a leitura; os
  // titulos da ficha viram subtitulo e quebram a coluna.
  let pendente: [string, string | null] | null = null;

  const despejar = () => {
    if (pendente) {
      par(pendente);
      pendente = null;
    }
  };

  for (const campo of d.ficha.campos) {
    if (campo.tipo === 'titulo') {
      despejar();
      garantir(20);
      y -= 4;
      pagina.drawText(campo.rotulo, { x: M, y, size: 8.2, font: B, color: cor });
      y -= 13;
      continue;
    }

    const bruto = d.valores[campo.chave];
    const valor = bruto === null || bruto === undefined ? '' : String(bruto).trim();
    if (!valor) continue;

    escreveuAlgo = true;
    const item: [string, string | null] = [
      campo.rotulo,
      campo.unidade ? `${valor} ${campo.unidade}` : valor,
    ];

    // Texto longo ocupa a linha inteira; o resto emparelha.
    if (campo.tipo === 'longo') {
      despejar();
      par(item);
      continue;
    }
    if (pendente) {
      par(pendente, item);
      pendente = null;
    } else {
      pendente = item;
    }
  }
  despejar();

  if (!escreveuAlgo) {
    garantir(16);
    pagina.drawText('Ficha sem respostas registradas.', {
      x: M,
      y,
      size: 8.5,
      font: F,
      color: cinza,
    });
    y -= 14;
  }

  // ------------------------------------------------------------ conclusao
  if (d.conclusao?.trim()) {
    y -= 6;
    faixa('Conclusão');
    paragrafo(d.conclusao.trim());
  }

  // ----------------------------------------------------------- assinatura
  garantir(96);
  y -= 34;

  if (d.assinatura) {
    try {
      const base64 = d.assinatura.split(',')[1] ?? '';
      const img = await pdf.embedPng(Buffer.from(base64, 'base64'));
      const escala = Math.min(34 / img.height, 170 / img.width);
      pagina.drawImage(img, {
        x: M,
        y: y + 6,
        width: img.width * escala,
        height: img.height * escala,
      });
    } catch {
      // Assinatura ilegivel nunca impede a emissao: sai a linha, como sempre.
    }
  }

  pagina.drawLine({
    start: { x: M, y },
    end: { x: M + 220, y },
    thickness: 0.8,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 11;
  pagina.drawText(d.profissional.nome, { x: M, y, size: 8.5, font: B, color: preto });
  y -= 10;
  const registro = d.profissional.numero
    ? `${d.profissional.conselho} ${d.profissional.numero}${d.profissional.uf ? '/' + d.profissional.uf : ''}`
    : 'Profissional responsável pelo exame';
  pagina.drawText(registro, { x: M, y, size: 7.5, font: F, color: cinza });

  // -------------------------------------------------------------- rodape
  const pe = [d.rodape, `Código de verificação ${d.codigoVerificacao}`]
    .filter(Boolean)
    .join('  ·  ');
  pagina.drawText(pe, { x: M, y: 38, size: 6.8, font: F, color: cinza });

  return pdf.save();
}
