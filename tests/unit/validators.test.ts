import { describe, expect, it } from 'vitest';
import { isValidCPF, isValidCNPJ, patientSchema, companySchema } from '@/lib/validators';

describe('validacao de documentos', () => {
  it('aceita CPF valido', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('52998224725')).toBe(true);
  });

  it('rejeita CPF invalido, repetido ou incompleto', () => {
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('529.982.247-26')).toBe(false);
    expect(isValidCPF('123')).toBe(false);
    expect(isValidCPF(null)).toBe(false);
  });

  it('aceita CNPJ valido', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
  });

  it('rejeita CNPJ invalido', () => {
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
    expect(isValidCNPJ('00000000000000')).toBe(false);
  });
});

describe('schema de paciente', () => {
  it('exige nome completo', () => {
    const result = patientSchema.safeParse({ full_name: 'Jo' });
    expect(result.success).toBe(false);
  });

  it('normaliza CPF para digitos', () => {
    const result = patientSchema.safeParse({
      full_name: 'Maria da Silva',
      cpf: '529.982.247-25',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cpf).toBe('52998224725');
  });

  it('rejeita CPF invalido', () => {
    const result = patientSchema.safeParse({ full_name: 'Maria', cpf: '11111111111' });
    expect(result.success).toBe(false);
  });
});

describe('schema de empresa', () => {
  it('exige razao social', () => {
    expect(companySchema.safeParse({ legal_name: 'X' }).success).toBe(false);
  });

  it('aceita empresa sem CNPJ', () => {
    const result = companySchema.safeParse({ legal_name: 'Empresa Teste Ltda' });
    expect(result.success).toBe(true);
  });
});
