import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAMERA_PRESETS } from './stadium-model-bindings';
import { computeCameraFraming, fitDistance, type ModelBounds } from './camera-framing';

const FOV = 40;
/** Phone portrait, narrow phone, and desktop. Aspect decides what actually fits. */
const ASPECTS: [string, number][] = [
  ['phone', 390 / 300],
  ['narrow', 320 / 280],
  ['desktop', 1200 / 560],
];

/** Loads the bundled asset and applies the viewer's auto-fit, as the canvas does. */
async function loadFittedBounds(): Promise<{ bounds: ModelBounds; box: THREE.Box3 }> {
  const bytes = readFileSync(new URL('../../assets/nrg-stadium.glb', import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    '',
  );
  const raw = new THREE.Box3().setFromObject(scene);
  const size = raw.getSize(new THREE.Vector3());
  const scale = 36 / Math.max(size.x, size.y, size.z);
  scene.scale.setScalar(scale);
  const center = raw.getCenter(new THREE.Vector3());
  scene.position.set(-center.x * scale, -raw.min.y * scale, -center.z * scale);
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return {
    box,
    bounds: {
      center: [sphere.center.x, sphere.center.y, sphere.center.z],
      radius: sphere.radius,
      minY: box.min.y,
      height: box.max.y - box.min.y,
    },
  };
}

/** Projects the model's corners and returns the widest normalised device coords. */
function projectExtent(box: THREE.Box3, position: number[], target: number[], aspect: number) {
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 1000);
  camera.position.set(position[0]!, position[1]!, position[2]!);
  camera.lookAt(new THREE.Vector3(target[0]!, target[1]!, target[2]!));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  let maxAbsX = 0;
  let maxAbsY = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const ndc = new THREE.Vector3(x, y, z).project(camera);
        maxAbsX = Math.max(maxAbsX, Math.abs(ndc.x));
        maxAbsY = Math.max(maxAbsY, Math.abs(ndc.y));
      }
    }
  }
  return { maxAbsX, maxAbsY };
}

describe('camera framing', () => {
  it('keeps the stadium fully on screen for every preset and viewport', async () => {
    const { bounds, box } = await loadFittedBounds();

    for (const [label, aspect] of ASPECTS) {
      for (const id of Object.keys(CAMERA_PRESETS) as (keyof typeof CAMERA_PRESETS)[]) {
        const framing = computeCameraFraming(id, bounds, FOV, aspect);
        const { maxAbsX, maxAbsY } = projectExtent(box, framing.position, framing.target, aspect);

        expect(maxAbsX, `${id} on ${label} overflows horizontally`).toBeLessThanOrEqual(1);
        expect(maxAbsY, `${id} on ${label} overflows vertically`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the camera above the model floor', async () => {
    const { bounds } = await loadFittedBounds();
    for (const id of Object.keys(CAMERA_PRESETS) as (keyof typeof CAMERA_PRESETS)[]) {
      const framing = computeCameraFraming(id, bounds, FOV, 390 / 300);
      expect(framing.position[1], `${id} dips to or below the model floor`).toBeGreaterThan(bounds.minY);
    }
  });

  it('pulls the camera back on a narrower viewport, where horizontal fov binds', () => {
    const wide = fitDistance(20, FOV, 2);
    const narrow = fitDistance(20, FOV, 0.6);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('frames a differently sized model without changing the presets', () => {
    const small: ModelBounds = { center: [0, 1, 0], radius: 2, minY: 0, height: 2 };
    const large: ModelBounds = { center: [0, 40, 0], radius: 200, minY: 0, height: 80 };
    const s = computeCameraFraming('overview', small, FOV, 1.3);
    const l = computeCameraFraming('overview', large, FOV, 1.3);
    // Distance scales with the model rather than being fixed in world units.
    const dist = (f: typeof s) => Math.hypot(
      f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2]);
    expect(dist(l)).toBeGreaterThan(dist(s) * 10);
  });
});
