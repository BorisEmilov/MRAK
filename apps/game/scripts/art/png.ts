/**
 * Minimal PNG codec for the build scripts: 8-bit RGBA/RGB (and greyscale) non-interlaced images,
 * which is what our art tools and the atlas packer write. No dependencies beyond node:zlib.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface Rgba {
  width: number;
  height: number;
  /** width × height × 4 bytes, row-major RGBA. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function createImage(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function encodePng(image: Rgba): Buffer {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buffer: Buffer): Rgba {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colorType = body[9] ?? 0;
      if (depth !== 8) throw new Error(`unsupported PNG bit depth ${String(depth)}`);
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${String(colorType)}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] ?? 0;
      const a = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      const pred =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? (a + b) >> 1
                : paeth(a, b, c);
      pixels[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const out = createImage(width, height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const p = i * channels;
    if (colorType === 6) out.data.set(pixels.subarray(p, p + 4), o);
    else if (colorType === 2) {
      out.data.set(pixels.subarray(p, p + 3), o);
      out.data[o + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      const g = pixels[p] ?? 0;
      out.data.set([g, g, g, colorType === 4 ? (pixels[p + 1] ?? 255) : 255], o);
    } else {
      const index = pixels[p] ?? 0;
      out.data.set(
        [
          palette?.[index * 3] ?? 0,
          palette?.[index * 3 + 1] ?? 0,
          palette?.[index * 3 + 2] ?? 0,
          transparency?.[index] ?? 255,
        ],
        o,
      );
    }
  }
  return out;
}
