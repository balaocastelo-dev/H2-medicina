import { describe, expect, it } from 'vitest';
import { umDo, todosDe } from '@/lib/embed';

/**
 * Vinculo embutido do PostgREST: objeto ou lista.
 *
 * `triages` e `medical_consultations` tem `unique (attendance_id)`. Para o
 * PostgREST isso e um-para-um, e o embed vem como objeto. Ler `?.[0]` num
 * objeto devolve `undefined` — sem erro, sem aviso, sem log.
 *
 * Em 21/09 isso produziu tres reclamacoes da clinica de uma vez: a tela do
 * medico dizendo "Sem triagem registrada" para quem acabara de ser triado,
 * o A.S.O. recusando a emissao por falta da conclusao de aptidao que estava
 * preenchida, e a ficha clinica saindo em branco.
 */

describe('umDo', () => {
  it('aceita o objeto que o vinculo um-para-um devolve', () => {
    expect(umDo({ id: 'a' })).toEqual({ id: 'a' });
  });

  it('aceita a lista que o vinculo um-para-muitos devolve', () => {
    expect(umDo([{ id: 'a' }, { id: 'b' }])).toEqual({ id: 'a' });
  });

  it('lista vazia nao vira objeto', () => {
    expect(umDo([])).toBeUndefined();
  });

  it('nulo e indefinido passam batido', () => {
    expect(umDo(null)).toBeUndefined();
    expect(umDo(undefined)).toBeUndefined();
  });

  it('nao confunde valor falso com ausencia', () => {
    // Um vinculo nunca devolve 0 nem string vazia, mas a funcao e generica:
    // trocar `== null` por `!valor` quebraria aqui antes de quebrar em
    // producao.
    expect(umDo(0 as unknown as number)).toBe(0);
    expect(umDo('' as unknown as string)).toBe('');
    expect(umDo(false as unknown as boolean)).toBe(false);
  });
});

describe('todosDe', () => {
  it('embrulha o objeto em lista', () => {
    expect(todosDe({ id: 'a' })).toEqual([{ id: 'a' }]);
  });

  it('devolve a lista como esta', () => {
    expect(todosDe([{ id: 'a' }, { id: 'b' }])).toHaveLength(2);
  });

  it('vazio devolve lista vazia', () => {
    expect(todosDe(null)).toEqual([]);
    expect(todosDe(undefined)).toEqual([]);
    expect(todosDe([])).toEqual([]);
  });
});

describe('o defeito de 21/09, reproduzido', () => {
  /** O que a tela do medico recebe quando ha triagem. */
  const comoOPostgrestDevolve = { triages: { blood_pressure_systolic: 120 } };

  it('a leitura antiga perdia a triagem', () => {
    const antiga = (comoOPostgrestDevolve.triages as unknown as { 0?: unknown })[0];
    expect(antiga).toBeUndefined();
  });

  it('a leitura de agora encontra', () => {
    expect(umDo(comoOPostgrestDevolve.triages)?.blood_pressure_systolic).toBe(120);
  });
});
