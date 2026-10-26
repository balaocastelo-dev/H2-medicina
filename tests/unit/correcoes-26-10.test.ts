/**
 * Pedidos da Isa de 26/10: A.S.O., lista colada sem CPF, pericia/SISPER.
 */
import { describe, expect, it } from 'vitest';
import { examesDoAso } from '@/modules/documents/aso';
import {
  nomeServeParaReconhecer,
  reconhecerPeloNome,
} from '@/modules/import/mesma-pessoa';
import { consultaSoConcluir } from '@/modules/queue/origin-kind';

describe('exames do A.S.O.', () => {
  const exame = (code: string, name: string, status: string, finished_at: string | null = null) => ({
    status,
    finished_at,
    exam_types: { code, name },
  });

  it('lista tambem o que ainda nao foi concluido, sem data', () => {
    const r = examesDoAso(
      [
        exame('AUDIO', 'Audiometria', 'concluido', '2026-10-26T11:00:00Z'),
        exame('RAIOX', 'Raio X', 'pendente'),
        exame('LAB', 'Exames laboratoriais', 'em_fila'),
      ],
      '26/10/2026',
    );
    expect(r.map((e) => e.nome)).toEqual([
      'Exame Clínico',
      'Audiometria',
      'Raio X',
      'Exames laboratoriais',
    ]);
    expect(r.find((e) => e.nome === 'Raio X')?.data).toBeNull();
    expect(r.find((e) => e.nome === 'Audiometria')?.data).toBeTruthy();
  });

  it('nao repete exame clinico e consulta clinica ocupacional', () => {
    const r = examesDoAso(
      [exame('CLINICO', 'Consulta clinica ocupacional', 'concluido', '2026-10-26T11:00:00Z')],
      '26/10/2026',
    );
    expect(r).toEqual([{ nome: 'Exame Clínico', data: '26/10/2026' }]);
  });

  it('deixa de fora cancelado e nao realizado', () => {
    const r = examesDoAso(
      [exame('ECG', 'Eletrocardiograma', 'cancelado'), exame('EEG', 'Eletroencefalograma', 'nao_realizado')],
      '26/10/2026',
    );
    expect(r).toHaveLength(1);
  });

  it('muitos exames: nenhum some', () => {
    const muitos = Array.from({ length: 14 }, (_, i) =>
      exame(`X${i}`, `Exame ${i}`, i % 2 ? 'concluido' : 'pendente', '2026-10-26T11:00:00Z'),
    );
    expect(examesDoAso(muitos, '26/10/2026')).toHaveLength(15);
  });
});

describe('lista colada sem CPF: reconhecer quem ja veio', () => {
  const cadastros = [
    { id: 'raquel', full_name: 'Raquel Patrícia Felipe', registration_number: null },
    { id: 'maria1', full_name: 'Maria Silva', registration_number: null },
    { id: 'joao1', full_name: 'João Carlos Souza', registration_number: '123' },
    { id: 'ana1', full_name: 'Ana Paula Costa', registration_number: null },
    { id: 'ana2', full_name: 'ANA PAULA COSTA', registration_number: null },
  ];

  it('acha pelo nome, sem acento nem caixa', () => {
    expect(reconhecerPeloNome('RAQUEL PATRICIA FELIPE', null, cadastros)).toBe('raquel');
  });

  it('nome de duas palavras nao basta', () => {
    expect(nomeServeParaReconhecer('Maria Silva')).toBe(false);
    expect(reconhecerPeloNome('Maria Silva', null, cadastros)).toBeNull();
  });

  it('dois cadastros com o mesmo nome: nao escolhe', () => {
    expect(reconhecerPeloNome('Ana Paula Costa', null, cadastros)).toBeNull();
  });

  it('matricula diferente: nao e a mesma pessoa', () => {
    expect(reconhecerPeloNome('Joao Carlos Souza', '999', cadastros)).toBeNull();
    expect(reconhecerPeloNome('Joao Carlos Souza', '123', cadastros)).toBe('joao1');
  });
});

describe('pericia e SISPER: o medico so conclui', () => {
  it('vale para pericia (estado) e SISPER', () => {
    expect(consultaSoConcluir('estado')).toBe(true);
    expect(consultaSoConcluir('sisper')).toBe(true);
  });
  it('particular e ingresso continuam com a consulta completa', () => {
    expect(consultaSoConcluir('particular')).toBe(false);
    expect(consultaSoConcluir('ingresso')).toBe(false);
    expect(consultaSoConcluir(null)).toBe(false);
  });
});
