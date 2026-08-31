import { describe, expect, it } from 'vitest';
import { avaliarFichaClinica, emiteFichaClinica } from '@/modules/documents/ficha-clinica';

describe('quem tem direito a ficha clinica', () => {
  it('atendimento comum emite', () => {
    expect(
      emiteFichaClinica({
        origin_kind: 'particular',
        procedimentoEmiteFicha: true,
        empresaEmiteFicha: true,
      }),
    ).toBe(true);
  });

  it('emite quando nada foi informado', () => {
    // Atendimento antigo, anterior a escolha de procedimento na recepcao.
    expect(emiteFichaClinica({})).toBe(true);
  });

  it('nao emite em pericia ou junta medica', () => {
    const regra = avaliarFichaClinica({ origin_kind: 'particular', procedimentoEmiteFicha: false });
    expect(regra.emite).toBe(false);
    expect(regra.motivo).toContain('procedimento');
  });

  it('nao emite em atendimento SISPER', () => {
    const regra = avaliarFichaClinica({ origin_kind: 'sisper' });
    expect(regra.emite).toBe(false);
    expect(regra.motivo).toContain('SISPER');
  });

  it('nao emite para empresa que contratou so o A.S.O.', () => {
    const regra = avaliarFichaClinica({ origin_kind: 'particular', empresaEmiteFicha: false });
    expect(regra.emite).toBe(false);
    expect(regra.motivo).toContain('empresa');
  });

  it('estado e ingresso continuam emitindo', () => {
    // A clinica citou so o SISPER; as outras procedencias nao entram na regra.
    expect(emiteFichaClinica({ origin_kind: 'estado' })).toBe(true);
    expect(emiteFichaClinica({ origin_kind: 'ingresso' })).toBe(true);
  });

  it('o procedimento decide antes da empresa', () => {
    // Pericia numa empresa que emite ficha continua sem ficha, e a mensagem
    // aponta o motivo verdadeiro em vez de culpar a empresa.
    const regra = avaliarFichaClinica({
      origin_kind: 'particular',
      procedimentoEmiteFicha: false,
      empresaEmiteFicha: true,
    });
    expect(regra.motivo).toContain('procedimento');
  });

  it('quando emite, nao ha motivo a mostrar', () => {
    expect(avaliarFichaClinica({ origin_kind: 'particular' }).motivo).toBeNull();
  });
});
