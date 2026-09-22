import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildAsoDocx, MIME_DOCX } from '@/modules/documents/aso-docx';
import { montarRiscos } from '@/modules/documents/riscos';
import type { DadosAso } from '@/modules/documents/aso-pdf';

/**
 * A.S.O. em Word.
 *
 * "lembrando que o ASO precisa ser um arquivo em docx" -- Isabella, 21/09.
 *
 * Um .docx e um ZIP com XML dentro. O teste abre o arquivo de verdade,
 * confere que as pecas que o Word exige estao la e le o texto do documento
 * -- porque gerar bytes nao prova nada: o que importa e o que esta escrito
 * na folha e se o Word consegue abrir.
 */

// --------------------------------------------------------------- ZIP
/** Le as entradas de um ZIP pelo diretorio central, como o Word faz. */
function entradasDoZip(bytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(bytes);
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fim < 0) throw new Error('nao e um ZIP: falta o fim do diretorio central');

  const quantas = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);

  const saida = new Map<string, Buffer>();
  for (let i = 0; i < quantas; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('entrada corrompida no diretorio');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComentario = buf.readUInt16LE(p + 32);
    const inicioLocal = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + tamNome).toString('utf8');

    // O cabecalho local repete nome e extra, com tamanhos proprios.
    const nomeLocal = buf.readUInt16LE(inicioLocal + 26);
    const extraLocal = buf.readUInt16LE(inicioLocal + 28);
    const dados = buf.subarray(
      inicioLocal + 30 + nomeLocal + extraLocal,
      inicioLocal + 30 + nomeLocal + extraLocal + tamComprimido,
    );

    saida.set(nome, metodo === 0 ? Buffer.from(dados) : inflateRawSync(dados));
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return saida;
}

/** Texto corrido de um XML do Word: so o que esta dentro de <w:t>. */
function textoDoDocumento(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) =>
      (m[1] ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    )
    .join(' ');
}

// -------------------------------------------------------------- dados
const DADOS: DadosAso = {
  clinica: {
    nome: 'H2 Medicina Ocupacional',
    razaoSocial: 'H2 Medicina Ocupacional Ltda',
    cnpj: 'CNPJ 52.830.198/0001-34',
    endereco: 'R. Sacramento, 908, Vila Itapura, Campinas',
    telefone: '(19) 3235-3599',
    cor: '#0F766E',
  },
  emitidoEm: new Date('2026-09-22T12:00:00Z'),
  empresaContratante: {
    razaoSocial: 'Metalúrgica Aurora Ltda',
    cnpj: '11.222.333/0001-81',
    endereco: 'Rua das Oficinas, 450',
    bairro: 'Distrito Industrial',
    cidade: 'Campinas / SP',
    cep: '13052-100',
  },
  funcionario: {
    nome: 'Izabella de Oliveira',
    matricula: '4477',
    cpf: '402.567.338-05',
    rg: '28.114.556-2',
    nascimento: '02/12/1963',
    idade: 62,
    sexo: 'Feminino',
    cargo: 'Recepcionista',
    setor: 'Administrativo',
  },
  medicoPcmso: {
    nome: 'Dr. Responsável do PCMSO',
    conselho: 'CRM',
    numero: '104564',
    uf: 'SP',
    rqe: null,
    endereco: null,
    bairro: null,
    cidade: null,
    cep: null,
    telefone: null,
  },
  medicoExaminador: {
    nome: 'Dra. Wania Sanches Picasso',
    conselho: 'CRM',
    numero: '98765',
    uf: 'SP',
  },
  riscos: montarRiscos(null, null),
  tipoExame: 'Admissional',
  exames: [
    { nome: 'Exame Clínico', data: '22/09/2026' },
    { nome: 'Audiometria', data: '22/09/2026' },
  ],
  parecer: 'apto',
  restricoes: null,
  validade: '22/09/2027',
  observacoes: 'Retorno em um ano.',
  assinaturaPaciente: null,
  codigoVerificacao: 'ABCDEF0123',
  urlVerificacao: 'https://h2-medicina.vercel.app/verificar',
  rodape: null,
};

describe('A.S.O. em Word', () => {
  it('é um arquivo que o Word consegue abrir', async () => {
    const bytes = await buildAsoDocx(DADOS);
    const zip = entradasDoZip(bytes);

    // As quatro pecas sem as quais o Word recusa o arquivo.
    expect(zip.has('[Content_Types].xml')).toBe(true);
    expect(zip.has('_rels/.rels')).toBe(true);
    expect(zip.has('word/document.xml')).toBe(true);
    expect(zip.has('word/_rels/document.xml.rels')).toBe(true);

    const tipos = zip.get('[Content_Types].xml')!.toString('utf8');
    expect(tipos).toContain('wordprocessingml.document.main+xml');
  });

  it('o XML do documento é bem formado', async () => {
    const zip = entradasDoZip(await buildAsoDocx(DADOS));
    const xml = zip.get('word/document.xml')!.toString('utf8');

    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<w:document');
    expect(xml.trimEnd().endsWith('</w:document>')).toBe(true);
    // Toda marca aberta tem a sua fechada.
    const abre = (xml.match(/<w:body>/g) ?? []).length;
    const fecha = (xml.match(/<\/w:body>/g) ?? []).length;
    expect(abre).toBe(fecha);
    expect(abre).toBe(1);
  });

  it('traz o funcionário, a empresa e o parecer', async () => {
    const zip = entradasDoZip(await buildAsoDocx(DADOS));
    const texto = textoDoDocumento(zip.get('word/document.xml')!.toString('utf8'));

    expect(texto).toContain('ATESTADO DE SAÚDE OCUPACIONAL');
    expect(texto).toContain('Izabella de Oliveira');
    expect(texto).toContain('402.567.338-05');
    expect(texto).toContain('Metalúrgica Aurora Ltda');
    expect(texto).toContain('Recepcionista');
    expect(texto).toContain('Admissional');
    expect(texto).toContain('APTO');
    expect(texto).toContain('22/09/2027');
  });

  it('a data de nascimento sai como está no cadastro', async () => {
    // Mesmo cuidado do PDF: foi aqui que a data voltava um dia.
    const zip = entradasDoZip(await buildAsoDocx(DADOS));
    const texto = textoDoDocumento(zip.get('word/document.xml')!.toString('utf8'));
    expect(texto).toContain('02/12/1963');
    expect(texto).toContain('62 anos');
  });

  it('nomeia os dois médicos e o que cada um é', async () => {
    const zip = entradasDoZip(await buildAsoDocx(DADOS));
    const texto = textoDoDocumento(zip.get('word/document.xml')!.toString('utf8'));

    expect(texto).toContain('Dr. Responsável do PCMSO');
    expect(texto).toContain('CRM 104564/SP');
    expect(texto).toContain('Dra. Wania Sanches Picasso');
    expect(texto).toContain('CRM 98765/SP');
    expect(texto).toContain('Médico examinador');
  });

  it('traz o código de verificação e diz que é cópia editável', async () => {
    const zip = entradasDoZip(await buildAsoDocx(DADOS));
    const texto = textoDoDocumento(zip.get('word/document.xml')!.toString('utf8'));

    expect(texto).toContain('ABCDEF0123');
    // Arquivo editavel precisa dizer que e editavel: senao uma copia
    // alterada passa por documento emitido.
    expect(texto.toLowerCase()).toContain('cópia editável');
  });

  it('não leva assinatura de imagem', async () => {
    // Assinatura embutida em arquivo editavel valida o que nao foi
    // assinado: qualquer um muda o texto e ela continua la.
    const zip = entradasDoZip(await buildAsoDocx({ ...DADOS, assinaturaMedico: 'data:image/png;base64,AAAA' }));
    const nomes = [...zip.keys()];
    expect(nomes.filter((n) => n.startsWith('word/media/'))).toEqual([]);
  });

  it('aguenta cadastro cheio de buraco sem quebrar', async () => {
    const vazio: DadosAso = {
      ...DADOS,
      empresaContratante: {
        razaoSocial: 'Particular',
        cnpj: null,
        endereco: null,
        bairro: null,
        cidade: null,
        cep: null,
      },
      funcionario: {
        ...DADOS.funcionario,
        matricula: null,
        cpf: null,
        rg: null,
        nascimento: '—',
        idade: null,
        cargo: null,
        setor: null,
      },
      medicoPcmso: { ...DADOS.medicoPcmso, nome: null, numero: null, uf: null },
      exames: [],
      restricoes: null,
      validade: null,
      observacoes: null,
      urlVerificacao: null,
    };

    const zip = entradasDoZip(await buildAsoDocx(vazio));
    const texto = textoDoDocumento(zip.get('word/document.xml')!.toString('utf8'));
    expect(texto).toContain('ATESTADO DE SAÚDE OCUPACIONAL');
    expect(texto).toContain('Nenhum exame registrado');
    expect(texto).toContain('—');
  });

  it('o tipo do arquivo é o que o Word espera', () => {
    expect(MIME_DOCX).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
