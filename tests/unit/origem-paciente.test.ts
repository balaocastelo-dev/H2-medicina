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

    it('com exame marcado, o paciente do Estado faz o exame ANTES do médico', () => {
      // Esta afirmação dizia o contrário até 29/09, e estava errada — eu a
      // escrevi em 25/09 ao corrigir o SISPER e generalizei demais.
      //
      // Mandar direto ao consultório com exame pendente prendia o exame
      // para sempre: `call_next_for_room` só enxerga quem está em
      // 'aguardando_exames' ou 'em_exames'. Nenhuma sala podia chamá-lo, e
      // o paciente ia ao médico com o exame por fazer.
      //
      // Ir aos exames primeiro não perde a ida ao médico: ao concluir o
      // último exame, o gatilho olha a procedência e encaminha.
      expect(
        proximaEtapaDaRecepcao({ originKind: 'estado', needsTriage: false, temExames: true }),
      ).toBe('aguardando_exames');
    });

    it('sem exame marcado, o paciente do Estado vai direto ao consultório', () => {
      expect(
        proximaEtapaDaRecepcao({ originKind: 'estado', needsTriage: false, temExames: false }),
      ).toBe('aguardando_medico');
    });

    it('passa SISPER e ingresso pela triagem antes do médico', () => {
      for (const kind of ['sisper', 'ingresso'] as const) {
        expect(REGRAS[kind].needsTriage).toBe(true);
        expect(REGRAS[kind].afterTriage).toBe('medico');
        expect(proximaEtapaDaRecepcao({ originKind: kind, needsTriage: true, temExames: true })).toBe(
          'aguardando_triagem',
        );
        // Com exame marcado, a fila de exames vem primeiro — senão o exame
        // fica pendente e nenhuma sala consegue chamá-lo.
        expect(
          proximaEtapaDaRecepcao({ originKind: kind, needsTriage: false, temExames: true }),
        ).toBe('aguardando_exames');

        expect(
          proximaEtapaDaRecepcao({ originKind: kind, needsTriage: false, temExames: false }),
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

        // Com exame marcado o destino imediato é a fila de exames, e o
        // médico vem depois dela — não em vez dela.
        expect(
          proximaEtapaDaRecepcao({
            originKind: kind,
            needsTriage: false,
            temExames: true,
            temConsulta: false,
          }),
        ).toBe('aguardando_exames');
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
