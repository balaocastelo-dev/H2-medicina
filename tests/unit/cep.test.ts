import { describe, expect, it } from 'vitest';
import { cepCompleto, formatarCep, lerRespostaCep, limparCep } from '@/modules/patients/cep';

describe('limparCep', () => {
  it('tira mascara e corta o excesso', () => {
    expect(limparCep('01310-100')).toBe('01310100');
    expect(limparCep('01.310-100xyz')).toBe('01310100');
    expect(limparCep('013101009999')).toBe('01310100');
  });

  it('aguenta entrada vazia', () => {
    expect(limparCep('')).toBe('');
  });
});

describe('cepCompleto', () => {
  it('so aceita oito digitos', () => {
    expect(cepCompleto('0131010')).toBe(false);
    expect(cepCompleto('01310100')).toBe(true);
    expect(cepCompleto('01310-100')).toBe(true);
  });
});

describe('formatarCep', () => {
  it('poe o traco depois do quinto digito', () => {
    expect(formatarCep('01310100')).toBe('01310-100');
    expect(formatarCep('013')).toBe('013');
    expect(formatarCep('01310')).toBe('01310');
  });
});

describe('lerRespostaCep', () => {
  it('traduz a resposta do servico', () => {
    expect(
      lerRespostaCep({
        logradouro: 'Avenida Paulista',
        bairro: 'Bela Vista',
        localidade: 'São Paulo',
        uf: 'sp',
      }),
    ).toEqual({
      logradouro: 'Avenida Paulista',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
    });
  });

  it('recusa CEP inexistente, que volta com erro e status 200', () => {
    expect(lerRespostaCep({ erro: true })).toBeNull();
    expect(lerRespostaCep({ erro: 'true' })).toBeNull();
  });

  it('recusa resposta vazia ou de outro formato', () => {
    expect(lerRespostaCep(null)).toBeNull();
    expect(lerRespostaCep('nada')).toBeNull();
    expect(lerRespostaCep({})).toBeNull();
  });

  it('aceita CEP de cidade sem logradouro definido', () => {
    const r = lerRespostaCep({ logradouro: '', bairro: '', localidade: 'Campinas', uf: 'SP' });
    expect(r).toEqual({ logradouro: '', bairro: '', cidade: 'Campinas', uf: 'SP' });
  });
});
