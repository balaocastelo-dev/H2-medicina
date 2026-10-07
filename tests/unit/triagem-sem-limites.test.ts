import { describe, expect, it } from 'vitest';
import { triageSchema } from '@/lib/validators';

/**
 * ---------------------------------------------------------------------
 * O que este arquivo tranca
 * ---------------------------------------------------------------------
 *     06/10/2026 08:35 - Isa: sabe aqueles limites de valores da triagem?
 *                             precisa tirar esses limites
 *
 * A triagem ANOTA o que o aparelho mostrou. Recusar o valor nao protege
 * ninguem: empurra o numero para o campo de observacoes, onde o medico nao
 * procura e o laudo nao le. Quem julga o valor e o medico, com ele na frente.
 *
 * Os limites estavam em tres camadas, e tirar so esta trocaria a mensagem no
 * campo por um erro cru do Postgres. As outras duas sairam na migration
 * 0055 (constraints `triages_bp_sane` e `triages_saturation_sane`, e a
 * precisao das colunas).
 */

const ATENDIMENTO = '00000000-0000-4000-8000-000000000001';
const base = { attendance_id: ATENDIMENTO };

/** Faixas que o sistema recusava antes de 07/10. */
const RECUSADOS_ANTES: Array<[string, string, number]> = [
  ['PA sistólica', 'blood_pressure_systolic', 310],
  ['PA sistólica baixa', 'blood_pressure_systolic', 35],
  ['PA diastólica', 'blood_pressure_diastolic', 220],
  ['temperatura', 'temperature_c', 46],
  ['temperatura baixa', 'temperature_c', 29],
  ['peso', 'weight_kg', 420],
  ['altura em metros', 'height_cm', 1.75],
  ['altura', 'height_cm', 260],
  ['frequência cardíaca', 'heart_rate', 260],
  ['frequência respiratória', 'respiratory_rate', 90],
  ['saturação', 'oxygen_saturation', 25],
];

describe('triagem aceita o que foi medido', () => {
  for (const [nome, campo, valor] of RECUSADOS_ANTES) {
    it(`aceita ${nome} = ${valor}`, () => {
      const r = triageSchema.safeParse({ ...base, [campo]: valor });
      expect(r.success, JSON.stringify(r.success ? {} : r.error.issues)).toBe(true);
    });
  }

  it('o caso normal continua passando', () => {
    const r = triageSchema.safeParse({
      ...base,
      blood_pressure_systolic: 120,
      blood_pressure_diastolic: 80,
      temperature_c: 36.5,
      weight_kg: 78.4,
      height_cm: 175,
      heart_rate: 72,
      respiratory_rate: 16,
      oxygen_saturation: 98,
    });
    expect(r.success).toBe(true);
  });

  it('campo em branco continua sendo campo em branco', () => {
    const r = triageSchema.safeParse({ ...base, weight_kg: null, height_cm: null });
    expect(r.success).toBe(true);
  });
});

/**
 * Tirar os limites nao e aceitar qualquer coisa: o que sobra e o que o banco
 * e a folha impressa exigem. Sem isso, um deslize de digitacao no tablet
 * viraria erro cru do Postgres na cara da enfermagem.
 */
describe('o que ainda é recusado, e com mensagem', () => {
  it('negativo', () => {
    const r = triageSchema.safeParse({ ...base, weight_kg: -5 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('negativo');
  });

  it('valor fora de qualquer escala', () => {
    const r = triageSchema.safeParse({ ...base, weight_kg: 50_000_000 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('escala');
  });

  it('texto não vira número', () => {
    expect(triageSchema.safeParse({ ...base, weight_kg: 'setenta' }).success).toBe(false);
  });

  it('batimento quebrado continua sendo inteiro', () => {
    const r = triageSchema.safeParse({ ...base, heart_rate: 72.5 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('inteiro');
  });
});
