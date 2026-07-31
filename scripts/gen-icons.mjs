#!/usr/bin/env node
/**
 * Gera os icones PNG do PWA sem dependencia externa (encoder minimo).
 * Uso: node scripts/gen-icons.mjs "#0F766E"
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const color = process.argv[2] ?? '#0F766E';
const hex = color.replace('#', '');
const R = parseInt(hex.slice(0, 2), 16);
const G = parseInt(hex.slice(2, 4), 16);
const B = parseInt(hex.slice(4, 6), 16);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Quadrado arredondado com um "+" branco ao centro. */
function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.22;
  const barW = size * 0.12;
  const barL = size * 0.46;
  const c = size / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4;
      const dx = Math.max(r - x, 0, x - (size - r));
      const dy = Math.max(r - y, 0, y - (size - r));
      const inside = dx * dx + dy * dy <= r * r;
      const cross =
        (Math.abs(x - c) <= barW / 2 && Math.abs(y - c) <= barL / 2) ||
        (Math.abs(y - c) <= barW / 2 && Math.abs(x - c) <= barL / 2);
      if (!inside) {
        raw[i] = raw[i + 1] = raw[i + 2] = raw[i + 3] = 0;
      } else if (cross) {
        raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255; raw[i + 3] = 255;
      } else {
        raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512, 180]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size));
  console.log(`public/icons/icon-${size}.png`);
}
