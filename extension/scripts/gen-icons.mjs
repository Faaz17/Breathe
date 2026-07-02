// Generates Breathe's toolbar icons as real PNGs — no image library needed.
// Mark: emerald rounded square (calm accent) with a soft white centre dot
// (the "breath / record" motif used across the extension UI).
//
// Run with: node scripts/gen-icons.mjs  (or: pnpm icons)

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 32, 48, 128];
const EMERALD = [16, 185, 129]; // emerald-500
const WHITE = [255, 255, 255];

const SAMPLES = 4; // supersampling per axis for anti-aliased edges

/** Signed distance from a point to a rounded rectangle centred at the origin. */
function roundedRectDistance(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius;
  const qy = Math.abs(py) - halfH + radius;
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  const outside = Math.hypot(outsideX, outsideY);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/** Coverage in [0,1] for a shape edge at signed distance `d` (negative = inside). */
function coverage(d) {
  return Math.min(Math.max(0.5 - d, 0), 1);
}

function renderRgba(size) {
  const data = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const halfSquare = size * 0.46;
  const cornerRadius = size * 0.24;
  const dotRadius = size * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let squareCoverage = 0;
      let dotCoverage = 0;

      // Supersample each pixel for smooth, calm edges.
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES - center;
          const py = y + (sy + 0.5) / SAMPLES - center;
          const sd = roundedRectDistance(px, py, halfSquare, halfSquare, cornerRadius);
          squareCoverage += coverage(sd);
          const dotSd = Math.hypot(px, py) - dotRadius;
          dotCoverage += coverage(dotSd);
        }
      }

      const total = SAMPLES * SAMPLES;
      const alpha = squareCoverage / total;
      const dotMix = dotCoverage / total;

      const r = Math.round(EMERALD[0] + (WHITE[0] - EMERALD[0]) * dotMix);
      const g = Math.round(EMERALD[1] + (WHITE[1] - EMERALD[1]) * dotMix);
      const b = Math.round(EMERALD[2] + (WHITE[2] - EMERALD[2]) * dotMix);

      const offset = (y * size + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }

  return data;
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlace) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepend a 0 (None) filter byte to each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, renderRgba(size));
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icons/icon-${size}.png (${png.length} bytes)`);
}
