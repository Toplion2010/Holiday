import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MODEL_YAW_FIX, RoverRig } from './roverRig';
import { WalkScene } from './walkScene';
import { bearingDeg } from './geo';

// Exercise production movement/indicator methods without constructing WebGL or DOM.
function harness(yaw: number, key: string) {
  const scene = Object.create(WalkScene.prototype);
  Object.assign(scene, { roverYaw: yaw, keys: new Set([key]), joyX: 0, joyY: 0,
    timeScale: 1, px: 0, pz: 0, vehicle: 'rover', camera: new THREE.PerspectiveCamera(),
    tryStep(dx: number, dz: number) { this.px += dx; this.pz += dz; return true; } });
  scene.camera.rotation.order = 'YXZ';
  scene.camera.rotation.y = yaw + 0.7; // independent mouse-look offset
  return scene;
}

describe('Perseverance orientation contract', () => {
  it('aligns the actual GLB front/rear axis with scene −Z', () => {
    const bytes = readFileSync('public/models/perseverance.glb');
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const front = gltf.nodes.find((n: {name: string}) => n.name === 'hazcams_front');
    const rear = gltf.nodes.find((n: {name: string}) => n.name === 'hazcams_rear');
    expect(gltf.scenes[0].nodes).toContain(gltf.nodes.indexOf(front));
    expect(gltf.scenes[0].nodes).toContain(gltf.nodes.indexOf(rear));
    const axis = new THREE.Vector3(...front.translation as [number, number, number])
      .sub(new THREE.Vector3(...rear.translation as [number, number, number]));
    axis.y = 0;
    axis.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), MODEL_YAW_FIX);
    // Camera origins are laterally offset; they still establish the longitudinal axis.
    expect(axis.z).toBeLessThan(-0.95);
    expect(Math.abs(axis.x)).toBeLessThan(0.3);
  });

  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.43]) {
    it(`keeps nose, travel, mast, HUD and reverse aligned at yaw ${yaw}`, () => {
      const rig = new RoverRig();
      rig.place(0, 0, yaw, () => 0);
      const nose = new THREE.Vector3(0, 0, 1)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), MODEL_YAW_FIX)
        .transformDirection(rig.group.matrixWorld);
      for (const [key, sign] of [['KeyW', 1], ['KeyS', -1], ['ArrowUp', 1], ['ArrowDown', -1]] as const) {
        const scene = harness(yaw, key);
        scene.drive(1);
        expect(scene.px).toBeCloseTo(nose.x * sign);
        expect(scene.pz).toBeCloseTo(nose.z * sign);
        const heading = scene.headingDirection(new THREE.Vector3());
        expect(heading.distanceTo(nose)).toBeLessThan(1e-9);
        expect(bearingDeg(heading.x, heading.z)).toBeCloseTo(bearingDeg(nose.x, nose.z));
        expect(scene.camera.rotation.y).toBeCloseTo(yaw + 0.7);
      }
      const mast = rig.mastPosition(new THREE.Vector3());
      expect(mast.dot(nose)).toBeCloseTo(0.75);
    });
    it(`steers both ways without strafing and preserves look offset at yaw ${yaw}`, () => {
      for (const [key, sign] of [['KeyA', 1], ['KeyD', -1], ['ArrowLeft', 1], ['ArrowRight', -1]] as const) {
        const scene = harness(yaw, key);
        scene.drive(1);
        expect(scene.vehicleYaw).toBeCloseTo(yaw + sign * 0.6);
        expect(scene.camera.rotation.y - scene.vehicleYaw).toBeCloseTo(0.7);
        expect([scene.px, scene.pz]).toEqual([0, 0]);
      }
    });
  }
});
