import { describe, expect, it } from 'vitest';
import {
  acharCEP,
  acharCPF,
  acharCNPJ,
  acharDatas,
  acharTelefone,
  classificarDatas,
  detectarFormato,
  dividirRegistros,
  extrairRegistro,
  lerTextoColado,
  tituloDeNome,
} from '@/modules/import/texto-livre';

// CPFs validos gerados so para teste.
const CPF_A = '52998224725';
const CPF_B = '11144477735';
const HOJE = new Date('2026-08-19T12:00:00-03:00');

describe('acharCPF', () => {
  it('encontra com e sem mascara', () => {
    expect(acharCPF('CPF 529.982.247-25')).toBe(CPF_A);
    expect(acharCPF('cpf52998224725fim')).toBe(CPF_A);
    expect(acharCPF('529 982 247 25')).toBe(CPF_A);
  });

  it('recusa numero de 11 digitos que nao e CPF', () => {
    expect(acharCPF('11111111111')).toBeNull();
    expect(acharCPF('12345678900')).toBeNull();
  });

  it('nao confunde telefone com CPF', () => {
    expect(acharCPF('(11) 98765-4321')).toBeNull();
  });

  it('devolve null sem candidato', () => {
    expect(acharCPF('nenhum numero aqui')).toBeNull();
  });
});

describe('acharCNPJ', () => {
  it('encontra e valida', () => {
    expect(acharCNPJ('CNPJ 52.830.198/0001-34')).toBe('52830198000134');
    expect(acharCNPJ('11.111.111/1111-11')).toBeNull();
  });
});

describe('acharTelefone e acharCEP', () => {
  it('le telefone fixo e celular', () => {
    expect(acharTelefone('(11) 98765-4321')).toBe('11987654321');
    expect(acharTelefone('11 3456-7890')).toBe('1134567890');
  });

  it('le CEP com e sem traco', () => {
    expect(acharCEP('CEP 01310-100')).toBe('01310100');
    expect(acharCEP('01310100')).toBe('01310100');
  });
});

describe('acharDatas', () => {
  it('aceita barra, ponto e ISO', () => {
    expect(acharDatas('10/03/1990')).toContain('1990-03-10');
    expect(acharDatas('nasceu em 10.03.1990')).toContain('1990-03-10');
    expect(acharDatas('1990-03-10')).toContain('1990-03-10');
  });
});

describe('classificarDatas', () => {
  it('separa nascimento de agendamento pela idade', () => {
    const reg = extrairRegistro('vazio', HOJE);
    reg.nascimento = null;
    reg.data = null;
    classificarDatas(['1990-03-10', '2026-08-20'], reg, HOJE);
    expect(reg.nascimento).toBe('1990-03-10');
    expect(reg.data).toBe('2026-08-20');
  });
});

describe('tituloDeNome', () => {
  it('arruma caixa alta mantendo preposicao minuscula', () => {
    expect(tituloDeNome('MARIA DA SILVA SANTOS')).toBe('Maria da Silva Santos');
    expect(tituloDeNome('joao dos santos')).toBe('Joao dos Santos');
  });
});

describe('detectarFormato', () => {
  it('reconhece tabela com tabulacao e cabecalho', () => {
    const texto = `Nome\tCPF\tEmpresa\nMaria da Silva\t529.982.247-25\tIndustria Modelo`;
    const det = detectarFormato(texto);
    expect(det.formato).toBe('tabela');
    expect(det.delimitador).toBe('\t');
    expect(det.temCabecalho).toBe(true);
  });

  it('reconhece tabela sem cabecalho', () => {
    const texto = `Maria da Silva;529.982.247-25\nJoao Souza;111.444.777-35`;
    const det = detectarFormato(texto);
    expect(det.formato).toBe('tabela');
    expect(det.temCabecalho).toBe(false);
  });

  it('reconhece blocos separados por linha em branco', () => {
    const texto = `Nome: Maria\nCPF: 529.982.247-25\n\nNome: Joao\nCPF: 111.444.777-35`;
    expect(detectarFormato(texto).formato).toBe('blocos');
  });

  it('reconhece uma pessoa por linha', () => {
    const texto = `Maria da Silva 529.982.247-25\nJoao Souza 111.444.777-35`;
    expect(detectarFormato(texto).formato).toBe('linhas');
  });

  it('texto solto vira registro unico', () => {
    expect(detectarFormato('Maria da Silva, CPF 529.982.247-25').formato).toBe('unico');
  });
});

describe('dividirRegistros', () => {
  it('usa o CPF como ancora no texto corrido', () => {
    const texto = [
      'Maria da Silva',
      'CPF 529.982.247-25',
      'Rua das Flores, 100',
      'Joao Souza',
      'CPF 111.444.777-35',
    ].join('\n');
    expect(dividirRegistros(texto)).toHaveLength(2);
  });
});

describe('extrairRegistro em formato rotulado', () => {
  const bloco = [
    'Nome: MARIA DA SILVA SANTOS',
    'CPF: 529.982.247-25',
    'RG: 12.345.678-9',
    'Data de nascimento: 10/03/1990',
    'Sexo: Feminino',
    'Telefone: (11) 98765-4321',
    'E-mail: maria@exemplo.com',
    'Endereco: Rua das Flores, 100 - Centro - São Paulo/SP',
    'CEP: 01310-100',
    'Empresa: Industria Modelo LTDA',
    'CNPJ: 52.830.198/0001-34',
    'Profissao: Operadora de máquinas',
    'Setor: Produção',
    'Matricula: 45678',
  ].join('\n');

  const reg = extrairRegistro(bloco, HOJE);

  it('le a identificacao', () => {
    expect(reg.nome).toBe('Maria da Silva Santos');
    expect(reg.cpf).toBe(CPF_A);
    expect(reg.rg).toBe('12.345.678-9');
    expect(reg.nascimento).toBe('1990-03-10');
    expect(reg.sexo).toBe('feminino');
  });

  it('le contato e endereco', () => {
    expect(reg.telefone).toBe('11987654321');
    expect(reg.email).toBe('maria@exemplo.com');
    expect(reg.cep).toBe('01310100');
    expect(reg.logradouro).toBe('Rua das Flores');
    expect(reg.numero).toBe('100');
    expect(reg.bairro).toBe('Centro');
    expect(reg.cidade).toBe('São Paulo');
    expect(reg.uf).toBe('SP');
  });

  it('le vinculo de trabalho', () => {
    expect(reg.empresa).toBe('Industria Modelo LTDA');
    expect(reg.cnpjEmpresa).toBe('52830198000134');
    expect(reg.cargo).toBe('Operadora de máquinas');
    expect(reg.setor).toBe('Produção');
    expect(reg.matricula).toBe('45678');
  });

  it('nao gera aviso quando leu nome e CPF', () => {
    expect(reg.avisos).toEqual([]);
  });
});

describe('extrairRegistro sem rotulo', () => {
  it('acha nome, CPF e endereco em texto solto', () => {
    const reg = extrairRegistro(
      'MARIA DA SILVA SANTOS\n529.982.247-25\nRua das Flores, 100 - Centro - São Paulo/SP',
      HOJE,
    );
    expect(reg.nome).toBe('Maria da Silva Santos');
    expect(reg.cpf).toBe(CPF_A);
    expect(reg.logradouro).toBe('Rua das Flores');
    expect(reg.cidade).toBe('São Paulo');
  });

  it('nao confunde nome de empresa com nome de pessoa', () => {
    const reg = extrairRegistro('Industria Modelo LTDA\nMaria da Silva\n529.982.247-25', HOJE);
    expect(reg.nome).toBe('Maria da Silva');
    expect(reg.empresa).toBe('Industria Modelo LTDA');
  });

  it('avisa quando falta CPF', () => {
    const reg = extrairRegistro('Maria da Silva', HOJE);
    expect(reg.avisos).toContain('CPF não identificado ou inválido');
  });
});

describe('lerTextoColado', () => {
  it('le tabela colada de planilha', () => {
    const texto = [
      'Nome\tCPF\tNascimento\tEmpresa\tCargo',
      'MARIA DA SILVA\t529.982.247-25\t10/03/1990\tIndustria Modelo LTDA\tOperadora',
      'JOAO SOUZA\t111.444.777-35\t22/07/1985\tIndustria Modelo LTDA\tMecanico',
    ].join('\n');

    const r = lerTextoColado(texto, HOJE);
    expect(r.formato).toBe('tabela');
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]?.nome).toBe('Maria da Silva');
    expect(r.registros[0]?.cargo).toBe('Operadora');
    expect(r.registros[1]?.cpf).toBe(CPF_B);
    expect(r.comAviso).toBe(0);
  });

  it('le blocos rotulados', () => {
    const texto = [
      'Nome: Maria da Silva',
      'CPF: 529.982.247-25',
      '',
      'Nome: Joao Souza',
      'CPF: 111.444.777-35',
    ].join('\n');

    const r = lerTextoColado(texto, HOJE);
    expect(r.formato).toBe('blocos');
    expect(r.registros).toHaveLength(2);
  });

  it('le lista de uma pessoa por linha', () => {
    const texto = 'Maria da Silva 529.982.247-25\nJoao Souza 111.444.777-35';
    const r = lerTextoColado(texto, HOJE);
    expect(r.registros).toHaveLength(2);
    expect(r.registros[1]?.nome).toBe('Joao Souza');
  });

  it('le varios rotulos na mesma linha', () => {
    const r = lerTextoColado('Nome: Maria da Silva  CPF: 529.982.247-25  Cargo: Auxiliar', HOJE);
    expect(r.registros[0]?.nome).toBe('Maria da Silva');
    expect(r.registros[0]?.cargo).toBe('Auxiliar');
  });

  it('descarta trecho que nao rendeu nome nem CPF', () => {
    const r = lerTextoColado('=== RELATORIO ===\n\nMaria da Silva\n529.982.247-25', HOJE);
    expect(r.registros).toHaveLength(1);
  });

  it('devolve vazio sem quebrar com entrada inutil', () => {
    expect(lerTextoColado('').registros).toEqual([]);
    expect(lerTextoColado('   \n  \n ').registros).toEqual([]);
    expect(lerTextoColado('%%%$$$###').registros).toEqual([]);
  });

  it('conta os registros com aviso', () => {
    const texto = 'Nome: Maria da Silva\nCPF: 529.982.247-25\n\nNome: Sem Documento Aqui';
    const r = lerTextoColado(texto, HOJE);
    expect(r.registros).toHaveLength(2);
    expect(r.comAviso).toBe(1);
  });
});
