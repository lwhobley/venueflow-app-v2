import * as THREE from 'three';
import { findZoneByMeshName, getHighlightColor } from './stadium-model-bindings';
import type { OperationalHighlightStatus } from './stadium-3d.types';

export function isolateMaterials(root: THREE.Object3D) {
  const originals = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) originals.add(material);
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone()) : mesh.material.clone();
  });
  originals.forEach((material) => material.dispose());
}

export function applyHighlights(root: THREE.Object3D, selectedId: string | null, states: Record<string, OperationalHighlightStatus>) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const binding = findZoneByMeshName(mesh.name);
    if (!binding) return;
    const operational = states[binding.zoneId] ?? 'normal';
    const status = selectedId === binding.zoneId && !['critical', 'attention'].includes(operational)
      ? 'selected' : operational;
    const color = getHighlightColor(status);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial) {
        standard.emissive.set(color.emissiveColor);
        standard.emissiveIntensity = color.intensity;
      }
    }
  });
}

export function disposeScene(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
}
