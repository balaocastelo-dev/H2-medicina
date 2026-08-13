import { describe, expect, it } from 'vitest';
import {
  normalizar,
  normalizarPlanilha,
  paraDataISO,
  paraHora,
  sugerirMapeamento,
} from '@/modules/import/planilha';

describe('leitura de planilha de agendamentos', () => {
  describe('reconhecimento das colunas', () => {
    it('reconhece o cabeçalho do SISPER', () => {
      const mapa = sugerirMapeamento([
        'NOME DO SERVIDOR',
        'CPF',
        'DATA DA PERICIA',
        'HORARIO',
        'LOTACAO',
      ]);
      expect(mapa.nome).toBe('NOME DO SERVIDOR');
      expect(mapa.cpf).toBe('CPF');
      expect(mapa.data).toBe('DATA DA PERICIA');
      expect(mapa.hora).toBe('HORARIO');
      expect(mapa.setor).toBe('LOTACAO');
    });

    it('não usa a mesma coluna para dois campos', () => {
      const mapa = sugerirMapeamento(['Nome', 'Data', 'Data de nascimento']);
      const usados = Object.values(mapa);
      expect(new Set(usados).size).toBe(usados.length);
    });

    it('ignora acentos e maiúsculas do cabeçalho', () => {
      expect(normalizar('Matrícula Funcional')).toBe('matricula funcional');
      expect(sugerirMapeamento(['Matrícula']).matricula).toBe('Matrícula');
    });
  });

  describe('conversão de datas', () => {
    it('lê o formato brasileiro', () => {
      expect(paraDataISO('05/12/2026')).toBe('2026-12-05');
      expect(paraDataISO('5/1/2026')).toBe('2026-01-05');
    });

    it('lê o serial do Excel', () => {
      // 45000 corresponde a 15/03/2023 no calendário do Excel.
      expect(paraDataISO(45000)).toBe('2023-03-15');
    });

    it('aceita ISO e devolve nulo para lixo', () => {
      expect(paraDataISO('2026-08-13')).toBe('2026-08-13');
      expect(paraDataISO('a combinar')).toBeNull();
      expect(paraDataISO('')).toBeNull();
      expect(paraDataISO(null)).toBeNull();
    });

    it('resolve o ano de dois dígitos pelo corte de 50', () => {
      expect(paraDataISO('10/03/85')).toBe('1985-03-10');
      expect(paraDataISO('10/03/26')).toBe('2026-03-10');
    });
  });

  describe('conversão de horas', () => {
    it('aceita as formas que aparecem nas planilhas', () => {
      expect(paraHora('8')).toBe('08:00');
      expect(paraHora('8:30')).toBe('08:30');
      expect(paraHora('14h30')).toBe('14:30');
    });

    it('lê a fração de dia do Excel', () => {
      expect(paraHora(0.5)).toBe('12:00');
    });

    it('volta ao padrão quando a hora não faz sentido', () => {
      expect(paraHora('manhã')).toBe('08:00');
      expect(paraHora('99:99')).toBe('08:00');
      expect(paraHora(null, '07:30')).toBe('07:30');
    });
  });

  describe('normalização das linhas', () => {
    const mapeamento = { nome: 'NOME', cpf: 'CPF', data: 'DATA', hora: 'HORA' };

    it('monta o agendamento a partir de data e hora', () => {
      const [linha] = normalizarPlanilha({
        linhas: [{ NOME: 'Maria Silva', CPF: '390.533.447-05', DATA: '20/08/2026', HORA: '09:00' }],
        mapeamento,
        dataPadrao: null,
      });
      expect(linha?.nome).toBe('Maria Silva');
      expect(linha?.cpf).toBe('39053344705');
      expect(linha?.agendadoEm).toBe('2026-08-20T09:00:00');
      expect(linha?.erros).toEqual([]);
    });

    it('usa a data padrão quando a linha não traz data', () => {
      const [linha] = normalizarPlanilha({
        linhas: [{ NOME: 'João Souza', CPF: '', DATA: '', HORA: '' }],
        mapeamento,
        dataPadrao: '2026-09-01',
        horaPadrao: '07:30',
      });
      expect(linha?.agendadoEm).toBe('2026-09-01T07:30:00');
      expect(linha?.erros).toEqual([]);
    });

    it('marca a linha sem nome em vez de derrubar o lote', () => {
      const linhas = normalizarPlanilha({
        linhas: [{ NOME: '', DATA: '20/08/2026' }, { NOME: 'Ana Lima', DATA: '20/08/2026' }],
        mapeamento,
        dataPadrao: null,
      });
      expect(linhas[0]?.erros).toContain('nome ausente ou muito curto');
      expect(linhas[1]?.erros).toEqual([]);
    });

    it('reclama do CPF com contagem de dígitos errada', () => {
      const [linha] = normalizarPlanilha({
        linhas: [{ NOME: 'Carlos Dias', CPF: '123', DATA: '20/08/2026' }],
        mapeamento,
        dataPadrao: null,
      });
      expect(linha?.cpf).toBeNull();
      expect(linha?.erros).toContain('CPF com número de dígitos inválido');
    });

    it('aponta a linha sem data quando não há padrão', () => {
      const [linha] = normalizarPlanilha({
        linhas: [{ NOME: 'Paulo Reis', DATA: '' }],
        mapeamento,
        dataPadrao: null,
      });
      expect(linha?.erros).toContain('sem data de agendamento');
      expect(linha?.agendadoEm).toBeNull();
    });

    it('numera as linhas como a planilha faz, contando o cabeçalho', () => {
      const linhas = normalizarPlanilha({
        linhas: [{ NOME: 'A' }, { NOME: 'B' }],
        mapeamento,
        dataPadrao: '2026-09-01',
      });
      expect(linhas.map((l) => l.linha)).toEqual([2, 3]);
    });
  });
});
