import 'server-only';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { CATEGORIAS } from './riscos';
import type { DadosAso } from './aso-pdf';

/**
 * A.S.O. em Word, a partir dos mesmos dados do A.S.O. em PDF.
 *
 * "lembrando que o ASO precisa ser um arquivo em docx" -- Isabella, 21/09.
 *
 * O PDF continua sendo o documento emitido: e ele que carrega o codigo de
 * verificacao, a assinatura eletronica do examinador e a assinatura do
 * paciente coletada na entrada. O .docx e a mesma informacao num arquivo
 * que a clinica consegue abrir e editar antes de imprimir.
 *
 * Nao leva assinatura de imagem de proposito. Arquivo editavel com
 * assinatura embutida e assinatura solta: qualquer um altera o texto e ela
 * continua ali, validando o que nao foi assinado.
 */

const CINZA = '6B7280';
const PRETO = '1C1E24';

function linha(rotulo: string, valor: string | null | undefined): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 32, type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            children: [new TextRun({ text: rotulo, bold: true, size: 18, color: CINZA })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            children: [new TextRun({ text: valor?.trim() || '—', size: 18, color: PRETO })],
          }),
        ],
      }),
    ],
  });
}

function bloco(titulo: string, linhas: TableRow[]): (Paragraph | Table)[] {
  return [
    new Paragraph({
      spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: titulo.toUpperCase(), bold: true, size: 20 })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'D9DCE1' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9DCE1' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'EDEFF2' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      rows: linhas,
    }),
  ];
}

/** Parecer de aptidao, como o modelo em papel escreve. */
const PARECER: Record<string, string> = {
  apto: 'APTO',
  apto_com_restricoes: 'APTO COM RESTRIÇÕES',
  inapto: 'INAPTO',
  inconclusivo: 'INCONCLUSIVO',
};

export async function buildAsoDocx(d: DadosAso): Promise<Uint8Array> {
  const dataEmissao = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(d.emitidoEm);

  const registro = (m: { conselho: string; numero: string | null; uf: string | null }) =>
    m.numero ? `${m.conselho} ${m.numero}${m.uf ? '/' + m.uf : ''}` : null;

  const doc = new Document({
    creator: d.clinica.razaoSocial,
    title: 'Atestado de Saúde Ocupacional',
    description: `A.S.O. de ${d.funcionario.nome}`,
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.HEADING_1,
            children: [
              new TextRun({ text: 'ATESTADO DE SAÚDE OCUPACIONAL', bold: true, size: 28 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({ text: d.clinica.razaoSocial, size: 18 }),
              ...(d.clinica.cnpj ? [new TextRun({ text: ` · ${d.clinica.cnpj}`, size: 18 })] : []),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: [d.clinica.endereco, d.clinica.telefone].filter(Boolean).join(' · '),
                size: 16,
                color: CINZA,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `Emitido em ${dataEmissao}`, size: 16, color: CINZA }),
            ],
          }),

          ...bloco('Empresa', [
            linha('Razão social', d.empresaContratante.razaoSocial),
            linha('CNPJ / CPF', d.empresaContratante.cnpj),
            linha('Endereço', d.empresaContratante.endereco),
            linha('Bairro', d.empresaContratante.bairro),
            linha('Cidade / UF', d.empresaContratante.cidade),
            linha('CEP', d.empresaContratante.cep),
          ]),

          ...bloco('Funcionário', [
            linha('Nome', d.funcionario.nome),
            linha('Código / Matrícula', d.funcionario.matricula),
            linha('RG / CPF', [d.funcionario.rg, d.funcionario.cpf].filter(Boolean).join(' / ')),
            linha('Sexo', d.funcionario.sexo),
            linha('Nascimento', d.funcionario.nascimento),
            linha('Idade', d.funcionario.idade !== null ? `${d.funcionario.idade} anos` : null),
            linha('Cargo', d.funcionario.cargo),
            linha('Setor', d.funcionario.setor),
          ]),

          ...bloco('Médico responsável pelo PCMSO', [
            linha('Nome', d.medicoPcmso.nome),
            linha('Registro', registro(d.medicoPcmso)),
            linha('RQE', d.medicoPcmso.rqe),
            linha('Endereço', d.medicoPcmso.endereco),
            linha('Bairro', d.medicoPcmso.bairro),
            linha('Cidade / UF', d.medicoPcmso.cidade),
            linha('CEP', d.medicoPcmso.cep),
            linha('Telefone', d.medicoPcmso.telefone),
          ]),

          ...bloco(
            'Perigos / Fatores de risco',
            CATEGORIAS.map(({ chave, rotulo }) => linha(rotulo, d.riscos[chave])),
          ),

          ...bloco(
            'Exames realizados',
            d.exames.length > 0
              ? d.exames.map((e) => linha(e.nome, e.data))
              : [linha('Exames', 'Nenhum exame registrado')],
          ),

          ...bloco('Parecer', [
            linha('Tipo de exame', d.tipoExame),
            linha('Conclusão', PARECER[d.parecer] ?? d.parecer),
            // Aptidoes adicionais: so aparecem quando o medico as marcou.
            ...(d.aptoAltura ? [linha('Trabalho em altura', 'APTO (NR-35)')] : []),
            ...(d.aptoEletricidade ? [linha('Trabalho com eletricidade', 'APTO (NR-10)')] : []),
            linha('Restrições', d.restricoes),
            linha('Validade', d.validade),
            linha('Observações', d.observacoes),
          ]),

          new Paragraph({
            spacing: { before: 500, after: 0 },
            children: [new TextRun({ text: '_'.repeat(46), color: CINZA })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: d.medicoExaminador.nome, bold: true, size: 18 }),
              ...(registro(d.medicoExaminador)
                ? [new TextRun({ text: ` — ${registro(d.medicoExaminador)}`, size: 18 })]
                : []),
            ],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({ text: 'Médico examinador', size: 16, color: CINZA }),
            ],
          }),

          new Paragraph({
            children: [new TextRun({ text: '_'.repeat(46), color: CINZA })],
          }),
          new Paragraph({
            children: [new TextRun({ text: d.funcionario.nome, size: 18 })],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [new TextRun({ text: 'Assinatura do funcionário', size: 16, color: CINZA })],
          }),

          new Paragraph({
            spacing: { before: 200 },
            children: [
              new TextRun({
                text: `Código de verificação ${d.codigoVerificacao}`,
                size: 15,
                color: CINZA,
              }),
              ...(d.urlVerificacao
                ? [new TextRun({ text: ` · ${d.urlVerificacao}`, size: 15, color: CINZA })]
                : []),
            ],
          }),
          // Um .docx e editavel: quem recebe pode mudar o texto. Dizer isso
          // no proprio arquivo evita que a copia editada seja confundida com
          // o documento emitido.
          new Paragraph({
            children: [
              new TextRun({
                text:
                  'Cópia editável. O documento emitido pela clínica é o arquivo em PDF, ' +
                  'conferível pelo código acima.',
                size: 15,
                italics: true,
                color: CINZA,
              }),
            ],
          }),
          ...(d.rodape
            ? [
                new Paragraph({
                  spacing: { before: 120 },
                  children: [new TextRun({ text: d.rodape, size: 14, color: CINZA })],
                }),
              ]
            : []),
        ],
      },
    ],
  });

  return new Uint8Array(await Packer.toBuffer(doc));
}

export const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
