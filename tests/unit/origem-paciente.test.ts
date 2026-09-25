import { describe, expect, it } from 'vitest';
import {
  ORIGIN_KINDS,
  REGRAS,
  isOriginKind,
  proximaEtapaDaRecepcao,
  regraDe,
  VAI_AO_MEDICO,
} from '@/modules/queue/origin-kind';

describe('procedência do paciente', () => {
  it('tem uma letra distinta para cada procedência', () => {
    const letras = ORIGIN_KINDS.map((k) => REGRAS[k].letter);
    // 'E' de Estado virou 'PR' de Pericia a pedido da clinica (15/09).
    expect(letras).toEqual(['P', 'PR', 'S', 'I']);
    expect(new Set(letras).size).toBe(4);
  });

  it('cai no particular quando a procedência é desconhecida', () => {
    expect(regraDe(null).code).toBe('particular');
    expect(regraDe('inventado').code).toBe('particular');
    expect(regraDe('sisper').code).toBe('sisper');
  });

  it('reconhece apenas as quatro procedências válidas', () => {
    expect(isOriginKind('estado')).toBe(true);
    expect(isOriginKind('ESTADO')).toBe(false);
    expect(isOriginKind(42)).toBe(false);
  });

  describe('encaminhamento a partir da recepção', () => {
    it('manda o particular para a triagem e depois para os exames', () => {
      expect(REGRAS.particular.needsTriage).toBe(true);
      expect(
        proximaEtapaDaRecepcao({
          originKind: 'particular',
          needsTriage: true,
          temExames: true,
        }),
      ).toBe('aguardando_triagem');
      expect(
        proximaEtapaDaRecepcao({
          originKind: 'particular',
          needsTriage: false,
          temExames: true,
        }),
      ).toBe('aguardando_exames');
    });

    it('leva o paciente do Estado direto ao médico, sem triagem', () => {
      expect(REGRAS.estado.needsTriage).toBe(false);
      expect(
        proximaEtapaDaRecepcao({ originKind: 'estado', needsTriage: false, temExames: false }),
      ).toBe('aguardando_medico');
    });

    it('não desvia o paciente do Estado para a fila de exames', () => {
      // Mesmo com exame marcado, o destino continua sendo o consultório:
      // a fila de exames não é o caminho dele.
      expect(
        proximaEtapaDaRecepcao({ originKind: 'estado', needsTriage: false, temExames: true }),
      ).toBe('aguardando_medico');
    });

    it('passa SISPER e ingresso pela triagem antes do médico', () => {
      for (const kind of ['sisper', 'ingresso'] as const) {
        expect(REGRAS[kind].needsTriage).toBe(true);
        expect(REGRAS[kind].afterTriage).toBe('medico');
        expect(proximaEtapaDaRecepcao({ originKind: kind, needsTriage: true, temExames: true })).toBe(
          'aguardando_triagem',
        );
        expect(
          proximaEtapaDaRecepcao({ originKind: kind, needsTriage: false, temExames: true }),
        ).toBe('aguardando_medico');
      }
    });

    it('perícia, SISPER e ingresso vão ao médico mesmo sem consulta marcada', () => {
      // "os pacientes que eu categorizo como sisper ao clicar em encaminhar
      //  para o medico vao direto para a aba pagamentos" — Isabella, 24/09.
      //
      // A regra da consulta marcada existe para o particular. Para estas
      // três procedências a avaliação médica é o motivo da visita, e ela
      // não é cobrada como exame: não há o que marcar na recepção.
      for (const kind of ['estado', 'sisper', 'ingresso'] as const) {
        expect(
          proximaEtapaDaRecepcao({
            originKind: kind,
            needsTriage: false,
            temExames: false,
            temConsulta: false,
          }),
        ).toBe('aguardando_medico');

        expect(
          proximaEtapaDaRecepcao({
            originKind: kind,
            needsTriage: false,
            temExames: true,
            temConsulta: false,
          }),
        ).toBe('aguardando_medico');
      }
    });

    it('o particular sem consulta marcada continua indo ao pagamento', () => {
      // A regra de 17/09 não pode ter sido desfeita: quem veio só fazer um
      // eletroencefalograma termina e vai embora.
      expect(
        proximaEtapaDaRecepcao({
          originKind: 'particular',
          needsTriage: false,
          temExames: false,
          temConsulta: false,
        }),
      ).toBe('aguardando_pagamento');

      expect(
        proximaEtapaDaRecepcao({
          originKind: 'particular',
          needsTriage: false,
          temExames: true,
          temConsulta: false,
        }),
      ).toBe('aguardando_exames');
    });

    it('a lista do banco e a da aplicação são a mesma', () => {
      // O gatilho do banco repete este critério. Se alguém mudar uma
      // procedência de lado, as duas mudam juntas.
      expect([...VAI_AO_MEDICO].sort()).toEqual(['estado', 'ingresso', 'sisper']);
    });

    it('não deixa ninguém parado na fila quando não há exame nenhum', () => {
      // Sem exame para concluir, nada dispararia a etapa seguinte —
      // o paciente ficaria esperando uma chamada que nunca viria.
      expect(
        proximaEtapaDaRecepcao({
          originKind: 'particular',
          needsTriage: false,
          temExames: false,
        }),
      ).toBe('aguardando_medico');
    });
  });

  it('exige o termo de autorização somente do particular', () => {
    expect(REGRAS.particular.requiresAuthorization).toBe(true);
    expect(REGRAS.estado.requiresAuthorization).toBe(false);
    expect(REGRAS.sisper.requiresAuthorization).toBe(false);
    expect(REGRAS.ingresso.requiresAuthorization).toBe(false);
  });

  it('cobra apenas o particular — os demais são custeados pelo órgão de origem', () => {
    expect(REGRAS.particular.requiresPayment).toBe(true);
    expect(ORIGIN_KINDS.filter((k) => REGRAS[k].requiresPayment)).toEqual(['particular']);
  });

  it('marca ficha completa apenas no ingresso escolar', () => {
    expect(REGRAS.ingresso.fichaCompleta).toBe(true);
    expect(ORIGIN_KINDS.filter((k) => REGRAS[k].fichaCompleta)).toEqual(['ingresso']);
  });
});
