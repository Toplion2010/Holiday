// Локальный пакет участка: manifest.json, height.png, ortho.webp, ortho_hi.webp (необязательно),
// track.geojson.

import { makeFrame, type LocalFrame } from './geo';
import { decodeHeights, type HeightGrid } from './heightGrid';
import { decodePng } from './png';

export interface SiteIndexEntry {
  id: string;
  title: string;
  center: { lat: number; lon_east: number };
}

export interface ManifestPoi {
  id: string;
  title: string;
  lat: number;
  lon_east: number;
  note?: string;
}

export interface SiteBackdrop {
  file: string;
  pixel_m: number;
  label: string;
  credit?: string;
  note?: string;
}

export interface SiteManifest {
  id: string;
  title: string;
  note?: string;
  center: { lat: number; lon_east: number };
  bounds_eqc_m: [number, number, number, number];
  /** Географические границы участка; долготы восточные. */
  bounds_lonlat?: { west: number; south: number; east: number; north: number };
  height: {
    file: string;
    width: number;
    height: number;
    pixel_m: number;
    base_m: number;
    step_m: number;
    min_m: number;
    max_m: number;
    /** Готовая подпись уровня данных, если это не HiRISE DTM (например, процедурная модель). */
    data_label?: string;
    /** Если высоты собраны из нескольких моделей: подписи кодов канала B. */
    source_channel?: { channel: 'B'; values: Record<string, string> };
  };
  ortho: { file: string; width: number; height: number; pixel_m: number };
  /**
   * Детальное окно снимка в родном разрешении HiRISE (0,25 м) у места старта; та же растяжка
   * яркости, что у ortho. Альфа 0 — в окне нет HiRISE. У старых пакетов отсутствует.
   */
  ortho_hi?: {
    file: string;
    width: number;
    height: number;
    pixel_m: number;
    bounds_eqc_m: [number, number, number, number];
    product?: string;
    blend_m?: number;
  };
  sources?: { role: string; product: string; credit?: string }[];
  pois?: ManifestPoi[];
  track: null | { mission: string; dtm_minus_rover_m?: { median: number } | null; note?: string };
  /** Дальний план вокруг участка (обзорный рельеф в тех же осях и нулевом уровне). */
  backdrop?: SiteBackdrop;
}

export interface TrackPoint {
  sol: number;
  lonEast: number;
  lat: number;
  dtmHeightM: number | null;
}

export interface SiteTrack {
  mission: string;
  /** Название миссии по-человечески: MSL → Curiosity. */
  rover: string;
  line: { lonEast: number; lat: number }[];
  points: TrackPoint[];
}

export interface SitePackage {
  manifest: SiteManifest;
  frame: LocalFrame;
  grid: HeightGrid;
  ortho: ImageBitmap;
  /** Детальный снимок (manifest.ortho_hi); null — нет в пакете или не загрузился. */
  orthoHi: ImageBitmap | null;
  track: SiteTrack | null;
}

const ROVERS: Record<string, string> = { MSL: 'Curiosity', M20: 'Perseverance' };

export function roverName(mission: string): string {
  return ROVERS[mission] ?? mission;
}

interface GeoJsonFeature {
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
}

export function parseTrack(geojson: { features: GeoJsonFeature[] }, mission: string): SiteTrack {
  const line: SiteTrack['line'] = [];
  const points: TrackPoint[] = [];
  for (const f of geojson.features) {
    if (f.geometry.type === 'LineString') {
      for (const [lon, lat] of f.geometry.coordinates as [number, number][]) {
        line.push({ lonEast: ((lon % 360) + 360) % 360, lat });
      }
    } else if (f.geometry.type === 'Point') {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const p = f.properties ?? {};
      if (typeof p.sol !== 'number') continue;
      points.push({
        sol: p.sol,
        lonEast: ((lon % 360) + 360) % 360,
        lat,
        dtmHeightM: typeof p.dtm_height_m === 'number' ? p.dtm_height_m : null,
      });
    }
  }
  return { mission, rover: roverName(mission), line, points };
}

export function siteBaseUrl(site: string): string {
  return `${import.meta.env.BASE_URL}data/local/${encodeURIComponent(site)}/`;
}

export async function fetchSiteIndex(): Promise<SiteIndexEntry[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/local/index.json`);
  if (!res.ok) throw new Error(`Список участков недоступен (${res.status})`);
  return res.json();
}

export async function fetchManifest(site: string): Promise<SiteManifest> {
  const res = await fetch(`${siteBaseUrl(site)}manifest.json`);
  if (!res.ok) throw new Error(`Паспорт участка недоступен (${res.status})`);
  return res.json();
}

const decodeOrtho = (blob: Blob) =>
  createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });

/**
 * Детальный снимок необязателен: без него прогулка работает на базовом ortho, поэтому
 * ошибка загрузки не валит пакет, а только оставляет null (и пишет предупреждение).
 */
async function loadOrthoHi(base: string, manifest: SiteManifest, signal?: AbortSignal): Promise<ImageBitmap | null> {
  const hi = manifest.ortho_hi;
  if (!hi) return null;
  try {
    const r = await fetch(base + hi.file, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bitmap = await decodeOrtho(await r.blob());
    if (bitmap.width !== hi.width || bitmap.height !== hi.height) {
      bitmap.close();
      throw new Error('размер не совпадает с паспортом');
    }
    return bitmap;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn(`Детальный снимок ${hi.file} не загружен: ${(e as Error).message}`);
    return null;
  }
}

export async function loadSitePackage(site: string, signal?: AbortSignal): Promise<SitePackage> {
  const base = siteBaseUrl(site);
  const manifest = await fetchManifest(site);
  const [heightBuf, orthoBlob, trackJson, orthoHi] = await Promise.all([
    fetch(base + manifest.height.file, { signal }).then((r) => {
      if (!r.ok) throw new Error(`Высоты недоступны (${r.status})`);
      return r.arrayBuffer();
    }),
    fetch(base + manifest.ortho.file, { signal }).then((r) => {
      if (!r.ok) throw new Error(`Ортофото недоступно (${r.status})`);
      return r.blob();
    }),
    manifest.track
      ? fetch(base + 'track.geojson', { signal }).then((r) => (r.ok ? r.json() : null))
      : Promise.resolve(null),
    loadOrthoHi(base, manifest, signal),
  ]);
  const png = await decodePng(heightBuf);
  const h = manifest.height;
  if (png.width !== h.width || png.height !== h.height) {
    orthoHi?.close();
    throw new Error('Размер height.png не совпадает с паспортом');
  }
  const grid = decodeHeights(png.data, png.channels, png.width, png.height, h.base_m, h.step_m);
  const ortho = await decodeOrtho(orthoBlob);
  const frame = makeFrame(manifest.bounds_eqc_m, h.pixel_m, h.width, h.height);
  const track = trackJson && manifest.track ? parseTrack(trackJson, manifest.track.mission) : null;
  return { manifest, frame, grid, ortho, orthoHi, track };
}

/** Подпись уровня данных под ногами: по каналу источника, если высоты собраны из разных моделей. */
export function dataLevelLabel(manifest: SiteManifest, code: number): string {
  const grid = `сетка сцены ${manifest.height.pixel_m} м`;
  if (manifest.height.data_label) return manifest.height.data_label;
  const label = manifest.height.source_channel?.values[String(code)];
  return label ? `${label}, ${grid}` : `HiRISE DTM, ${grid}`;
}
