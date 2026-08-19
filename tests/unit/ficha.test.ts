import { describe, expect, it } from 'vitest';
import {
  BLOCOS_FICHA,
  SISTEMAS_EXAME_FISICO,
  respondidos,
  respostasVazias,
  sistemasAlterados,
} from '@/modules/clinical/ficha-estrutura';

describe('estrutura da ficha clínica', () => {
  it('tem os quatro blocos da ficha em papel', () => {
    expect(BLOCOS_FICHA.map((b) => b.chave)).toEqual([
      'antecedentes_profissionais',
      'antecedentes_pessoais',
      'estilo_vida',
      'exame_fisico',
    ]);
  });

  it('cobre os nove sistemas do exame físico', () => {
    expect(SISTEMAS_EXAME_FISICO).toHaveLength(9);
    const rotulos = SISTEMAS_EXAME_FISICO.map((s) => s.rotulo);
    expect(rotulos).toContain('Coluna');
    expect(rotulos).toContain('Pele e mucosas');
    expect(rotulos).toContain('Aparelho respiratório');
  });

  it('não usa texto livre fora da observação', () => {
    const livres = BLOCOS_FICHA.flatMap((b) => b.campos).filter((c) => c.tipo === 'texto');
    expect(livres, 'todos os campos devem ser de seleção').toHaveLength(0);
  });

  it('não traz a seção de psicologia, removida pela doutora', () => {
    const tudo = JSON.stringify(BLOCOS_FICHA).toLowerCase();
    expect(tudo).not.toContain('psicolog');
  });

  it('começa com todas as respostas em branco', () => {
    const bloco = BLOCOS_FICHA[0]!;
    const vazio = respostasVazias(bloco);
    expect(Object.keys(vazio)).toHaveLength(bloco.campos.length);
    expect(Object.values(vazio).every((v) => v === '')).toBe(true);
  });

  it('lista apenas o que foi respondido', () => {
    const bloco = BLOCOS_FICHA[1]!;
    const r = respondidos(bloco, { cirurgias: 'sim', alergias: '', internacoes: 'não' });
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.valor)).toEqual(['sim', 'não']);
  });

  it('aponta os sistemas alterados para o médico detalhar', () => {
    expect(sistemasAlterados({ coluna: 'alterado', abdome: 'normal' })).toEqual(['Coluna']);
    expect(sistemasAlterados({})).toEqual([]);
    expect(sistemasAlterados(null)).toEqual([]);
  });
});
