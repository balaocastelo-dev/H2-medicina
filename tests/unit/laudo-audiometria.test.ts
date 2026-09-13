import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildLaudoAudiometria, type DadosDoLaudo } from '@/modules/documents/laudo-audiometria';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const base: DadosDoLaudo = {
  clinica: {
    nome: 'H2 Medicina Ocupacional',
    endereco: 'R. Sacramento, 908 — Campinas/SP',
    telefone: '(19) 99935-3599',
    cor: '#0F766E',
  },
  emitidoEm: new Date('2026-09-13T13:00:00Z'),
  paciente: {
    nome: 'Carlos Augusto da Rocha',
    cpf: '352.600.068-95',
    nascimento: '25/11/1985',
    idade: 40,
    sexo: 'Masculino',
    cargo: 'Motorista/Entregador',
    setor: 'Transporte',
  },
  empresa: { razaoSocial: 'Indústria Modelo S.A.', cnpj: '11.111.111/0001-11' },
  tipoExame: 'Periódico',
  aparelho: {
    modelo: 'AD226',
    fabricante: 'Interacoustics',
    calibracao: '12/03/2026',
    repousoAuditivo: '14',
  },
  medicoes: {
    od_250: 10, od_500: 10, od_1000: 15, od_2000: 15,
    od_3000: 20, od_4000: 40, od_6000: 45, od_8000: 30,
    oe_250: 5, oe_500: 10, oe_1000: 10, oe_2000: 15,
    oe_3000: 15, oe_4000: 20, oe_6000: 25, oe_8000: 20,
  },
  meatoscopia: { od: 'Sem alterações', oe: 'Sem alterações' },
  conclusao: 'Sugestivo de perda auditiva em frequências agudas à direita. Manter acompanhamento.',
  medico: { nome: 'Dra. Wania Sanches Picasso', conselho: 'CRM', numero: '79775', uf: 'SP' },
  codigoVerificacao: 'A1B2C3D4E5',
  rodape: 'H2 Medicina Ocupacional Ltda · CNPJ 52.830.198/0001-34',
};

describe('buildLaudoAudiometria', () => {
  it('gera um PDF de uma pagina em A4', async () => {
    const bytes = await buildLaudoAudiometria(base);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('funciona com as duas orelhas sem medicao nenhuma', async () => {
    const bytes = await buildLaudoAudiometria({ ...base, medicoes: {} });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('funciona com medicao parcial', async () => {
    const bytes = await buildLaudoAudiometria({
      ...base,
      medicoes: { od_1000: 20, oe_4000: 35 },
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('descarta valor invalido em vez de quebrar', async () => {
    const bytes = await buildLaudoAudiometria({
      ...base,
      medicoes: { od_500: 'nao medido', od_1000: 999, od_2000: -80, oe_500: 15 },
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aceita campos opcionais ausentes', async () => {
    const bytes = await buildLaudoAudiometria({
      ...base,
      clinica: { ...base.clinica, endereco: null, telefone: null, cor: 'nao-e-cor' },
      paciente: { ...base.paciente, cpf: null, idade: null, cargo: null, setor: null },
      empresa: null,
      aparelho: { modelo: null, fabricante: null, calibracao: null, repousoAuditivo: null },
      meatoscopia: { od: null, oe: null },
      conclusao: null,
      medico: { nome: 'Dra. Exemplo', conselho: 'CRM', numero: null, uf: null },
      rodape: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('embute a assinatura do medico quando existe', async () => {
    const com = await buildLaudoAudiometria({ ...base, assinaturaMedico: PNG_1X1 });
    const sem = await buildLaudoAudiometria(base);
    expect(com.byteLength).toBeGreaterThan(sem.byteLength);
  });

  it('assinatura corrompida nao impede a emissao', async () => {
    const bytes = await buildLaudoAudiometria({
      ...base,
      assinaturaMedico: 'data:image/png;base64,xxx',
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('conclusao longa nao estoura a pagina', async () => {
    const bytes = await buildLaudoAudiometria({
      ...base,
      conclusao: Array.from({ length: 20 }, (_, i) => `Linha ${i} da conclusão`).join('\n'),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
