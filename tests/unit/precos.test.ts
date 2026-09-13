import { describe, expect, it } from 'vitest';
import {
  montarCobranca,
  precoDoExame,
  type ExameCobravel,
  type PrecoNegociado,
} from '@/modules/companies/precos';

const AUDIO: ExameCobravel = { id: 'audio', nome: 'Audiometria', precoPadrao: 80 };
const ACUIDADE: ExameCobravel = { id: 'acuidade', nome: 'Acuidade visual', precoPadrao: 40 };

const NEGOCIADOS: PrecoNegociado[] = [
  { exam_type_id: 'audio', contract_id: null, price: 55 },
  { exam_type_id: 'audio', contract_id: 'contrato-2026', price: 48 },
];

describe('precoDoExame', () => {
  it('sem nada negociado, cobra o preco de tabela', () => {
    const r = precoDoExame(ACUIDADE, NEGOCIADOS);
    expect(r.valor).toBe(40);
    expect(r.origem).toBe('tabela');
  });

  it('valor da empresa ganha do preco de tabela', () => {
    const r = precoDoExame(AUDIO, NEGOCIADOS);
    expect(r.valor).toBe(55);
    expect(r.origem).toBe('empresa');
  });

  it('valor do contrato ganha do valor da empresa', () => {
    const r = precoDoExame(AUDIO, NEGOCIADOS, 'contrato-2026');
    expect(r.valor).toBe(48);
    expect(r.origem).toBe('contrato');
  });

  it('contrato sem preco proprio cai no valor da empresa', () => {
    const r = precoDoExame(AUDIO, NEGOCIADOS, 'outro-contrato');
    expect(r.valor).toBe(55);
    expect(r.origem).toBe('empresa');
  });

  it('aceita valor que vem do banco como texto', () => {
    const r = precoDoExame(AUDIO, [{ exam_type_id: 'audio', contract_id: null, price: '55.50' }]);
    expect(r.valor).toBe(55.5);
  });

  it('valor invalido nao vira NaN na conta', () => {
    const r = precoDoExame(AUDIO, [
      { exam_type_id: 'audio', contract_id: null, price: 'nao e numero' },
    ]);
    expect(r.valor).toBe(0);
  });

  it('preco negociado zero e respeitado: exame de cortesia existe', () => {
    const r = precoDoExame(AUDIO, [{ exam_type_id: 'audio', contract_id: null, price: 0 }]);
    expect(r.valor).toBe(0);
    expect(r.origem).toBe('empresa');
  });
});

describe('montarCobranca', () => {
  it('soma os exames escolhidos', () => {
    const r = montarCobranca([AUDIO, ACUIDADE], NEGOCIADOS);
    expect(r.total).toBe(95);
    expect(r.itens).toHaveLength(2);
  });

  it('usa o preco do contrato quando informado', () => {
    expect(montarCobranca([AUDIO, ACUIDADE], NEGOCIADOS, 'contrato-2026').total).toBe(88);
  });

  it('avisa quando algum exame caiu no preco de tabela', () => {
    expect(montarCobranca([AUDIO, ACUIDADE], NEGOCIADOS).usouTabela).toBe(true);
    expect(montarCobranca([AUDIO], NEGOCIADOS).usouTabela).toBe(false);
  });

  it('particular paga tudo pelo preco de tabela', () => {
    const r = montarCobranca([AUDIO, ACUIDADE], []);
    expect(r.total).toBe(120);
    expect(r.itens.every((i) => i.origem === 'tabela')).toBe(true);
  });

  it('sem exame escolhido, o total e zero', () => {
    expect(montarCobranca([], NEGOCIADOS)).toEqual({ itens: [], total: 0, usouTabela: false });
  });
});
