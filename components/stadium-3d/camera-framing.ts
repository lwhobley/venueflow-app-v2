import { CAMERA_PRESETS } from './stadium-model-bindings';
import type { CameraPreset, CameraPresetId } from './stadium-3d.types';

export type Vec3 = [number, number, number];

/** Bounds of the loaded model, in world units after the scene's auto-fit. */
export interface ModelBounds {
  center: Vec3;
  /** Radius of the bounding sphere enclosing the model. */
  radius: number;
  minY: number;
  height: number;
}

export interface CameraFraming {
  position: Vec3;
  target: Vec3;
  minDistance: number;
  maxDistance: number;
}

/** Closest a preset may sit, as a fraction of the distance that fits the model. */
export const MIN_DOLLY = 0.7;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

function normalize(v: Vec3): Vec3 {
  const l = length(v);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
}

/**
 * Distance at which a sphere of `radius` fits inside the frustum, accounting for
 * aspect: on a narrow viewport the horizontal field of view is the binding
 * constraint, so framing computed from the vertical fov alone overflows.
 */
/** Half-angle of the narrower of the two frustum axes, in radians. */
export function limitingHalfFov(verticalFovDeg: number, aspect: number): number {
  const vFov = (verticalFovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.0001));
  return Math.min(vFov, hFov) / 2;
}

export function fitDistance(radius: number, verticalFovDeg: number, aspect: number, margin = 1.12): number {
  const vFov = (verticalFovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.0001));
  const limiting = Math.min(vFov, hFov);
  return (radius / Math.sin(limiting / 2)) * margin;
}

/**
 * Places the camera for a preset.
 *
 * The preset's `position`/`target` are treated as authored *intent* — the
 * viewing angle, how close it sits relative to the overview, and how high it
 * looks — rather than as absolute world coordinates. Absolute placement is
 * derived from the model's real bounds and the current aspect, because the
 * scene auto-fits the model at runtime and a hardcoded coordinate framed it
 * correctly only for the size and viewport it happened to be authored against.
 */
export function computeCameraFraming(
  presetId: CameraPresetId,
  bounds: ModelBounds,
  verticalFovDeg: number,
  aspect: number,
): CameraFraming {
  const preset: CameraPreset = CAMERA_PRESETS[presetId] ?? CAMERA_PRESETS.overview;
  const overview = CAMERA_PRESETS.overview;

  const direction = normalize(sub(preset.position, preset.target));

  // How close this preset sits relative to the overview, preserved as a ratio.
  // Floored so a close-up still frames the whole stadium: the authored close
  // presets sat at ~0.45, which pushed most of the model outside the viewport.
  const overviewReach = length(sub(overview.position, overview.target)) || 1;
  const dolly = Math.max(length(sub(preset.position, preset.target)) / overviewReach, MIN_DOLLY);

  const base = fitDistance(bounds.radius, verticalFovDeg, aspect);

  // Vertical aim, as a fraction of model height relative to the overview's aim.
  const overviewAim = overview.target[1] || 1;
  const aimFraction = preset.target[1] / overviewAim;
  const targetY = bounds.minY + bounds.height * 0.35 * aimFraction;

  const target: Vec3 = [bounds.center[0], targetY, bounds.center[2]];

  // Presets aim above the model's centre, so the bounding sphere sits off the
  // view axis and a distance derived from the fov alone still overflows. Push
  // back until the sphere's angular radius plus its off-axis angle fits inside
  // the narrower frustum half-angle.
  const halfFov = limitingHalfFov(verticalFovDeg, aspect);
  const safeHalfFov = halfFov * 0.98;
  let distance = base * dolly + length(sub(target, bounds.center));

  for (let i = 0; i < 12; i += 1) {
    const camPos = add(target, scale(direction, distance));
    const toCenter = sub(bounds.center, camPos);
    const centreDistance = length(toCenter);
    if (centreDistance <= bounds.radius) {
      distance *= 2;
      continue;
    }
    const axis = normalize(sub(target, camPos));
    const offAxis = Math.acos(Math.min(1, Math.max(-1, dot(axis, normalize(toCenter)))));
    const angularRadius = Math.asin(Math.min(1, bounds.radius / centreDistance));
    const required = offAxis + angularRadius;
    if (required <= safeHalfFov) break;
    distance *= required / safeHalfFov;
  }

  return {
    position: [
      target[0] + direction[0] * distance,
      Math.max(target[1] + direction[1] * distance, bounds.minY + bounds.height * 0.15),
      target[2] + direction[2] * distance,
    ],
    target,
    minDistance: bounds.radius * 0.35,
    maxDistance: base * 3,
  };
}
