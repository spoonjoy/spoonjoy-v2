// Deterministic stand-in photos for the synthetic kitchen: a diagonal two-colour gradient with a
// plate-like disc, coloured from a hash of the photo's key, encoded as a plain RGB PNG. The same key
// always gives the same bytes, and source apps accept it as a real image.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export const PHOTO_WIDTH = 160;
export const PHOTO_HEIGHT = 120;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function renderPhoto(key, { width = PHOTO_WIDTH, height = PHOTO_HEIGHT } = {}) {
  const hash = createHash("sha256").update(key).digest();
  const from = [hash[0], hash[1], hash[2]];
  const to = [hash[3], hash[4], hash[5]];
  const plate = [255 - (hash[6] >> 2), 250 - (hash[7] >> 3), 240 - (hash[8] >> 3)];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * (0.25 + (hash[9] / 255) * 0.15);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3); // filter byte 0: no filter
    for (let x = 0; x < width; x += 1) {
      const t = (x + y) / (width + height);
      const inPlate = (x - centerX) ** 2 + (y - centerY) ** 2 < radius ** 2;
      for (let channel = 0; channel < 3; channel += 1) {
        row[1 + x * 3 + channel] = inPlate
          ? plate[channel]
          : Math.round(from[channel] + (to[channel] - from[channel]) * t);
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
