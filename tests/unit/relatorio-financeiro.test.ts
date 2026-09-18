import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildRelatorioFinanceiro, type DadosDoRelatorio } from '@/modules/finance/relatorio-pdf';
import { porCategoria, resumirFluxo, type Movimento } from '@/modules/finance/fluxo-caixa';

const MOVIMENTOS: Movimento[] = [
  { competencia: '2026-09-02', pagoEm: '2026-09-02', tipo: 'receita', valor: 4200, categoria: 'Exame admissional' },
  { competencia: '2026-09-05', pagoEm: '2026-09-05', tipo: 'receita', valor: 2800, categoria: 'Perícia' },
  { competencia: '2026-09-08', pagoEm: null, tipo: 'receita', valor: 1900, categoria: 'Exame periódico' },
  { competencia: '2026-09-05', pagoEm: '2026-09-05', tipo: 'despesa', valor: 3200, categoria: 'aluguel' },
  { competencia: '2026-09-10', pagoEm: '2026-09-10', tipo: 'despesa', valor: 860, categoria: 'insumos' },
  { competencia: '2026-09-15', pagoEm: null, tipo: 'despesa', valor: 540, categoria: 'impostos' },
  { competencia: '2026-09-03', pagoEm: '2026-09-12', tipo: 'repasse', valor: 1240, categoria: 'Repasse médico' },
  { competencia: '2026-09-11', pagoEm: null, tipo: 'repasse', valor: 680, categoria: 'Repasse médico' },
];

const INICIO = '2026-09-01';
const FIM = '2026-09-30';

const base: DadosDoRelatorio = {
  clinica: {
    nome: 'H2 Medicina Ocupacional',
    razaoSocial: 'H2 Medicina Ocupacional Ltda',
    cnpj: 'CNPJ 52.830.198/0001-34',
    endereco: 'R. Sacramento, 908, Vila Itapura, Campinas, SP',
    contato: '(19) 3235-3599 · (19) 99935-3599',
    cor: '#0F766E',
    logo: null,
  },
  periodo: { rotulo: 'Mês', inicio: INICIO, fim: FIM },
  emitidoEm: new Date('2026-09-13T15:00:00Z'),
  emitidoPor: 'Dra. Wania Sanches Picasso',
  resumo: resumirFluxo(MOVIMENTOS, INICIO, FIM),
  despesas: porCategoria(MOVIMENTOS, 'despesa', INICIO, FIM),
  receitas: porCategoria(MOVIMENTOS, 'receita', INICIO, FIM),
  rodape: 'H2 Medicina Ocupacional Ltda · R. Sacramento, 908 — Campinas/SP · (19) 99935-3599',
};

describe('buildRelatorioFinanceiro', () => {
  it('gera um PDF de uma pagina em A4', async () => {
    const doc = await PDFDocument.load(await buildRelatorioFinanceiro(base));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('funciona com periodo sem movimento nenhum', async () => {
    const vazio = { inicio: '2026-01-01', fim: '2026-01-31' };
    const bytes = await buildRelatorioFinanceiro({
      ...base,
      periodo: { rotulo: 'Mês', ...vazio },
      resumo: resumirFluxo([], vazio.inicio, vazio.fim),
      despesas: [],
      receitas: [],
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aceita campos opcionais ausentes', async () => {
    const bytes = await buildRelatorioFinanceiro({
      ...base,
      clinica: { ...base.clinica, razaoSocial: null, cnpj: null, endereco: null, contato: null, cor: 'nao-e-cor' },
      rodape: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('muitas categorias nao estouram a pagina', async () => {
    const muitas = Array.from({ length: 40 }, (_, i) => ({
      categoria: `Categoria ${i}`,
      valor: 100 - i,
      fatia: 2.5,
    }));
    const doc = await PDFDocument.load(
      await buildRelatorioFinanceiro({ ...base, despesas: muitas, receitas: muitas }),
    );
    expect(doc.getPageCount()).toBe(1);
  });

  it('gera a amostra para conferencia', async () => {
    const bytes = await buildRelatorioFinanceiro(base);
    writeFileSync(
      'C:/Users/user/AppData/Roaming/Claude/local-agent-mode-sessions/40ff9b69-4816-4b03-bdba-1491423cf72e/8b9607bc-71e4-4c0c-a224-e0427495d82b/local_838cf626-e02e-49ce-a570-15c00a5f1125/outputs/exemplo-relatorio-financeiro.pdf',
      bytes,
    );
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
