import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildAsoPdf, type DadosAso } from '@/modules/documents/aso-pdf';

/** PNG 1x1 transparente — serve de assinatura sem depender de arquivo externo. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const base: DadosAso = {
  clinica: {
    nome: 'Clínica Exemplo',
    razaoSocial: 'Clínica Exemplo Ltda',
    cnpj: '00.000.000/0001-00',
    endereco: 'Rua das Flores, 100',
    telefone: '(11) 4000-0000',
    cor: '#0F766E',
  },
  emitidoEm: new Date('2026-08-19T13:00:00Z'),
  empresaContratante: {
    razaoSocial: 'Indústria Modelo S.A.',
    cnpj: '11.111.111/0001-11',
    endereco: 'Av. Industrial, 500',
    cidade: 'São Paulo/SP',
    cep: '01000-000',
  },
  funcionario: {
    nome: 'Ana Paula Ribeiro',
    cpf: '123.456.789-00',
    rg: '12.345.678-9',
    nascimento: '10/03/1990',
    sexo: 'Feminino',
    cargo: 'Operadora de máquinas',
    setor: 'Produção',
  },
  medicoPcmso: { nome: 'Dra. Exemplo', conselho: 'CRM', numero: '79775', uf: 'SP', rqe: '1234' },
  medicoExaminador: { nome: 'Dra. Exemplo', conselho: 'CRM', numero: '79775', uf: 'SP' },
  tipoExame: 'Admissional',
  exames: ['Audiometria', 'Espirometria', 'ECG'],
  parecer: 'APTO',
  restricoes: null,
  validade: '19/08/2027',
  observacoes: null,
  assinaturaPaciente: null,
  codigoVerificacao: 'a1b2c3d4e5',
  urlVerificacao: 'https://exemplo.com/v/a1b2c3d4e5',
  rodape: 'Documento emitido eletronicamente.',
};

describe('buildAsoPdf', () => {
  it('gera um PDF de uma pagina em A4', async () => {
    const bytes = await buildAsoPdf(base);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('embute a assinatura do paciente quando existe', async () => {
    const comAssinatura = await buildAsoPdf({ ...base, assinaturaPaciente: PNG_1X1 });
    const sem = await buildAsoPdf(base);
    expect(comAssinatura.byteLength).toBeGreaterThan(sem.byteLength);
  });

  it('nao quebra com assinatura corrompida', async () => {
    const bytes = await buildAsoPdf({ ...base, assinaturaPaciente: 'data:image/png;base64,xxx' });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aceita campos opcionais ausentes', async () => {
    const bytes = await buildAsoPdf({
      ...base,
      clinica: { ...base.clinica, cnpj: null, endereco: null, telefone: null, cor: 'nao-e-cor' },
      empresaContratante: { razaoSocial: 'X', cnpj: null, endereco: null, cidade: null, cep: null },
      funcionario: { ...base.funcionario, cpf: null, rg: null, cargo: null, setor: null },
      medicoPcmso: { nome: null, conselho: 'CRM', numero: null, uf: null, rqe: null },
      medicoExaminador: { nome: 'Dra. Exemplo', conselho: 'CRM', numero: null, uf: null },
      exames: [],
      validade: null,
      urlVerificacao: null,
      rodape: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('imprime restricoes e observacoes longas sem estourar', async () => {
    const longo = 'Restrição detalhada '.repeat(30);
    const bytes = await buildAsoPdf({ ...base, restricoes: longo, observacoes: longo });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('joga as assinaturas para a segunda pagina quando o texto ocupa a folha', async () => {
    const enorme = 'Restrição muito detalhada do posto de trabalho. '.repeat(60);
    const doc = await PDFDocument.load(
      await buildAsoPdf({ ...base, restricoes: enorme, observacoes: enorme }),
    );
    expect(doc.getPageCount()).toBe(2);
  });
});
