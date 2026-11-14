import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearingDeg, eqcToLonLat, gridToLocal, localToGrid, localToLonLat, lonLatToEqc, lonLatToLocal, makeFrame, MARS_R } from './geo';
import { decodeHeights, decodeHeightUnits, sampleBilinear, sourceCode, type HeightGrid } from './heightGrid';
import { directionalSlopeDeg, slopeFromSamples, stepBlocked, TerrainSampler, walkSpeed } from './motion';
import { decodePng } from './png';
import { dataLevelLabel, loadSitePackage, parseTrack, type SiteManifest } from './sitePackage';
import { createTerrainMaterial, orthoHiPlacement } from './terrainMaterial';
import { chunkCellsFor, LOD_STEPS, lodDistances, lodForDistance } from './terrainMesh';

const dataDir = (site: string) => fileURLToPath(new URL(`../../../public/data/local/${site}/`, import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('декодирование высот', () => {
  it('units=0 — NoData, иначе base + (units-1)*step', () => {
    expect(decodeHeightUnits(0, 0, -3860, 0.01)).toBeNaN();
    expect(decodeHeightUnits(0, 1, -3860, 0.01)).toBe(-3860);
    expect(decodeHeightUnits(92, 72, -3860, 0.01)).toBeCloseTo(-3623.77, 6);
  });

  it('gale height.png: известные пиксели и сверка с высотами трека из скрипта сборки', async () => {
    const dir = dataDir('gale-boxwork');
    const manifest: SiteManifest = readJson(dir + 'manifest.json');
    const png = await decodePng(readFileSync(dir + 'height.png'));
    expect(png.width).toBe(1800);
    expect(png.height).toBe(2400);
    expect(png.channels).toBe(3);
    // Пиксели (col 900, row 1200) и (246, 912) сетки 1 м, посчитаны отдельным декодером на Python.
    const px = (c: number, r: number) => Array.from(png.data.subarray((r * 1800 + c) * 3, (r * 1800 + c) * 3 + 3));
    expect(px(900, 1200)).toEqual([92, 92, 0]);
    expect(px(246, 912)).toEqual([52, 32, 0]);

    const h = manifest.height;
    const grid = decodeHeights(png.data, png.channels, png.width, png.height, h.base_m, h.step_m);
    expect(grid.data[0]).toBeCloseTo(h.min_m, 2);
    expect(grid.data[1200 * 1800 + 900]).toBeCloseTo(-3623.57, 2);
    let max = -Infinity;
    for (const v of grid.data) if (v > max) max = v;
    expect(max).toBeCloseTo(h.max_m, 2);

    // Скрипт сборки записал в трек билинейную высоту DTM в точке — наша выборка должна совпасть.
    const frame = makeFrame(manifest.bounds_eqc_m, h.pixel_m, h.width, h.height);
    const sampler = new TerrainSampler(grid, frame);
    const track = parseTrack(readJson(dir + 'track.geojson'), 'MSL');
    expect(track.rover).toBe('Curiosity');
    expect(track.points.length).toBeGreaterThan(100);
    for (const p of track.points.slice(0, 40)) {
      const local = lonLatToLocal(frame, p.lonEast, p.lat);
      expect(sampler.heightAt(local.x, local.z)).toBeCloseTo(p.dtmHeightM!, 1);
    }
  });
});

describe('билинейная выборка', () => {
  const grid: HeightGrid = { width: 3, height: 2, data: new Float32Array([0, 10, 20, 100, 110, NaN]) };
  it('интерполирует внутри и точно в узлах', () => {
    expect(sampleBilinear(grid, 0, 0)).toBe(0);
    expect(sampleBilinear(grid, 0.5, 0)).toBe(5);
    expect(sampleBilinear(grid, 0.5, 0.5)).toBeCloseTo(55);
  });
  it('NaN вне сетки и рядом с NoData', () => {
    expect(sampleBilinear(grid, -0.1, 0)).toBeNaN();
    expect(sampleBilinear(grid, 0, 1.1)).toBeNaN();
    expect(sampleBilinear(grid, 1.5, 0.5)).toBeNaN();
  });
});

describe('координаты', () => {
  it('eqc ↔ lon/lat туда и обратно, долгота 0–360', () => {
    const e = lonLatToEqc(331.371, 31.38);
    expect(e.x).toBeLessThan(0);
    expect(e.x).toBeCloseTo(MARS_R * (-28.629 * Math.PI) / 180, 3);
    const back = eqcToLonLat(e.x, e.y);
    expect(back.lonEast).toBeCloseTo(331.371, 9);
    expect(back.lat).toBeCloseTo(31.38, 9);
  });

  it('центр пакета gale совпадает с центром из паспорта', () => {
    const m: SiteManifest = readJson(dataDir('gale-boxwork') + 'manifest.json');
    const f = makeFrame(m.bounds_eqc_m, m.height.pixel_m, m.height.width, m.height.height);
    const c = localToLonLat(f, 0, 0);
    expect(c.lat).toBeCloseTo(m.center.lat, 5);
    expect(c.lonEast).toBeCloseTo(m.center.lon_east, 5);
    // Северо-западный пиксель: центр в (0, 0), ось z на юг.
    const nw = gridToLocal(f, 0, 0);
    expect(nw.z).toBeLessThan(0);
    expect(nw.x).toBeLessThan(0);
    const g = localToGrid(f, nw.x, nw.z);
    expect(g.col).toBeCloseTo(0, 9);
    expect(g.row).toBeCloseTo(0, 9);
  });

  it('по x метры по земле: eqc сжимается на cos(широты)', () => {
    const f = makeFrame([0, 1859040, 2000, 1861040], 2, 1000, 1000);
    expect(f.kx).toBeCloseTo(Math.cos(1860040 / MARS_R), 9);
    expect(gridToLocal(f, 999.5, 0).x - gridToLocal(f, -0.5, 0).x).toBeCloseTo(2000 * f.kx, 6);
  });

  it('азимут от севера по часовой', () => {
    expect(bearingDeg(0, -1)).toBeCloseTo(0);
    expect(bearingDeg(1, 0)).toBeCloseTo(90);
    expect(bearingDeg(0, 1)).toBeCloseTo(180);
    expect(bearingDeg(-1, 0)).toBeCloseTo(270);
  });
});

describe('модель ходьбы', () => {
  it('V = −0.01·θ + 0.75, не меньше 0.1', () => {
    expect(walkSpeed(0)).toBeCloseTo(0.75);
    expect(walkSpeed(20)).toBeCloseTo(0.55);
    expect(walkSpeed(-10)).toBeCloseTo(0.85);
    expect(walkSpeed(80)).toBeCloseTo(0.1);
    expect(walkSpeed(NaN)).toBeCloseTo(0.1);
  });

  it('уклон вдоль шага и крутизна', () => {
    expect(directionalSlopeDeg(0, 1, 1)).toBeCloseTo(45);
    expect(directionalSlopeDeg(0, -1, 1)).toBeCloseTo(-45);
    expect(directionalSlopeDeg(NaN, 1, 1)).toBeNaN();
    // Плоскость z = x·tan(30°): крутизна 30°.
    const t = Math.tan(Math.PI / 6);
    expect(slopeFromSamples(-t, t, 1, 0, 0, 1, 0)).toBeCloseTo(30);
    // С одной стороны NoData — односторонняя разность.
    expect(slopeFromSamples(NaN, t, 1, 0, 0, 1, 0)).toBeCloseTo(30);
    expect(slopeFromSamples(NaN, NaN, 1, 0, 0, 1, 0)).toBeNaN();
  });

  it('правило блокировки шага', () => {
    expect(stepBlocked(NaN, 5, 5, 20)).toBe('nodata');
    expect(stepBlocked(-3700, NaN, 5, 20)).toBe('nodata');
    expect(stepBlocked(-3700, 19, 5, 20)).toBeNull();
    expect(stepBlocked(-3700, 21, 5, 20)).toBe('slope');
    expect(stepBlocked(-3700, 21, 5, 25)).toBeNull();
    // Стоим на 30°, шаг на 24° — выбираемся, на 31° — нет.
    expect(stepBlocked(-3700, 24, 30, 20)).toBeNull();
    expect(stepBlocked(-3700, 31, 30, 20)).toBe('slope');
  });
});

describe('источник высот под ногами', () => {
  it('Езеро: метки канала B совпадают с манифестом, текущая позиция ровера — CTX', async () => {
    const manifest = JSON.parse(readFileSync(dataDir('jezero') + 'manifest.json', 'utf8')) as SiteManifest;
    const png = await decodePng(readFileSync(dataDir('jezero') + 'height.png'));
    const h = manifest.height;
    const grid = decodeHeights(png.data, png.channels, png.width, png.height, h.base_m, h.step_m);
    const counts = [0, 0, 0];
    for (const code of grid.source ?? []) counts[code] = (counts[code] ?? 0) + 1;
    const total = grid.width * grid.height;
    expect(counts[0] / total).toBeGreaterThan(0.15);
    expect(counts[1] / total).toBeGreaterThan(0.5);
    // Perseverance, sol 2022: 18.4356°N, 77.2332°E — HiRISE там нет.
    const frame = makeFrame(manifest.bounds_eqc_m, h.pixel_m, grid.width, grid.height);
    const local = lonLatToLocal(frame, 77.2332, 18.4356);
    const g = localToGrid(frame, local.x, local.z);
    expect(sourceCode(grid, g.col, g.row)).toBe(1);
    expect(dataLevelLabel(manifest, 1)).toContain('CTX');
    expect(dataLevelLabel(manifest, 0)).toContain('HiRISE');
  });

  it('пакет без канала источника подписывается как HiRISE', () => {
    const manifest = JSON.parse(readFileSync(dataDir('ares3') + 'manifest.json', 'utf8')) as SiteManifest;
    expect(dataLevelLabel(manifest, 0)).toBe('HiRISE DTM, сетка сцены 1 м');
  });

  it('пакет не из HiRISE подписывается своим data_label', () => {
    const base = JSON.parse(readFileSync(dataDir('ares3') + 'manifest.json', 'utf8')) as SiteManifest;
    const manifest: SiteManifest = { ...base, height: { ...base.height, data_label: 'модель, шаг сетки 1 м' } };
    expect(dataLevelLabel(manifest, 0)).toBe('модель, шаг сетки 1 м');
    expect(dataLevelLabel(manifest, 0)).not.toContain('HiRISE');
  });

  it.each(['gale-boxwork', 'jezero'])('дальний план %s: файл есть и подписан как обзорный рельеф без снимка', (site) => {
    const manifest = JSON.parse(readFileSync(dataDir(site) + 'manifest.json', 'utf8')) as SiteManifest;
    expect(manifest.backdrop?.file).toBe('backdrop.glb');
    expect(manifest.backdrop?.label).toContain('200 м/пикс');
    expect(manifest.backdrop?.label).toContain('без снимка');
    expect(readFileSync(dataDir(site) + 'backdrop.glb').subarray(0, 4).toString()).toBe('glTF');
  });
});

describe('пакет с детальным снимком ortho_hi и без него', () => {
  const site = 'ares3';
  const dir = dataDir(site);
  const realManifest = (): SiteManifest => readJson(dir + 'manifest.json');

  function stubNetwork(manifest: SiteManifest, opts: { hiStatus?: number } = {}) {
    const requested: string[] = [];
    const height = readFileSync(dir + 'height.png');
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const name = url.split('/').pop();
      if (name === 'manifest.json') return new Response(JSON.stringify(manifest));
      if (name === manifest.height.file) return new Response(height);
      if (name === manifest.ortho.file) return new Response(new Blob([`ortho:${manifest.ortho.width}x${manifest.ortho.height}`]));
      if (manifest.ortho_hi && name === manifest.ortho_hi.file) {
        if (opts.hiStatus && opts.hiStatus !== 200) return new Response('', { status: opts.hiStatus });
        return new Response(new Blob([`ortho:${manifest.ortho_hi.width}x${manifest.ortho_hi.height}`]));
      }
      return new Response('', { status: 404 });
    });
    // Вместо декодирования WebP — размер из «содержимого» заглушки.
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      const [w, h] = (await blob.text()).replace('ortho:', '').split('x').map(Number);
      return { width: w, height: h, close: vi.fn() };
    });
    return requested;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['gale-boxwork', 'ares3', 'jezero'])('%s: паспорт описывает окно 0,25 м внутри участка, сетка высот 1 м', (id) => {
    const m: SiteManifest & { sha256: Record<string, string> } = readJson(dataDir(id) + 'manifest.json');
    const hi = m.ortho_hi!;
    expect(hi.file).toBe('ortho_hi.webp');
    expect(hi.pixel_m).toBe(0.25);
    expect(hi.width).toBe(4096);
    const [w, s, e, n] = m.bounds_eqc_m;
    const [hw, hs, he, hn] = hi.bounds_eqc_m;
    expect(he - hw).toBeCloseTo(hi.width * hi.pixel_m, 6);
    expect(hn - hs).toBeCloseTo(hi.height * hi.pixel_m, 6);
    expect(hw).toBeGreaterThanOrEqual(w - 1e-6);
    expect(he).toBeLessThanOrEqual(e + 1e-6);
    expect(hs).toBeGreaterThanOrEqual(s - 1e-6);
    expect(hn).toBeLessThanOrEqual(n + 1e-6);
    expect(m.sha256.ortho_hi).toMatch(/^[0-9a-f]{64}$/);
    expect(m.height.pixel_m).toBe(1);
    expect(statSync(dataDir(id) + hi.file).size).toBeLessThan(8e6);
    expect(statSync(dataDir(id) + m.height.file).size).toBeLessThan(8e6);
  });

  it('с ortho_hi: детальный снимок загружается', async () => {
    const manifest = realManifest();
    const requested = stubNetwork(manifest);
    const pkg = await loadSitePackage(site);
    expect(requested.some((u) => u.endsWith('/ortho_hi.webp'))).toBe(true);
    expect(pkg.orthoHi?.width).toBe(4096);
    expect(pkg.ortho.width).toBe(manifest.ortho.width);
    expect(pkg.grid.width).toBe(manifest.height.width);
  });

  it('без ortho_hi (старый пакет): работает на базовом снимке', async () => {
    const manifest = realManifest();
    delete manifest.ortho_hi;
    const requested = stubNetwork(manifest);
    const pkg = await loadSitePackage(site);
    expect(pkg.orthoHi).toBeNull();
    expect(requested.some((u) => u.includes('ortho_hi'))).toBe(false);
    expect(pkg.ortho.width).toBe(manifest.ortho.width);
  });

  it('ortho_hi в паспорте, но файл недоступен: пакет грузится без него', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubNetwork(realManifest(), { hiStatus: 404 });
    const pkg = await loadSitePackage(site);
    expect(pkg.orthoHi).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('материал и уровни детализации рельефа', () => {
  it('окно ortho_hi в uv базового снимка', () => {
    const p = orthoHiPlacement([0, 0, 2000, 2000], [500, 700, 1524, 1724], 25);
    // u: запад окна на 500 м от запада участка; v считается с севера: 2000 − 1724 = 276 м.
    expect(p.offset[0]).toBeCloseTo(0.25, 9);
    expect(p.offset[1]).toBeCloseTo(276 / 2000, 9);
    expect(p.scale[0]).toBeCloseTo(2000 / 1024, 9);
    expect(p.fade[0]).toBeCloseTo(25 / 1024, 9);
    // Северо-западный угол окна → (0, 0), юго-восточный → (1, 1).
    const toHi = (u: number, v: number) => [(u - p.offset[0]) * p.scale[0], (v - p.offset[1]) * p.scale[1]];
    const nw = toHi(500 / 2000, 276 / 2000);
    expect(nw[0]).toBeCloseTo(0, 9);
    expect(nw[1]).toBeCloseTo(0, 9);
    const se = toHi(1524 / 2000, (2000 - 700) / 2000);
    expect(se[0]).toBeCloseTo(1, 9);
    expect(se[1]).toBeCloseTo(1, 9);
  });

  it('у ног шаг сетки 1 м, куски ~128 м; у пакетов 2 м — прежние пороги', () => {
    expect(chunkCellsFor(1)).toBe(128);
    expect(chunkCellsFor(2)).toBe(64);
    expect(LOD_STEPS[lodForDistance(10, 1)]).toBe(1);
    expect(LOD_STEPS[lodForDistance(150, 1)]).toBe(2);
    expect(LOD_STEPS[lodForDistance(300, 1)]).toBe(4);
    expect(LOD_STEPS[lodForDistance(5000, 1)]).toBe(16);
    expect(lodDistances(2).slice(0, 3)).toEqual([180, 450, 950]);
    expect(LOD_STEPS[lodForDistance(10, 2)]).toBe(1);
  });

  it('материал: детальное окно через define и цепочечный onBeforeCompile', () => {
    const map = new THREE.Texture();
    const base = createTerrainMaterial(map);
    expect(base.defines?.TERRAIN_ORTHO_HI).toBeUndefined();
    const hi = createTerrainMaterial(map, { texture: new THREE.Texture(), placement: orthoHiPlacement([0, 0, 10, 10], [2, 2, 6, 6]) });
    expect(hi.defines?.TERRAIN_ORTHO_HI).toBe('');
    // Второй патч поверх: оба срабатывают, маркеры шейдера остаются для следующих.
    const prev = hi.onBeforeCompile;
    let second = false;
    hi.onBeforeCompile = function (shader, renderer) {
      prev.call(this, shader, renderer);
      second = shader.fragmentShader.includes('#include <map_fragment>');
    };
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    hi.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(second).toBe(true);
    expect(shader.fragmentShader).toContain('uniform sampler2D terrainOrthoHi;');
    expect(shader.fragmentShader.indexOf('#include <map_fragment>')).toBeLessThan(shader.fragmentShader.indexOf('terrainHiUv'));
    expect(Object.keys(shader.uniforms)).toEqual(['terrainOrthoHi', 'terrainHiRect', 'terrainHiFade']);
    expect(hi.customProgramCacheKey()).toContain('terrain-ortho-hi');
  });
});
