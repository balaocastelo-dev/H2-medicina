import { describe, expect, it } from 'vitest';
import {
  contarNaFila,
  distribuirExames,
  type ExameDistribuivel,
} from '@/modules/queue/distribuicao';

const sala = (id: string) => ({ id });

const exame = (
  id: string,
  opcoes: { room?: string | null; padrao?: string | null; status?: string } = {},
): ExameDistribuivel & { status: string } => ({
  id,
  status: opcoes.status ?? 'pendente',
  room_id: opcoes.room ?? null,
  exam_types: { default_room_id: opcoes.padrao ?? null },
});

describe('distribuirExames', () => {
  it('coloca o exame na sala em que ele foi posto', () => {
    const { porSala, semSala } = distribuirExames(
      [sala('s1'), sala('s2')],
      [exame('e1', { room: 's2' })],
    );
    expect(porSala.get('s2')?.map((e) => e.id)).toEqual(['e1']);
    expect(porSala.get('s1')).toEqual([]);
    expect(semSala).toEqual([]);
  });

  it('usa a sala padrao do tipo quando o exame nao tem sala', () => {
    const { porSala } = distribuirExames([sala('s1')], [exame('e1', { padrao: 's1' })]);
    expect(porSala.get('s1')?.map((e) => e.id)).toEqual(['e1']);
  });

  it('a sala escolhida na operacao vence a sala padrao do tipo', () => {
    const { porSala } = distribuirExames(
      [sala('s1'), sala('s2')],
      [exame('e1', { room: 's2', padrao: 's1' })],
    );
    expect(porSala.get('s2')?.map((e) => e.id)).toEqual(['e1']);
    expect(porSala.get('s1')).toEqual([]);
  });

  // ---------------------------------------------------------------
  // O defeito relatado pela clinica em 13/09.
  // ---------------------------------------------------------------
  it('exame sem sala nenhuma nao desaparece: sai em semSala', () => {
    const { porSala, semSala } = distribuirExames([sala('s1')], [exame('orfao')]);
    expect(porSala.get('s1')).toEqual([]);
    expect(semSala.map((e) => e.id)).toEqual(['orfao']);
  });

  it('exame apontando para sala inativa tambem cai em semSala', () => {
    // 's9' existe no banco mas nao esta na lista de salas ativas da tela.
    const { semSala } = distribuirExames([sala('s1')], [exame('e1', { room: 's9' })]);
    expect(semSala.map((e) => e.id)).toEqual(['e1']);
  });

  it('nenhum exame se perde e nenhum e contado duas vezes', () => {
    const exames = [
      exame('a', { room: 's1' }),
      exame('b', { padrao: 's2' }),
      exame('c'),
      exame('d', { room: 's2', padrao: 's1' }),
      exame('e', { room: 'sala-apagada' }),
    ];
    const d = distribuirExames([sala('s1'), sala('s2')], exames);
    const vistos = [...[...d.porSala.values()].flat(), ...d.semSala].map((e) => e.id).sort();
    expect(vistos).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('funciona sem sala nenhuma cadastrada', () => {
    const { porSala, semSala } = distribuirExames([], [exame('a'), exame('b', { room: 's1' })]);
    expect(porSala.size).toBe(0);
    expect(semSala).toHaveLength(2);
  });
});

describe('contarNaFila', () => {
  it('o numero do topo bate com a soma do que as salas mostram', () => {
    const exames = [
      exame('a', { room: 's1' }),
      exame('b', { room: 's1', status: 'em_fila' }),
      exame('c', { room: 's1', status: 'em_andamento' }),
      exame('d', { room: 's1', status: 'chamado' }),
    ];
    const contagem = contarNaFila(distribuirExames([sala('s1')], exames));
    expect(contagem.emSalas).toBe(2); // pendente + em_fila
    expect(contagem.semSala).toBe(0);
  });

  it('o que nao cabe em sala nenhuma e contado separado, nunca escondido', () => {
    // Exatamente o caso da clinica: salas vazias, cinco esperando.
    const orfaos = Array.from({ length: 5 }, (_, i) => exame(`o${i}`));
    const contagem = contarNaFila(distribuirExames([sala('s1'), sala('s2')], orfaos));
    expect(contagem.emSalas).toBe(0);
    expect(contagem.semSala).toBe(5);
  });

  it('exame ja concluido nao conta em lugar nenhum', () => {
    const contagem = contarNaFila(
      distribuirExames([sala('s1')], [exame('a', { room: 's1', status: 'concluido' })]),
    );
    expect(contagem.emSalas).toBe(0);
    expect(contagem.semSala).toBe(0);
  });
});
