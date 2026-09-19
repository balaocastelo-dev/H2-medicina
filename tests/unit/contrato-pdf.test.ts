import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildDocumentPdf } from '@/modules/documents/pdf';
import {
  paragrafosDoContrato,
  type DadosDoContrato,
} from '@/modules/companies/contract-template';

/**
 * O PDF do contrato, montado de ponta a ponta.
 *
 * "Aba contratos nao esta gerando o PDF" -- Isabella, 18/09.
 *
 * O texto do contrato ja era testado, mas ninguem tinha tentado
 * TRANSFORMAR aquele texto em PDF. E ali que as coisas quebram: a fonte
 * padrao do PDF nao escreve qualquer caractere, e um contrato com campo
 * em branco produz paragrafos diferentes dos do contrato preenchido.
 */

const MARCA = {
  systemName: 'H2 Medicina Ocupacional',
  legalName: 'H2 Medicina Ocupacional Ltda',
  document: 'CNPJ 52.830.198/0001-34',
  address: 'R. Sacramento, 908, Vila Itapura, Campinas, SP',
  contact: '(19) 3235-3599 · (19) 99935-3599',
  headerText: null,
  footerText: 'H2 Medicina Ocupacional Ltda',
  primaryColor: '#0F766E',
  logo: null,
};

// Tipado de proposito: sem isto o TypeScript nao confere a fixture
// contra o que a funcao realmente pede, e o teste quebra por falta de
// campo em vez de apontar defeito de verdade.
const COMPLETO: DadosDoContrato = {
  contratanteRazaoSocial: 'ENGECALHAS COM DE FERRAGENS E PROD MET',
  contratanteCnpj: '07.338.631/0001-64',
  contratanteEndereco: 'Rua João José Pereira, 402, Jardim Aero Continental, Campinas, SP',
  contratanteResponsavel: 'José da Silva',

  contratadaRazaoSocial: 'H2 Medicina Ocupacional Ltda',
  contratadaCnpj: '52.830.198/0001-34',
  contratadaEndereco: 'R. Sacramento, 908, Vila Itapura, Campinas',
  contratadaRepresentante: 'Wania Sanches Picasso',

  coordenadorNome: 'Wania Sanches Picasso',
  coordenadorCrm: 'CRM 79775 SP',

  numeroFuncionarios: 42,
  valorMensal: 1850.5,
  valorTotal: 22206,
  diaVencimento: 10,
  indiceReajuste: 'IPCA',
  multaAtraso: 2,
  jurosAtraso: 1,
  horaTecnica: 180,

  vigenciaInicio: '2026-09-01',
  vigenciaFim: '2027-08-31',
  renovacaoAutomatica: true,
  esocialAtivo: true,

  emailAgendamento: 'agenda@engecalhas.com.br',
  emailFinanceiro: 'financeiro@engecalhas.com.br',
  cidade: 'Campinas',
  dataEmissao: new Date('2026-09-19T12:00:00Z'),

  itens: [
    { kind: 'exame' as const, name: 'Audiometria', quantity_included: 42, unit_price: 90, extra_price: 95 },
    { kind: 'exame' as const, name: 'Consulta clínica ocupacional', quantity_included: 42, unit_price: 150, extra_price: 160 },
    { kind: 'servico' as const, name: 'PCMSO', quantity_included: 1, unit_price: 800, extra_price: null },
  ],
};

/** Contrato recém-criado, com quase tudo em branco — é assim que nasce. */
const VAZIO: DadosDoContrato = {
  ...COMPLETO,
  contratanteCnpj: null,
  contratanteEndereco: null,
  contratanteResponsavel: null,
  contratadaCnpj: null,
  contratadaEndereco: null,
  contratadaRepresentante: null,
  coordenadorNome: null,
  coordenadorCrm: null,
  numeroFuncionarios: null,
  valorMensal: null,
  valorTotal: null,
  diaVencimento: null,
  indiceReajuste: null,
  multaAtraso: null,
  jurosAtraso: null,
  horaTecnica: null,
  vigenciaInicio: null,
  vigenciaFim: null,
  renovacaoAutomatica: false,
  esocialAtivo: false,
  emailAgendamento: null,
  emailFinanceiro: null,
  itens: [],
};

async function montar(dados: DadosDoContrato) {
  return buildDocumentPdf({
    brand: MARCA,
    title: 'Contrato de prestação de serviços em medicina ocupacional',
    subtitle: dados.contratanteRazaoSocial,
    sections: [],
    paragraphs: paragrafosDoContrato(dados),
    signatureBlocks: [
      {
        caption: 'CONTRATANTE',
        name: dados.contratanteRazaoSocial,
        lines: [dados.contratanteCnpj ? `CNPJ ${dados.contratanteCnpj}` : 'CNPJ ______________'],
      },
      {
        caption: 'CONTRATADA',
        name: dados.contratadaRazaoSocial,
        lines: [dados.contratadaCnpj ? `CNPJ ${dados.contratadaCnpj}` : 'CNPJ ______________'],
      },
    ],
    verificationCode: 'A1B2C3D4E5',
  });
}

describe('PDF do contrato', () => {
  it('gera com o contrato preenchido', async () => {
    const doc = await PDFDocument.load(await montar(COMPLETO));
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('gera com o contrato recém-criado, tudo em branco', async () => {
    // O botão de PDF aparece assim que o contrato é salvo, e nesse
    // momento quase nada está preenchido.
    const bytes = await montar(VAZIO);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('gera sem nenhum item de exame ou serviço', async () => {
    const bytes = await montar({ ...COMPLETO, itens: [] });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('nome de empresa com acento e símbolo não derruba a fonte', async () => {
    // A fonte padrão do PDF não escreve qualquer caractere; um nome de
    // empresa fora do esperado derrubava o documento inteiro.
    const bytes = await montar({
      ...COMPLETO,
      contratanteRazaoSocial: 'AÇÃO & CIA — SÃO JOÃO LTDA. Nº 1',
      contratanteEndereco: 'Rua das Açucenas, 12 — 3º andar',
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('contrato longo, com muitos itens, não quebra', async () => {
    const muitos = Array.from({ length: 40 }, (_, i) => ({
      kind: (i % 2 === 0 ? 'exame' : 'servico') as 'exame' | 'servico',
      name: `Item de contrato número ${i + 1}`,
      quantity_included: i,
      unit_price: 10 * i,
      extra_price: 11 * i,
    }));
    const bytes = await montar({ ...COMPLETO, itens: muitos });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
