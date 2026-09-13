import { describe, expect, it } from 'vitest';
import { SETOR_DA_ETAPA, contarPorSetor } from '@/components/layout/contadores-calculo';

const em = (...etapas: string[]) => etapas.map((stage_code) => ({ stage_code }));

describe('contarPorSetor', () => {
  it('conta cada etapa no setor certo', () => {
    const c = contarPorSetor(
      em('aguardando_recepcao', 'na_recepcao', 'em_triagem', 'aguardando_pagamento'),
    );
    expect(c.recepcao).toBe(2);
    expect(c.triagem).toBe(1);
    expect(c.pagamentos).toBe(1);
    expect(c.filas).toBe(0);
  });

  it('o paciente em consulta conta na bolinha do medico', () => {
    const c = contarPorSetor(em('aguardando_medico', 'em_consulta'));
    expect(c.medico).toBe(2);
  });

  it('a soma dos setores bate com a bolinha do CRM', () => {
    const c = contarPorSetor(
      em('aguardando_recepcao', 'em_triagem', 'em_exames', 'em_consulta', 'aguardando_documentos'),
    );
    const soma =
      (c.recepcao ?? 0) +
      (c.triagem ?? 0) +
      (c.filas ?? 0) +
      (c.medico ?? 0) +
      (c.pagamentos ?? 0) +
      (c.documentos ?? 0);
    expect(soma).toBe(c.crm);
    expect(c.crm).toBe(5);
  });

  it('etapa desconhecida nao entra em contador nenhum', () => {
    const c = contarPorSetor(em('finalizado', 'cancelado', 'etapa_que_nao_existe'));
    expect(c.crm).toBe(0);
    expect(c.recepcao).toBe(0);
  });

  it('clinica vazia devolve tudo zerado, nao indefinido', () => {
    const c = contarPorSetor([]);
    for (const valor of Object.values(c)) expect(valor).toBe(0);
  });

  it('aguenta o movimento de um dia cheio', () => {
    const muitos = Array.from({ length: 500 }, (_, i) => ({
      stage_code: i % 2 === 0 ? 'aguardando_medico' : 'em_exames',
    }));
    const c = contarPorSetor(muitos);
    expect(c.medico).toBe(250);
    expect(c.filas).toBe(250);
    expect(c.crm).toBe(500);
  });
});

describe('SETOR_DA_ETAPA', () => {
  it('nao deixa etapa aberta sem setor', () => {
    const abertas = [
      'aguardando_recepcao',
      'na_recepcao',
      'aguardando_triagem',
      'em_triagem',
      'aguardando_exames',
      'em_exames',
      'aguardando_medico',
      'em_consulta',
      'aguardando_pagamento',
      'aguardando_documentos',
    ];
    for (const etapa of abertas) expect(SETOR_DA_ETAPA[etapa]).toBeDefined();
  });

  it('etapa terminal nao tem setor', () => {
    expect(SETOR_DA_ETAPA['finalizado']).toBeUndefined();
    expect(SETOR_DA_ETAPA['cancelado']).toBeUndefined();
  });
});
