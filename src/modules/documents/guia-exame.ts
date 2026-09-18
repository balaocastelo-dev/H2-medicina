import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { corDaMarca, desenharCabecalho, type DadosDoCabecalho } from './cabecalho';

/**
 * Guia de solicitacao de exame, no modelo "Guia de Exame.docx" da clinica.
 *
 * "ao selecionar o exame quando clicar em exames laboratoriais deve aparecer
 *  uma caixa input onde o usuario descreve os exames que serao solicitados,
 *  deve ter um botao de imprimir que imprime a guia de solicitacao com os
 *  exames digitados" -- Isabella, 15/09.
 *
 * O ponto da guia e o endereco do fim: raio-X e coleta laboratorial nao sao
 * feitos na clinica. O paciente sai daqui com o papel que diz para onde ir.
 * Por isso "Local do Exame" e um campo de verdade e nao um rodape decorativo.
 */

export interface DadosDaGuia {
  clinica: DadosDoCabecalho;
  colaborador: {
    nome: string;
    cpf: string | null;
    rg: string | null;
    sexo: string | null;
    nascimento: string | null;
    cargo: string | null;
    setor: string | null;
  };
  empresa: {
    nome: string | null;
    documento: string | null;
    endereco: string | null;
    bairro: string | null;
    cidadeUf: string | null;
    cep: string | null;
  } | null;
  /** Uma linha por exame pedido. */
  exames: string[];
  agendadoPara: string | null;
  preparos: string | null;
  /** Onde o exame e realizado. */
  localDoExame: string;
  rodape: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const M = 52;
const LARGURA = A4[0] - M * 2;

export async function buildGuiaDeExame(d: DadosDaGuia): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pagina = pdf.addPage(A4);

  const cor = corDaMarca(d.clinica.cor);
  const preto = rgb(0.1, 0.1, 0.12);
  const cinza = rgb(0.42, 0.45, 0.5);

  // Cabecalho comum a todo papel que sai da clinica.
  let y = await desenharCabecalho(pdf, pagina, d.clinica, {
    titulo: 'GUIA DE EXAME',
    fonte: F,
    negrito: B,
    margem: M,
    largura: A4[0],
    alturaDaPagina: A4[1],
  });

  // ------------------------------------------------------- utilitarios
  const faixa = (titulo: string) => {
    pagina.drawRectangle({ x: M, y: y - 12, width: LARGURA, height: 16, color: rgb(0.93, 0.95, 0.94) });
    pagina.drawText(titulo, { x: M + 7, y: y - 8, size: 8.5, font: B, color: cor });
    y -= 22;
  };

  /** Rotulo e valor lado a lado, em duas colunas. */
  const par = (
    esq: [string, string | null],
    dir?: [string, string | null],
  ) => {
    const escrever = (x: number, rotulo: string, valor: string | null, largura: number) => {
      pagina.drawText(`${rotulo}:`, { x, y, size: 8, font: B, color: preto });
      const recuo = B.widthOfTextAtSize(`${rotulo}:`, 8) + 5;
      let texto = valor && valor.trim() ? valor : '—';
      // Corta em vez de deixar invadir a coluna vizinha.
      while (F.widthOfTextAtSize(texto, 8) > largura - recuo && texto.length > 4) {
        texto = texto.slice(0, -2);
      }
      pagina.drawText(texto, { x: x + recuo, y, size: 8, font: F, color: preto });
    };
    const meia = LARGURA / 2;
    escrever(M + 4, esq[0], esq[1], dir ? meia - 8 : LARGURA - 8);
    if (dir) escrever(M + meia + 4, dir[0], dir[1], meia - 8);
    y -= 13.5;
  };

  // ------------------------------------------------------ colaborador
  faixa('Colaborador');
  par(['Colaborador', d.colaborador.nome]);
  par(['CPF', d.colaborador.cpf], ['RG', d.colaborador.rg]);
  par(['Data de Nascimento', d.colaborador.nascimento], ['Sexo', d.colaborador.sexo]);
  par(['Cargo', d.colaborador.cargo], ['Setor', d.colaborador.setor]);
  y -= 8;

  // ---------------------------------------------------------- empresa
  if (d.empresa) {
    faixa('Empresa');
    par(['Empresa', d.empresa.nome]);
    par(['CNPJ/CPF', d.empresa.documento]);
    par(['Endereço', d.empresa.endereco]);
    par(['Bairro', d.empresa.bairro], ['Cidade/UF', d.empresa.cidadeUf]);
    par(['CEP', d.empresa.cep]);
    y -= 8;
  }

  // ----------------------------------------------------------- exames
  faixa('Exames');
  if (d.exames.length === 0) {
    pagina.drawText('—', { x: M + 4, y, size: 8, font: F, color: cinza });
    y -= 13.5;
  }
  for (const exame of d.exames) {
    // Uma linha por exame, quebrando o que nao couber.
    let resto = exame;
    let primeira = true;
    while (resto.length > 0) {
      let linha = resto;
      while (F.widthOfTextAtSize(linha, 9) > LARGURA - 24 && linha.includes(' ')) {
        linha = linha.slice(0, linha.lastIndexOf(' '));
      }
      if (primeira) {
        pagina.drawText('•', { x: M + 6, y, size: 9, font: B, color: cor });
        primeira = false;
      }
      pagina.drawText(linha, { x: M + 18, y, size: 9, font: F, color: preto });
      resto = resto.slice(linha.length).trim();
      y -= 13;
      if (y < 170) break;
    }
  }
  y -= 8;

  // ---------------------------------------------------- agenda e local
  faixa('Realização');
  par(['Agendado para o dia', d.agendadoPara]);
  par(['Preparos', d.preparos]);
  y -= 4;

  // O endereco e o motivo de existir da guia: fica em destaque.
  pagina.drawRectangle({
    x: M,
    y: y - 26,
    width: LARGURA,
    height: 34,
    color: rgb(0.96, 0.98, 0.97),
    borderColor: cor,
    borderWidth: 0.9,
  });
  pagina.drawText('Local do Exame', { x: M + 10, y: y - 2, size: 8, font: B, color: cor });
  pagina.drawText(d.localDoExame, { x: M + 10, y: y - 16, size: 9.5, font: B, color: preto });
  y -= 46;

  // --------------------------------------------------------- rodape
  let yr = 44;
  for (const parte of [
    d.rodape,
    'Apresente esta guia no local indicado. Leve documento com foto.',
  ].filter(Boolean) as string[]) {
    pagina.drawText(parte.slice(0, 170), { x: M, y: yr, size: 6.8, font: F, color: cinza });
    yr += 9;
  }

  return pdf.save();
}
