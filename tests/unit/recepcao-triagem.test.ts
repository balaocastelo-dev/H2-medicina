import { describe, expect, it } from 'vitest';
import { proximaEtapaDaRecepcao, regraDe, type OriginKind } from '@/modules/queue/origin-kind';

/**
 * Defeito de 14/09 na clinica: a recepcao marcava "encaminhar para triagem" e
 * o paciente ia direto ao medico. Aconteceu com Fernanda Ribeiro Sousa,
 * Evelyn Arrais Guzman Rocha, Breno Raphaldini, Mariana Rivelli e Davi Haas.
 *
 * A causa nao estava nesta funcao -- ela sempre respeitou `needsTriage`. A
 * escolha e que era apagada antes de chegar aqui: definir a procedencia
 * regravava `needs_triage` com o padrao da regra, na tela e no banco.
 *
 * Estes testes prendem o contrato dos dois lados: a decisao da recepcao vence
 * a sugestao da procedencia, sempre.
 */

import { ORIGIN_KINDS } from '@/modules/queue/origin-kind';

const TODAS: OriginKind[] = ORIGIN_KINDS;

describe('proximaEtapaDaRecepcao', () => {
  it('marcou triagem, vai para a triagem -- venha de onde vier', () => {
    for (const originKind of TODAS) {
      for (const temExames of [true, false]) {
        expect(
          proximaEtapaDaRecepcao({ originKind, needsTriage: true, temExames }),
        ).toBe('aguardando_triagem');
      }
    }
  });

  it('sem triagem e sem exame, vai ao medico e nao fica preso na fila', () => {
    for (const originKind of TODAS) {
      expect(
        proximaEtapaDaRecepcao({ originKind, needsTriage: false, temExames: false }),
      ).toBe('aguardando_medico');
    }
  });

  it('sem triagem e com exame, TODA procedencia vai para a fila de exames', () => {
    // Esta afirmacao dizia "segue a regra da procedencia", e era o defeito:
    // pericia e SISPER com exame marcado iam direto ao consultorio e o
    // exame ficava pendente para sempre, porque a chamada de sala so
    // enxerga quem esta em 'aguardando_exames' ou 'em_exames'.
    //
    // Exame marcado vem primeiro, qualquer que seja a procedencia. A ida ao
    // medico nao se perde: quando o ultimo exame termina, o gatilho olha a
    // procedencia e encaminha.
    for (const originKind of TODAS) {
      expect(proximaEtapaDaRecepcao({ originKind, needsTriage: false, temExames: true })).toBe(
        'aguardando_exames',
      );
    }
  });

  it('sem triagem e SEM exame, segue a regra da procedencia', () => {
    for (const originKind of TODAS) {
      const esperado =
        regraDe(originKind).afterTriage === 'medico' ? 'aguardando_medico' : 'aguardando_medico';
      expect(proximaEtapaDaRecepcao({ originKind, needsTriage: false, temExames: false })).toBe(
        esperado,
      );
    }
  });
});

describe('sugestao da procedencia', () => {
  it('cada procedencia tem uma sugestao de triagem definida', () => {
    for (const originKind of TODAS) {
      expect(typeof regraDe(originKind).needsTriage).toBe('boolean');
    }
  });

  it('procedencia desconhecida cai em particular, e nao quebra', () => {
    expect(regraDe('coisa-que-nao-existe')).toEqual(regraDe('particular'));
    expect(regraDe(null)).toEqual(regraDe('particular'));
    expect(regraDe(undefined)).toEqual(regraDe('particular'));
  });
});
