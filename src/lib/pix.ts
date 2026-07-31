/**
 * Gerador de BR Code (Pix copia e cola) — EMV MPM, padrao Banco Central.
 * Nao depende de gateway: funciona com a chave Pix cadastrada no painel.
 */

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitize(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, '')
    .toUpperCase()
    .slice(0, maxLength)
    .trim();
}

export interface PixPayloadInput {
  key: string;
  merchantName: string;
  merchantCity: string;
  amount: number;
  txid: string;
  description?: string;
}

export function buildPixPayload(input: PixPayloadInput): string {
  const merchantAccount =
    tlv('00', 'br.gov.bcb.pix') +
    tlv('01', input.key) +
    (input.description ? tlv('02', sanitize(input.description, 72)) : '');

  const txid = sanitize(input.txid, 25).replace(/\s/g, '') || '***';

  const payload =
    tlv('00', '01') +
    tlv('26', merchantAccount) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', input.amount.toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', sanitize(input.merchantName, 25) || 'RECEBEDOR') +
    tlv('60', sanitize(input.merchantCity, 15) || 'SAO PAULO') +
    tlv('62', tlv('05', txid)) +
    '6304';

  return payload + crc16(payload);
}

/** TXID unico e estavel por cobranca (apenas alfanumericos). */
export function buildTxid(prefix: string, reference: string): string {
  return `${prefix}${reference}`
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 25)
    .toUpperCase();
}
