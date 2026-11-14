// Простой декодер PNG без цветокоррекции: байты пикселей ровно как в файле.
// Нужен для height.png, где высоты закодированы в R и G и любая гамма их испортит.

export interface DecodedPng {
  width: number;
  height: number;
  /** Каналов на пиксель в data: 1 (серый), 2 (серый+альфа), 3 (RGB), 4 (RGBA). */
  channels: number;
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Распаковка zlib (IDAT в PNG — это zlib, то есть формат 'deflate' у DecompressionStream). */
export async function inflateZlib(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export async function decodePng(buffer: ArrayBuffer | Uint8Array): Promise<DecodedPng> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('Файл не PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      bitDepth = bytes[pos + 16];
      colorType = bytes[pos + 17];
      interlace = bytes[pos + 20];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`PNG: поддерживается только 8 бит на канал, а не ${bitDepth}`);
  if (interlace !== 0) throw new Error('PNG: чересстрочный формат не поддерживается');
  const srcChannels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!srcChannels) throw new Error(`PNG: неизвестный тип цвета ${colorType}`);

  const total = idat.reduce((s, c) => s + c.length, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  for (const c of idat) {
    joined.set(c, off);
    off += c.length;
  }
  const raw = await inflateZlib(joined);

  const stride = width * srcChannels;
  const bpp = srcChannels;
  const out = new Uint8Array(stride * height);
  for (let r = 0; r < height; r++) {
    const filter = raw[r * (stride + 1)];
    const src = r * (stride + 1) + 1;
    const dst = r * stride;
    const prev = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[prev + i] : 0;
      const c = r > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`PNG: неизвестный фильтр ${filter}`);
      }
      out[dst + i] = v & 0xff;
    }
  }

  if (colorType === 3) {
    if (!palette) throw new Error('PNG: нет палитры');
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const p = out[i] * 3;
      rgb[i * 3] = palette[p];
      rgb[i * 3 + 1] = palette[p + 1];
      rgb[i * 3 + 2] = palette[p + 2];
    }
    return { width, height, channels: 3, data: rgb };
  }
  return { width, height, channels: srcChannels, data: out };
}
