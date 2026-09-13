import { describe, expect, it } from 'vitest';
import {
  cepFormatado,
  dataPorExtenso,
  diaEMes,
  linhaDoEndereco,
  montarComprovanteImpresso,
  montarComprovanteTexto,
  type DadosDoComprovante,
} from '@/modules/documents/comprovante-texto';

const CLINICA = {
  nome: 'H2 Medicina Ocupacional',
  logradouro: 'R. Sacramento',
  numero: '908',
  bairro: 'Vila Itapura',
  cidade: 'Campinas',
  uf: 'SP',
  cep: '13010210',
  referencia: 'Próximo ao Clube Fonte São Paulo',
  whatsapp: '(19) 99935-3599',
  telefone: '(19) 3235-3599',
};

const BASE: DadosDoComprovante = {
  paciente: 'Isabela Maragoni Menezes de Azevedo',
  data: '2026-08-24',
  hora: '08:00',
  tipoAtendimento: 'periodico',
  clinica: CLINICA,
};

describe('pedacos do texto', () => {
  it('dia e mes para o titulo', () => {
    expect(diaEMes('2026-08-24')).toBe('24/08');
  });

  it('data por extenso', () => {
    expect(dataPorExtenso('2026-08-24')).toBe('24/08/2026');
  });

  it('formata o CEP guardado so com digitos', () => {
    expect(cepFormatado('13010210')).toBe('13010-210');
    expect(cepFormatado('13010-210')).toBe('13010-210');
    expect(cepFormatado(null)).toBe('');
  });

  it('monta o endereco pulando o que falta', () => {
    expect(linhaDoEndereco(CLINICA)).toBe('R. Sacramento nº 908 – Vila Itapura – Campinas/SP');
    expect(linhaDoEndereco({ nome: 'X', cidade: 'Campinas', uf: 'SP' })).toBe('Campinas/SP');
  });
});

describe('montarComprovanteTexto', () => {
  const texto = montarComprovanteTexto(BASE);

  it('traz o titulo no formato da clinica', () => {
    expect(texto.startsWith('_*24/08* -  AGENDAMENTO EXAME PERIÓDICO – H2 MEDICINA OCUPACIONAL-')).toBe(
      true,
    );
  });

  it('traz o nome do paciente, a data e a hora', () => {
    expect(texto).toContain('Isabela Maragoni Menezes de Azevedo');
    expect(texto).toContain('⏰ Horário: 08:00');
    expect(texto).toContain('📅 Data: 24/08/2026');
  });

  it('mantem o aviso de ordem de chegada em destaque', () => {
    expect(texto).toContain('*Por ordem de chegada*');
  });

  it('traz endereco, CEP com referencia e os dois telefones', () => {
    expect(texto).toContain('📍 R. Sacramento nº 908 – Vila Itapura – Campinas/SP');
    expect(texto).toContain('📌 CEP: 13010-210 (Próximo ao Clube Fonte São Paulo)');
    expect(texto).toContain('📱 WhatsApp: (19) 99935-3599');
    expect(texto).toContain('☎️ Telefone: (19) 3235-3599');
  });

  it('troca o titulo conforme o tipo de atendimento', () => {
    expect(montarComprovanteTexto({ ...BASE, tipoAtendimento: 'admissional' })).toContain(
      'AGENDAMENTO EXAME ADMISSIONAL',
    );
    expect(montarComprovanteTexto({ ...BASE, tipoAtendimento: 'pericia' })).toContain(
      'AGENDAMENTO PERÍCIA',
    );
  });

  it('tipo desconhecido nao quebra o titulo', () => {
    expect(montarComprovanteTexto({ ...BASE, tipoAtendimento: null })).toContain(
      'AGENDAMENTO ATENDIMENTO',
    );
  });

  it('some com a linha inteira quando o dado nao existe', () => {
    const semTelefone = montarComprovanteTexto({
      ...BASE,
      clinica: { ...CLINICA, telefone: null, cep: null },
    });
    expect(semTelefone).not.toContain('Telefone:');
    expect(semTelefone).not.toContain('CEP:');
    expect(semTelefone).toContain('WhatsApp:');
  });

  it('nao repete o numero quando fixo e WhatsApp sao iguais', () => {
    const t = montarComprovanteTexto({
      ...BASE,
      clinica: { ...CLINICA, telefone: CLINICA.whatsapp },
    });
    expect(t.match(/99935-3599/g)).toHaveLength(1);
  });
});

describe('montarComprovanteImpresso', () => {
  const impresso = montarComprovanteImpresso(BASE);

  it('tira os emojis, que virariam quadradinho no PDF', () => {
    expect(impresso).not.toMatch(/[🏥📍📌⏰📅⚠️❗📱☎️]/u);
    expect(impresso).not.toContain('*');
  });

  it('mantem a informacao que importa', () => {
    expect(impresso).toContain('Isabela Maragoni Menezes de Azevedo');
    expect(impresso).toContain('Horário: 08:00');
    expect(impresso).toContain('Por ordem de chegada');
    expect(impresso).toContain('R. Sacramento');
  });

  it('nao deixa linha em branco triplicada', () => {
    expect(impresso).not.toContain('\n\n\n');
  });
});
