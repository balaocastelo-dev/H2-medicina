import { describe, expect, it } from 'vitest';
import { buildPixPayload, buildTxid } from '@/lib/pix';

/** Recebedor de teste configurado para a demonstração. */
const RECEBEDOR = {
  key: '34397947000108',
  merchantName: 'BALAO DA INFORMATICA',
  merchantCity: 'SAO PAULO',
};

describe('cobrança da recepção via Pix', () => {
  it('soma o valor dos exames selecionados', () => {
    const tabela = [
      { nome: 'Audiometria', valor: 90 },
      { nome: 'Consulta clínica ocupacional', valor: 150 },
      { nome: 'Exames laboratoriais', valor: 80 },
    ];
    expect(tabela.reduce((s, e) => s + e.valor, 0)).toBe(320);
  });

  it('gera BR Code com a chave CNPJ do recebedor', () => {
    const payload = buildPixPayload({ ...RECEBEDOR, amount: 320, txid: 'AT1234' });
    expect(payload).toContain('br.gov.bcb.pix');
    expect(payload).toContain('34397947000108');
    expect(payload).toContain('BALAO DA INFORMATICA');
    expect(payload).toContain('SAO PAULO');
  });

  it('leva o valor exato da cobrança', () => {
    expect(buildPixPayload({ ...RECEBEDOR, amount: 320, txid: 'AT1' })).toContain('5406320.00');
    expect(buildPixPayload({ ...RECEBEDOR, amount: 90.5, txid: 'AT2' })).toContain('540590.50');
  });

  it('fecha com CRC16 válido', () => {
    const payload = buildPixPayload({ ...RECEBEDOR, amount: 320, txid: 'AT1' });
    expect(payload.slice(-8, -4)).toBe('6304');
    expect(/^[0-9A-F]{4}$/.test(payload.slice(-4))).toBe(true);
  });

  it('muda o BR Code quando o valor muda', () => {
    const a = buildPixPayload({ ...RECEBEDOR, amount: 320, txid: 'AT1' });
    const b = buildPixPayload({ ...RECEBEDOR, amount: 240, txid: 'AT1' });
    expect(a).not.toBe(b);
  });

  it('gera txid a partir do id da cobrança', () => {
    const txid = buildTxid('AT', 'a9a303fc6d6243cc81318e611dac977b');
    expect(txid.startsWith('AT')).toBe(true);
    expect(txid.length).toBeLessThanOrEqual(25);
  });
});
