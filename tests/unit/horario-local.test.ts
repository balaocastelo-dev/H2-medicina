import { describe, expect, it } from 'vitest';
import { horarioLocalParaISO } from '@/lib/format';

/**
 * O campo datetime-local do navegador manda o horario sem fuso nenhum.
 * Interpretado no servidor da Vercel, que roda em UTC, 14:30 virava
 * 14:30 UTC = 11:30 em Sao Paulo. Era o "horario que mudava sozinho".
 */
describe('horarioLocalParaISO', () => {
  it('le o horario como horario da clinica, nao do servidor', () => {
    expect(horarioLocalParaISO('2026-08-21T14:30')).toBe('2026-08-21T17:30:00.000Z');
  });

  it('nao desloca nada: 14:30 continua 14:30 em Sao Paulo', () => {
    const iso = horarioLocalParaISO('2026-08-21T14:30');
    const deVolta = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
    expect(deVolta).toBe('14:30');
  });

  it('aceita com e sem segundos', () => {
    expect(horarioLocalParaISO('2026-08-21T14:30:00')).toBe('2026-08-21T17:30:00.000Z');
  });

  it('respeita o fuso quando ele ja veio no texto', () => {
    expect(horarioLocalParaISO('2026-08-21T14:30:00-03:00')).toBe('2026-08-21T17:30:00.000Z');
    expect(horarioLocalParaISO('2026-08-21T17:30:00Z')).toBe('2026-08-21T17:30:00.000Z');
  });

  it('pode ser aplicado duas vezes sem estragar o valor', () => {
    const uma = horarioLocalParaISO('2026-08-21T14:30');
    expect(horarioLocalParaISO(uma)).toBe(uma);
  });

  it('atravessa a meia-noite sem trocar o dia', () => {
    // 23:30 em Sao Paulo e 02:30 UTC do dia seguinte.
    expect(horarioLocalParaISO('2026-08-21T23:30')).toBe('2026-08-22T02:30:00.000Z');
  });

  it('devolve vazio para entrada invalida em vez de uma data doida', () => {
    expect(horarioLocalParaISO('')).toBe('');
    expect(horarioLocalParaISO('nao e data')).toBe('');
    expect(horarioLocalParaISO('2026-13-45T99:99')).toBe('');
  });
});
