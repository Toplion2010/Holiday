// Сетка высот DTM: декодирование height.png и билинейная выборка. NoData — NaN.

export interface HeightGrid {
  width: number;
  height: number;
  /** Высоты, м относительно ареоида, построчно с севера; NaN — нет данных. */
  data: Float32Array;
  /** Код источника высоты из канала B (0 — основной DTM); нет канала — undefined. */
  source?: Uint8Array;
}

/** units = (R<<8)|G; height = base + (units-1)*step; units = 0 → NoData. */
export function decodeHeightUnits(r: number, g: number, baseM: number, stepM: number): number {
  const units = (r << 8) | g;
  return units === 0 ? NaN : baseM + (units - 1) * stepM;
}

export function decodeHeights(
  pixels: ArrayLike<number>,
  channels: number,
  width: number,
  height: number,
  baseM: number,
  stepM: number,
): HeightGrid {
  if (channels < 2) throw new Error('Для высот нужны каналы R и G');
  const data = new Float32Array(width * height);
  const source = channels >= 3 ? new Uint8Array(width * height) : undefined;
  for (let i = 0; i < width * height; i++) {
    data[i] = decodeHeightUnits(pixels[i * channels], pixels[i * channels + 1], baseM, stepM);
    if (source) source[i] = pixels[i * channels + 2];
  }
  return { width, height, data, source };
}

/** Код источника высоты в ближайшем пикселе; вне сетки или без канала — 0. */
export function sourceCode(grid: HeightGrid, col: number, row: number): number {
  if (!grid.source) return 0;
  const c = Math.round(col);
  const r = Math.round(row);
  if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) return 0;
  return grid.source[r * grid.width + c];
}

export function gridValue(grid: HeightGrid, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return NaN;
  return grid.data[row * grid.width + col];
}

/**
 * Билинейная выборка; col/row — дробные индексы центров пикселей.
 * Вне сетки или если хоть один из четырёх соседей NoData — NaN (пустоту не выдумываем).
 */
export function sampleBilinear(grid: HeightGrid, col: number, row: number): number {
  const { width: w, height: h } = grid;
  if (!(col >= 0 && row >= 0 && col <= w - 1 && row <= h - 1)) return NaN;
  const c0 = Math.min(Math.floor(col), w - 2);
  const r0 = Math.min(Math.floor(row), h - 2);
  const fc = col - c0;
  const fr = row - r0;
  const i = r0 * w + c0;
  const d = grid.data;
  const top = d[i] * (1 - fc) + d[i + 1] * fc;
  const bottom = d[i + w] * (1 - fc) + d[i + w + 1] * fc;
  return top * (1 - fr) + bottom * fr;
}
