import { describe, expect, it } from 'vitest';
import { statusDoAtendimento } from '@/modules/queue/appointment-status';

const base = { stage_code: 'aguardando_recepcao', finished_at: null, cancelled_at: null, absent_at: null };

describe('status que a agenda deve mostrar', () => {
  it('quem chegou mas ainda não foi chamado aparece como check-in', () => {
    expect(statusDoAtendimento(base)).toBe('checkin');
    expect(statusDoAtendimento({ ...base, stage_code: 'checkin' })).toBe('checkin');
  });

  it('em qualquer etapa da esteira aparece como em atendimento', () => {
    for (const etapa of [
      'na_recepcao', 'em_triagem', 'aguardando_exames', 'em_exames',
      'aguardando_medico', 'em_consulta', 'aguardando_pagamento', 'aguardando_documentos',
    ]) {
      expect(statusDoAtendimento({ ...base, stage_code: etapa }), etapa).toBe('em_atendimento');
    }
  });

  it('atendimento concluído aparece como realizado', () => {
    expect(statusDoAtendimento({ ...base, stage_code: 'finalizado' })).toBe('realizado');
    expect(statusDoAtendimento({ ...base, finished_at: '2026-08-05T12:00:00Z' })).toBe('realizado');
  });

  it('ausência e cancelamento prevalecem sobre a etapa', () => {
    expect(statusDoAtendimento({ ...base, stage_code: 'em_exames', absent_at: 'x' })).toBe('ausente');
    expect(statusDoAtendimento({ ...base, stage_code: 'em_exames', cancelled_at: 'x' })).toBe('cancelado');
  });

  it('cancelamento tem precedência sobre ausência', () => {
    expect(statusDoAtendimento({ ...base, absent_at: 'x', cancelled_at: 'x' })).toBe('cancelado');
  });
});
