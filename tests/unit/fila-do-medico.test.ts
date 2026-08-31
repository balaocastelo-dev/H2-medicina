import { describe, expect, it } from 'vitest';
import {
  ordenarFilaDoMedico,
  pesoDaPrioridade,
  proximoDaFilaDoMedico,
} from '@/modules/queue/fila-do-medico';

const paciente = (nome: string, priority: string, checkin_at: string) => ({
  nome,
  priority,
  checkin_at,
});

describe('fila do medico', () => {
  it('chama o prioritario antes de quem chegou primeiro', () => {
    const fila = [
      paciente('Chegou cedo', 'normal', '2026-08-31T08:00:00Z'),
      paciente('Idosa', 'prioritario', '2026-08-31T10:30:00Z'),
    ];
    expect(proximoDaFilaDoMedico(fila)?.nome).toBe('Idosa');
  });

  it('encaixe passa na frente do normal e fica atras do prioritario', () => {
    const fila = [
      paciente('Normal', 'normal', '2026-08-31T08:00:00Z'),
      paciente('Encaixe', 'encaixe', '2026-08-31T09:00:00Z'),
      paciente('Prioritario', 'prioritario', '2026-08-31T09:30:00Z'),
    ];
    expect(ordenarFilaDoMedico(fila).map((p) => p.nome)).toEqual([
      'Prioritario',
      'Encaixe',
      'Normal',
    ]);
  });

  it('na mesma prioridade vale quem chegou antes', () => {
    const fila = [
      paciente('Depois', 'normal', '2026-08-31T09:00:00Z'),
      paciente('Antes', 'normal', '2026-08-31T08:00:00Z'),
    ];
    expect(ordenarFilaDoMedico(fila).map((p) => p.nome)).toEqual(['Antes', 'Depois']);
  });

  it('prioridade desconhecida entra como normal, sem sumir da fila', () => {
    const fila = [
      paciente('Estranho', 'urgentissimo', '2026-08-31T08:00:00Z'),
      paciente('Normal', 'normal', '2026-08-31T09:00:00Z'),
    ];
    expect(pesoDaPrioridade('urgentissimo')).toBe(pesoDaPrioridade('normal'));
    expect(ordenarFilaDoMedico(fila)).toHaveLength(2);
    expect(proximoDaFilaDoMedico(fila)?.nome).toBe('Estranho');
  });

  it('fila vazia nao tem proximo', () => {
    expect(proximoDaFilaDoMedico([])).toBeNull();
  });

  it('nao altera a lista recebida', () => {
    const fila = [
      paciente('Normal', 'normal', '2026-08-31T08:00:00Z'),
      paciente('Prioritario', 'prioritario', '2026-08-31T09:00:00Z'),
    ];
    ordenarFilaDoMedico(fila);
    expect(fila[0]!.nome).toBe('Normal');
  });

  it('as tres salas concordam sobre quem e o proximo', () => {
    // Cada consultorio monta a fila por conta propria. Se a ordem dependesse
    // da tela, duas salas chamariam pessoas diferentes achando que sao a mesma.
    const fila = [
      paciente('A', 'normal', '2026-08-31T08:00:00Z'),
      paciente('B', 'prioritario', '2026-08-31T09:00:00Z'),
      paciente('C', 'encaixe', '2026-08-31T07:00:00Z'),
    ];
    const sala1 = proximoDaFilaDoMedico(fila);
    const sala2 = proximoDaFilaDoMedico([...fila].reverse());
    expect(sala1?.nome).toBe(sala2?.nome);
  });
});
