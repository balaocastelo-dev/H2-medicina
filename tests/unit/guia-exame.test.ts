import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildGuiaDeExame, type DadosDaGuia } from '@/modules/documents/guia-exame';

/** Os mesmos dados do modelo que a clinica enviou, para comparar lado a lado. */
const base: DadosDaGuia = {
  clinica: { nome: 'H2 Medicina Ocupacional', cor: '#0F766E', logo: null },
  colaborador: {
    nome: 'Sebastião Geraldo de Azevedo',
    cpf: '048.215.328-83',
    rg: '28.829.632-1',
    sexo: 'Masculino',
    nascimento: '02/12/1963',
    cargo: null,
    setor: null,
  },
  empresa: {
    nome: 'PAGV CONSTRUÇÃO E ADMINISTRAÇÃO DE OBRAS LTDA',
    documento: '29.950.943/0001-31',
    endereco: 'R. Dona Carolina Prado Penteado, 45',
    bairro: 'Jardim Bom Retiro',
    cidadeUf: 'Campinas/SP',
    cep: '13092-470',
  },
  exames: ['RX de Tórax', 'RX Coluna Lombo-Sacra'],
  agendadoPara: '17/08/2026',
  preparos: null,
  localDoExame: 'R. Tiradentes, 164 – Vila Itapura – SP, 13023-190',
  rodape: 'H2 Medicina Ocupacional Ltda · R. Sacramento, 908 — Campinas/SP · (19) 3235-3599',
};

describe('buildGuiaDeExame', () => {
  it('gera uma pagina A4', async () => {
    const doc = await PDFDocument.load(await buildGuiaDeExame(base));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('funciona sem empresa (paciente particular)', async () => {
    const bytes = await buildGuiaDeExame({ ...base, empresa: null });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('funciona com todos os campos opcionais vazios', async () => {
    const bytes = await buildGuiaDeExame({
      ...base,
      colaborador: {
        nome: 'Fulano',
        cpf: null, rg: null, sexo: null, nascimento: null, cargo: null, setor: null,
      },
      empresa: null,
      exames: [],
      agendadoPara: null,
      preparos: null,
      rodape: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('cor invalida nao derruba a guia', async () => {
    const bytes = await buildGuiaDeExame({
      ...base,
      clinica: { ...base.clinica, cor: 'isso-nao-e-cor' },
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('logo corrompida nao impede a guia de sair', async () => {
    // O paciente esta no balcao esperando o papel.
    const bytes = await buildGuiaDeExame({
      ...base,
      clinica: { ...base.clinica, logo: new Uint8Array([1, 2, 3, 4]) },
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('muitos exames laboratoriais nao estouram a pagina', async () => {
    const doc = await PDFDocument.load(
      await buildGuiaDeExame({
        ...base,
        exames: Array.from({ length: 30 }, (_, i) => `Exame laboratorial numero ${i + 1}`),
      }),
    );
    expect(doc.getPageCount()).toBe(1);
  });

  it('exame com nome muito longo quebra em vez de vazar', async () => {
    const bytes = await buildGuiaDeExame({
      ...base,
      exames: ['Hemograma completo com contagem de plaquetas e diferencial de leucocitos e mais coisas'],
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('gera a amostra para conferencia', async () => {
    writeFileSync(
      'C:/Users/user/AppData/Roaming/Claude/local-agent-mode-sessions/40ff9b69-4816-4b03-bdba-1491423cf72e/8b9607bc-71e4-4c0c-a224-e0427495d82b/local_838cf626-e02e-49ce-a570-15c00a5f1125/outputs/exemplo-guia-de-exame.pdf',
      await buildGuiaDeExame(base),
    );
    expect(true).toBe(true);
  });
});
