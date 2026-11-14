// Купол марсианского неба: пыльный дневной градиент с голубым ореолом у Солнца, сумерки и Млечный Путь по матрице ICRF.

import * as THREE from 'three';
import type { Mat3 } from './marsSky';
import { daylightWeight, enuToScene, starWeight } from './skyMath';

export const DEFAULT_TAU = 0.5;
const STAR_EXPOSURE = 3;
const SKY_TOP = new THREE.Color('#b98a63');
const SKY_HORIZON = new THREE.Color('#cfa47e');

export interface SkyUpdate {
  sunEnu: [number, number, number];
  sunElevationDeg: number;
  angularDiameterDeg: number;
  icrfToEnuMatrix: Mat3;
  tau: number;
}

const VERTEX = `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = `uniform vec3 top;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform float sunRadiusRad;
uniform float sunElevationDeg;
uniform float dayWeight;
uniform float starWeight;
uniform float tau;
uniform float starGain;
uniform float gamma;
uniform mat3 icrfToEnu;
uniform sampler2D milkyWay;
varying vec3 vDir;
const float PI = 3.14159265359;
void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);
  float tauGain = clamp(0.55 + 0.9 * tau, 0.6, 1.6);
  vec3 sky = mix(horizon, top, pow(h, 0.6)) * (0.05 + 0.95 * dayWeight) * tauGain;
  float chord = length(dir - sunDir);
  float sunVisible = smoothstep(-2.0, 1.0, sunElevationDeg);
  float broad = pow(max(1.0 - chord * chord * 0.5, 0.0), 12.0);
  float narrow = pow(max(1.0 - chord * chord * 0.5, 0.0), 400.0);
  float scatter = clamp(tau / 0.5, 0.2, 3.0);
  vec3 halo = (vec3(0.25, 0.22, 0.2) * broad + vec3(0.55, 0.6, 0.65) * narrow * scatter) * sunVisible;
  float disc = (1.0 - smoothstep(sunRadiusRad * 0.9, sunRadiusRad * 1.15, chord)) * sunVisible;
  vec3 color = sky + halo * (0.3 + 0.7 * dayWeight) + vec3(1.0, 0.96, 0.88) * disc * 12.0;
  vec3 enu = vec3(dir.x, -dir.z, dir.y);
  vec3 icrf = enu * icrfToEnu;
  float ra = atan(icrf.y, icrf.x);
  float dec = asin(clamp(icrf.z, -1.0, 1.0));
  vec2 uv = vec2(fract(ra / (2.0 * PI)), 0.5 - dec / PI);
  vec3 radiance = pow(texture2D(milkyWay, uv).rgb, vec3(gamma)) * starGain;
  float aboveHorizon = smoothstep(-0.02, 0.08, dir.y);
  vec3 night = radiance * starWeight * aboveHorizon * (1.0 - disc);
  vec3 dustGlow = vec3(0.045, 0.028, 0.02) * pow(1.0 - h, 3.0) * starWeight * tauGain;
  gl_FragColor = vec4(color + night + dustGlow, 1.0);
  #include <colorspace_fragment>
}`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private texture: THREE.Texture | null = null;
  private disposed = false;

  constructor(baseUrl: string) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: SKY_TOP.clone() },
        horizon: { value: SKY_HORIZON.clone() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunRadiusRad: { value: THREE.MathUtils.degToRad(0.33 / 2) },
        sunElevationDeg: { value: 35 },
        dayWeight: { value: 1 },
        starWeight: { value: 0 },
        tau: { value: DEFAULT_TAU },
        starGain: { value: 0.95 * STAR_EXPOSURE },
        gamma: { value: 2.6 },
        icrfToEnu: { value: new THREE.Matrix3() },
        milkyWay: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    (this.material.uniforms.milkyWay.value as THREE.DataTexture).needsUpdate = true;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    void this.loadAssets(baseUrl);
  }

  private async loadAssets(baseUrl: string): Promise<void> {
    try {
      const passport = (await (await fetch(`${baseUrl}data/sky/sky.json`)).json()) as { gamma: number; peak_radiance: number };
      this.material.uniforms.gamma.value = passport.gamma;
      this.material.uniforms.starGain.value = passport.peak_radiance * STAR_EXPOSURE;
      const tex = await new THREE.TextureLoader().loadAsync(`${baseUrl}data/sky/milkyway_icrf.webp`);
      if (this.disposed) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.NoColorSpace;
      tex.flipY = false;
      tex.wrapS = THREE.RepeatWrapping;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.texture = tex;
      this.material.uniforms.milkyWay.value = tex;
    } catch {
      this.material.uniforms.starGain.value = 0;
    }
  }

  update(u: SkyUpdate): void {
    const un = this.material.uniforms;
    const [x, y, z] = enuToScene(u.sunEnu);
    (un.sunDir.value as THREE.Vector3).set(x, y, z).normalize();
    un.sunRadiusRad.value = THREE.MathUtils.degToRad(u.angularDiameterDeg / 2);
    un.sunElevationDeg.value = u.sunElevationDeg;
    un.dayWeight.value = daylightWeight(u.sunElevationDeg);
    un.starWeight.value = starWeight(u.sunElevationDeg);
    un.tau.value = u.tau;
    (un.icrfToEnu.value as THREE.Matrix3).set(...u.icrfToEnuMatrix);
  }

  dispose(): void {
    this.disposed = true;
    this.texture?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
