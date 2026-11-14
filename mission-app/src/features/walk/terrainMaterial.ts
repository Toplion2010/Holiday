// Материал рельефа прогулки: MeshLambertMaterial (свет, тени, туман three.js) с детальным снимком.
//
// Детальный снимок ortho_hi (0,25 м, окно ~1 × 1 км у старта): внутри окна берётся он, снаружи —
// базовый ortho (0,5 м); у края окна плавный переход. Где в окне нет HiRISE (альфа 0), остаётся
// базовый снимок. Это данные, ничего не дорисовывается.
//
// Патч шейдера цепочечный: предыдущий onBeforeCompile и customProgramCacheKey материала
// сохраняются и вызываются, свой код вставляется ПОСЛЕ маркеров `#include <common>` и
// `#include <map_fragment>`, сами маркеры остаются на месте — следующий патч (например,
// художественная детализация) может навешиваться так же. Имена: define TERRAIN_ORTHO_HI,
// uniform terrainOrthoHi / terrainHiRect / terrainHiFade.

import * as THREE from 'three';

/** Ширина плавного перехода у края детального окна, м. */
export const ORTHO_HI_BLEND_M = 25;
/** Цвет-множитель снимка (тёплый тон Марса), как было у материала рельефа. */
export const TERRAIN_TINT = '#ffc49a';

export interface OrthoHiPlacement {
  /** uv детального окна = (uv базового снимка − offset) · scale. */
  offset: [number, number];
  scale: [number, number];
  /** Ширина перехода у края окна в долях окна (по u и v). */
  fade: [number, number];
}

/**
 * Положение детального окна в uv базового снимка. Границы в м eqc: [запад, юг, восток, север];
 * v базового снимка идёт с севера (первая строка — северный край), как у сетки высот.
 */
export function orthoHiPlacement(
  site: [number, number, number, number],
  hi: [number, number, number, number],
  blendM = ORTHO_HI_BLEND_M,
): OrthoHiPlacement {
  const [w, s, e, n] = site;
  const [hw, hs, he, hn] = hi;
  const siteW = e - w;
  const siteH = n - s;
  const hiW = he - hw;
  const hiH = hn - hs;
  return {
    offset: [(hw - w) / siteW, (n - hn) / siteH],
    scale: [siteW / hiW, siteH / hiH],
    fade: [blendM / hiW, blendM / hiH],
  };
}

const FRAGMENT_PARS = /* glsl */ `
#ifdef TERRAIN_ORTHO_HI
uniform sampler2D terrainOrthoHi;
uniform vec4 terrainHiRect;
uniform vec2 terrainHiFade;
#endif
`;

// После map_fragment: diffuseColor = diffuse · base. Внутри окна заменяем base на детальный
// снимок с весом (край окна × альфа). Обе текстуры в sRGB, декодируются одинаково.
const AFTER_MAP = /* glsl */ `
#ifdef TERRAIN_ORTHO_HI
{
  vec2 terrainHiUv = (vMapUv - terrainHiRect.xy) * terrainHiRect.zw;
  vec2 terrainEdge = min(terrainHiUv, 1.0 - terrainHiUv) / terrainHiFade;
  float terrainInside = clamp(min(terrainEdge.x, terrainEdge.y), 0.0, 1.0);
  if (terrainInside > 0.0) {
    vec4 terrainHi = texture2D(terrainOrthoHi, terrainHiUv);
    float terrainW = smoothstep(0.0, 1.0, terrainInside) * terrainHi.a;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * terrainHi.rgb, terrainW);
  }
}
#endif
`;

export interface TerrainOrthoHi {
  texture: THREE.Texture;
  placement: OrthoHiPlacement;
}

/**
 * Навешивает детальный снимок на материал с картой map (цепочкой к уже заданному
 * onBeforeCompile). Возвращает uniforms патча.
 */
export function applyOrthoHi(material: THREE.MeshLambertMaterial, hi: TerrainOrthoHi) {
  const uniforms = {
    terrainOrthoHi: { value: hi.texture },
    terrainHiRect: { value: new THREE.Vector4(...hi.placement.offset, ...hi.placement.scale) },
    terrainHiFade: { value: new THREE.Vector2(...hi.placement.fade) },
  };
  material.defines = { ...material.defines, TERRAIN_ORTHO_HI: '' };
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prevCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${AFTER_MAP}`);
  };
  material.customProgramCacheKey = function (this: THREE.Material) {
    return `${prevKey.call(this)}|terrain-ortho-hi`;
  };
  material.needsUpdate = true;
  return uniforms;
}

/** Материал рельефа: базовый снимок и, если есть, детальное окно. */
export function createTerrainMaterial(map: THREE.Texture, orthoHi?: TerrainOrthoHi | null): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ map, color: new THREE.Color(TERRAIN_TINT) });
  if (orthoHi) applyOrthoHi(material, orthoHi);
  return material;
}
