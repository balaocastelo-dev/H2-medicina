import { describe, expect, it } from 'vitest';
import { buildPixPayload, buildTxid } from '@/lib/pix';

describe('BR Code (Pix copia e cola)', () => {
  const payload = buildPixPayload({
    key: 'chave@exemplo.com.br',
    merchantName: 'Clinica Exemplo',
    merchantCity: 'Sao Paulo',
    amount: 150.5,
    txid: 'CB123',
  });

  it('comeca com o payload format indicator', () => {
    expect(payload.startsWith('000201')).toBe(true);
  });

  it('inclui o dominio do arranjo Pix', () => {
    expect(payload).toContain('br.gov.bcb.pix');
  });

  it('inclui a moeda BRL (986) e o pais BR', () => {
    expect(payload).toContain('5303986');
    expect(payload).toContain('5802BR');
  });

  it('inclui o valor com duas casas', () => {
    expect(payload).toContain('5406150.50');
  });

  it('termina com CRC16 de 4 digitos hexadecimais', () => {
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(/^[0-9A-F]{4}$/.test(payload.slice(-4))).toBe(true);
  });

  it('gera txid alfanumerico limitado a 25 caracteres', () => {
    const txid = buildTxid('CB', 'abc-def-ghi-jkl-mno-pqr-stu-vwx');
    expect(txid.length).toBeLessThanOrEqual(25);
    expect(/^[A-Z0-9]+$/.test(txid)).toBe(true);
  });
});
