import { describe, expect, it } from 'vitest';
import {
  ETAPAS,
  ORDEM_DA_ESTEIRA,
  duracaoEmPalavras,
  etapaDe,
  montarTrilha,
  type MovimentoBruto,
} from '@/modules/guide/etapas';
import { ROTEIROS, roteiroDaRota, roteiroPorChave } from '@/modules/guide/roteiros';

describe('etapas explicadas', () => {
  it('cobre todas as etapas que o fluxo produz', () => {
    const codigos = ETAPAS.map((e) => e.code);
    for (const esperado of ORDEM_DA_ESTEIRA) {
      expect(codigos, `faltou a etapa ${esperado}`).toContain(esperado);
    }
    expect(codigos).toContain('cancelado');
    expect(codigos).toContain('ausente');
  });

  it('explica cada etapa em linguagem de balcão, não em código', () => {
    for (const etapa of ETAPAS) {
      expect(etapa.rotulo.length, etapa.code).toBeGreaterThan(3);
      expect(etapa.onde.length, etapa.code).toBeGreaterThan(10);
      expect(etapa.proximo.length, etapa.code).toBeGreaterThan(5);
      // Nada de nome técnico vazando para a tela.
      expect(etapa.onde).not.toMatch(/stage_code|attendance/);
    }
  });

  it('não inventa etapa: código desconhecido não quebra a tela', () => {
    const etapa = etapaDe('etapa_que_nao_existe');
    expect(etapa.rotulo).toBe('etapa_que_nao_existe');
    expect(etapa.terminal).toBe(false);
  });

  it('marca como terminal apenas o que de fato encerrou', () => {
    expect(etapaDe('finalizado').terminal).toBe(true);
    expect(etapaDe('cancelado').terminal).toBe(true);
    expect(etapaDe('ausente').terminal).toBe(true);
    expect(etapaDe('em_triagem').terminal).toBe(false);
  });
});

describe('tempo em palavras', () => {
  it('fala como a recepção fala', () => {
    expect(duracaoEmPalavras(30)).toBe('menos de 1 min');
    expect(duracaoEmPalavras(90)).toBe('2 min');
    expect(duracaoEmPalavras(60 * 45)).toBe('45 min');
    expect(duracaoEmPalavras(60 * 60)).toBe('1h');
    expect(duracaoEmPalavras(60 * 95)).toBe('1h35');
  });

  it('não mostra tempo quando não há tempo', () => {
    expect(duracaoEmPalavras(null)).toBe('—');
    expect(duracaoEmPalavras(undefined)).toBe('—');
    expect(duracaoEmPalavras(-5)).toBe('—');
  });
});

describe('trilha do paciente', () => {
  const checkin = '2026-08-13T12:00:00.000Z';
  const movimentos: MovimentoBruto[] = [
    {
      from_stage: 'aguardando_recepcao',
      to_stage: 'na_recepcao',
      created_at: '2026-08-13T12:10:00.000Z',
      seconds_in_previous: 600,
      is_manual: false,
    },
    {
      from_stage: 'na_recepcao',
      to_stage: 'aguardando_triagem',
      created_at: '2026-08-13T12:20:00.000Z',
      seconds_in_previous: 600,
      is_manual: false,
    },
    {
      from_stage: 'aguardando_triagem',
      to_stage: 'em_triagem',
      created_at: '2026-08-13T12:35:00.000Z',
      seconds_in_previous: 900,
      is_manual: true,
    },
  ];

  it('reconstrói o caminho na ordem em que aconteceu', () => {
    const t = montarTrilha({
      stageCode: 'em_triagem',
      checkinAt: checkin,
      stageChangedAt: '2026-08-13T12:35:00.000Z',
      movimentos,
      agora: new Date('2026-08-13T12:47:00.000Z'),
    });

    expect(t.passos.map((p) => p.code)).toEqual([
      'aguardando_recepcao',
      'na_recepcao',
      'aguardando_triagem',
      'em_triagem',
    ]);
  });

  it('mede quanto tempo ficou em cada etapa', () => {
    const t = montarTrilha({
      stageCode: 'em_triagem',
      checkinAt: checkin,
      stageChangedAt: '2026-08-13T12:35:00.000Z',
      movimentos,
      agora: new Date('2026-08-13T12:47:00.000Z'),
    });

    expect(t.passos[0]?.segundos).toBe(600); // 10 min na espera da recepção
    expect(t.passos[1]?.segundos).toBe(600);
    expect(t.passos[2]?.segundos).toBe(900);
    // A última etapa ainda está acontecendo: não tem duração fechada.
    expect(t.passos[3]?.segundos).toBeNull();
    expect(t.segundosNaAtual).toBe(720); // 12 min em triagem
    expect(t.esperaTotalSegundos).toBe(2820); // 47 min na clínica
  });

  it('sinaliza o que foi movido à mão no CRM', () => {
    const t = montarTrilha({
      stageCode: 'em_triagem',
      checkinAt: checkin,
      stageChangedAt: null,
      movimentos,
      agora: new Date('2026-08-13T12:47:00.000Z'),
    });
    expect(t.passos.filter((p) => p.manual).map((p) => p.code)).toEqual(['em_triagem']);
  });

  it('funciona para quem acabou de chegar, sem nenhum movimento', () => {
    const t = montarTrilha({
      stageCode: 'aguardando_recepcao',
      checkinAt: checkin,
      stageChangedAt: checkin,
      movimentos: [],
      agora: new Date('2026-08-13T12:05:00.000Z'),
    });

    expect(t.passos).toHaveLength(1);
    expect(t.passos[0]?.code).toBe('aguardando_recepcao');
    expect(t.encerrado).toBe(false);
    expect(t.resumo).toContain('sala de espera');
  });

  it('para o cronômetro quando o atendimento termina', () => {
    const t = montarTrilha({
      stageCode: 'finalizado',
      checkinAt: checkin,
      stageChangedAt: '2026-08-13T13:00:00.000Z',
      finishedAt: '2026-08-13T13:00:00.000Z',
      movimentos,
      // Mesmo consultado horas depois, o total continua sendo 1h.
      agora: new Date('2026-08-13T18:00:00.000Z'),
    });

    expect(t.encerrado).toBe(true);
    expect(t.esperaTotalSegundos).toBe(3600);
    expect(t.resumo).toContain('1h');
  });

  it('o resumo diz onde está, de quem é a vez e o que vem depois', () => {
    const t = montarTrilha({
      stageCode: 'aguardando_medico',
      checkinAt: checkin,
      stageChangedAt: '2026-08-13T12:40:00.000Z',
      movimentos: [],
      agora: new Date('2026-08-13T12:50:00.000Z'),
    });

    expect(t.resumo).toContain('consultório');
    expect(t.resumo).toContain('Módulo médico');
    expect(t.resumo).toContain('10 min');
  });
});

describe('roteiro dos balões', () => {
  it('cobre as telas do dia a dia da equipe', () => {
    const rotas = ROTEIROS.map((r) => r.rota);
    for (const esperada of [
      '/dashboard',
      '/recepcao',
      '/triagem',
      '/filas',
      '/medico',
      '/pagamentos',
      '/documentos',
      '/crm',
      '/jornada',
    ]) {
      expect(rotas, `faltou roteiro para ${esperada}`).toContain(esperada);
    }
  });

  it('não repete rota nem chave', () => {
    expect(new Set(ROTEIROS.map((r) => r.rota)).size).toBe(ROTEIROS.length);
    expect(new Set(ROTEIROS.map((r) => r.chave)).size).toBe(ROTEIROS.length);
  });

  it('todo passo tem título e explicação de verdade', () => {
    for (const roteiro of ROTEIROS) {
      expect(roteiro.passos.length, roteiro.chave).toBeGreaterThan(1);
      for (const passo of roteiro.passos) {
        expect(passo.titulo.length, `${roteiro.chave}: ${passo.titulo}`).toBeGreaterThan(3);
        expect(passo.texto.length, `${roteiro.chave}: ${passo.titulo}`).toBeGreaterThan(30);
      }
    }
  });

  it('casa a rota exata, sem pegar as telas filhas', () => {
    expect(roteiroDaRota('/recepcao')?.chave).toBe('recepcao');
    expect(roteiroDaRota('/recepcao/')?.chave).toBe('recepcao');
    // /agenda/novo é outra tela: o guia da agenda falaria de coisas ausentes.
    expect(roteiroDaRota('/agenda/novo')).toBeNull();
    expect(roteiroDaRota('/tela-inexistente')).toBeNull();
    expect(roteiroDaRota(null)).toBeNull();
  });

  it('encontra o roteiro pela chave', () => {
    expect(roteiroPorChave('crm')?.rota).toBe('/crm');
    expect(roteiroPorChave('nao-existe')).toBeNull();
  });
});
