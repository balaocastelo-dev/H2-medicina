import { describe, expect, it } from 'vitest';
import {
  diasAteVencer,
  paragrafosDoContrato,
  situacaoDoContrato,
} from '@/modules/companies/contract-template';
import { dataPorExtenso, paragrafosDoTermo } from '@/modules/documents/authorization';

describe('controle de contratos', () => {
  describe('alerta de vencimento', () => {
    const hoje = new Date(2026, 7, 13); // 13/08/2026

    it('conta os dias que faltam', () => {
      expect(diasAteVencer('2026-08-20', hoje)).toBe(7);
      expect(diasAteVencer('2026-08-13', hoje)).toBe(0);
    });

    it('devolve negativo para contrato vencido', () => {
      expect(diasAteVencer('2026-08-01', hoje)).toBe(-12);
    });

    it('não inventa prazo quando não há data', () => {
      expect(diasAteVencer(null, hoje)).toBeNull();
    });

    it('usa os mesmos cortes da cláusula de convocação: 60 e 30 dias', () => {
      expect(situacaoDoContrato(-1)).toBe('vencido');
      expect(situacaoDoContrato(0)).toBe('critico');
      expect(situacaoDoContrato(30)).toBe('critico');
      expect(situacaoDoContrato(31)).toBe('atencao');
      expect(situacaoDoContrato(60)).toBe('atencao');
      expect(situacaoDoContrato(61)).toBe('em_dia');
      expect(situacaoDoContrato(null)).toBe('sem_prazo');
    });
  });

  describe('contrato em PDF', () => {
    const base = {
      contratanteRazaoSocial: 'Metalúrgica Aurora Ltda',
      contratanteCnpj: '11.222.333/0001-81',
      contratanteEndereco: 'Rua A, 100, Campinas, SP',
      contratanteResponsavel: 'Joana Prado',
      contratadaRazaoSocial: 'H2 Medicina Ocupacional Ltda',
      contratadaCnpj: '52.830.198/0001-34',
      contratadaEndereco: 'Rua Sacramento, 908, Campinas',
      contratadaRepresentante: 'Wania Sanches Picasso',
      coordenadorNome: 'Heloisa de Souza Neves',
      coordenadorCrm: 'CRM-SP 155394',
      numeroFuncionarios: 42,
      valorMensal: 315,
      valorTotal: 3780,
      diaVencimento: 10,
      indiceReajuste: 'IGP-M',
      multaAtraso: 2,
      jurosAtraso: 1,
      horaTecnica: 200,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: '2026-12-31',
      renovacaoAutomatica: true,
      esocialAtivo: true,
      emailAgendamento: 'agenda@h2.com.br',
      emailFinanceiro: 'financeiro@h2.com.br',
      itens: [
        {
          kind: 'exame',
          name: 'Audiometria',
          quantity_included: 12,
          unit_price: 45,
          extra_price: 60,
        },
      ],
      cidade: 'Campinas',
      dataEmissao: new Date(2026, 7, 13),
    };

    it('traz os valores do cadastro no corpo do contrato', () => {
      const texto = paragrafosDoContrato(base).join('\n');
      expect(texto).toContain('Metalúrgica Aurora Ltda');
      expect(texto).toContain('42');
      expect(texto).toContain('R$ 315,00');
      expect(texto).toContain('Audiometria');
      expect(texto).toContain('excedente R$ 60,00');
      expect(texto).toContain('todo dia 10');
      expect(texto).toContain('31/12/2026');
    });

    it('troca a cláusula do e-Social conforme a contratação', () => {
      const com = paragrafosDoContrato(base).join('\n');
      const sem = paragrafosDoContrato({ ...base, esocialAtivo: false }).join('\n');
      expect(com).toContain('procuração eletrônica');
      expect(sem).toContain('não está incluído neste contrato');
    });

    it('deixa lacuna visível em vez de frase truncada', () => {
      const texto = paragrafosDoContrato({
        ...base,
        contratanteCnpj: null,
        numeroFuncionarios: null,
        valorMensal: null,
      }).join('\n');
      expect(texto).toContain('____');
      expect(texto).toContain('Metalúrgica Aurora Ltda');
    });

    it('avisa quando não há item de cota cadastrado', () => {
      const texto = paragrafosDoContrato({ ...base, itens: [] }).join('\n');
      expect(texto).toContain('nenhum exame cadastrado neste contrato');
    });
  });
});

describe('termo de autorização de envio de resultados', () => {
  const base = {
    pacienteNome: 'Maria Silva',
    pacienteRg: '12.345.678-9',
    pacienteCpf: '390.533.447-05',
    empresaNome: 'Metalúrgica Aurora',
    coordenadorNome: 'Heloisa de Souza Neves',
    coordenadorConselho: 'CRM-SP 155394',
    clinicaRazaoSocial: 'H2 Medicina Ocupacional Ltda',
    cidade: 'Campinas',
    data: new Date(2026, 7, 13),
  };

  it('cita os artigos que sustentam a entrega do prontuário', () => {
    const texto = paragrafosDoTermo(base).join('\n');
    expect(texto).toContain('Art. 85.');
    expect(texto).toContain('Art. 89.');
    expect(texto).toContain('§ 3º');
  });

  it('preenche paciente, empresa e coordenador', () => {
    const texto = paragrafosDoTermo(base).join('\n');
    expect(texto).toContain('Maria Silva');
    expect(texto).toContain('Metalúrgica Aurora');
    expect(texto).toContain('CRM-SP 155394');
    expect(texto).toContain('H2 Medicina Ocupacional Ltda');
  });

  it('deixa linha para preencher a mão quando falta dado', () => {
    const texto = paragrafosDoTermo({ ...base, pacienteRg: null, empresaNome: null }).join('\n');
    expect(texto).toContain('_____');
    expect(texto).toContain('AUTORIZO');
  });

  it('escreve a data por extenso com a cidade', () => {
    expect(dataPorExtenso(new Date(2026, 7, 13), 'Campinas')).toBe('Campinas, 13 de agosto de 2026');
    expect(dataPorExtenso(new Date(2026, 0, 1), null)).toBe('1 de janeiro de 2026');
  });
});
