import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { COMPREHENSIVE_STADIUM_ZONES } from '../stadium-map/zone-data';
import { STADIUM_ZONE_MODEL_BINDINGS, findZoneByMeshName, resolveZoneHighlightStatus } from './stadium-model-bindings';
import { applyHighlights, disposeScene, isolateMaterials } from './scene-resources';

async function loadModel() {
  const bytes = readFileSync(new URL('../../assets/nrg-stadium.glb', import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
}

/** Zones the bundled asset has no geometry for; reachable via the Operations Map. */
const ZONES_WITHOUT_GEOMETRY = ['zone-concourse-bunkers', 'zone-locker-rooms-aux'];

describe('bundled stadium asset contract', () => {
  it('has globally unique operational unit identities', () => {
    const ids = COMPREHENSIVE_STADIUM_ZONES.flatMap((zone) => zone.units.map((unit) => unit.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('maps every supported binding to a real operational zone and actual geometry', async () => {
    const { scene } = await loadModel();
    const bound = new Set<string>();
    scene.traverse((mesh) => { const binding = findZoneByMeshName(mesh.name); if (binding) bound.add(binding.zoneId); });
    for (const binding of STADIUM_ZONE_MODEL_BINDINGS) {
      expect(COMPREHENSIVE_STADIUM_ZONES.some((zone) => zone.id === binding.zoneId)).toBe(true);
      if (binding.meshNames.length) expect(bound.has(binding.zoneId)).toBe(true);
      else expect(ZONES_WITHOUT_GEOMETRY).toContain(binding.zoneId);
    }
    disposeScene(scene);
  });

  it('routes each mesh in the asset to at most one zone', async () => {
    const { scene } = await loadModel();
    const claims = new Map<string, Set<string>>();
    scene.traverse((object) => {
      const binding = findZoneByMeshName(object.name);
      if (!binding) return;
      const owners = claims.get(object.name) ?? new Set<string>();
      owners.add(binding.zoneId);
      claims.set(object.name, owners);
    });
    const contested = [...claims.entries()].filter(([, owners]) => owners.size > 1);
    expect(contested).toEqual([]);
    disposeScene(scene);
  });

  it('selects the 400 level zone from 400 level suite geometry', async () => {
    const { scene } = await loadModel();
    // Regression: the 400 suite meshes were bound to zone-300-suites, so tapping
    // them opened the 300 level's units, BEOs and staffing.
    for (const meshName of ['Node_Suites_400_Balcony', 'Node_Suites_400_Glass']) {
      expect(scene.getObjectByName(meshName)).toBeDefined();
      expect(findZoneByMeshName(meshName)?.zoneId).toBe('zone-400-upper');
    }
    expect(findZoneByMeshName('Node_Suites_300_Balcony')?.zoneId).toBe('zone-300-suites');
    disposeScene(scene);
  });

  it('keeps binding level and name aligned with the operational zone record', () => {
    for (const binding of STADIUM_ZONE_MODEL_BINDINGS) {
      const zone = COMPREHENSIVE_STADIUM_ZONES.find((candidate) => candidate.id === binding.zoneId);
      expect(zone).toBeDefined();
      expect(binding.level).toBe(zone!.level);
    }
  });

  it('applies initial selection without lighting other zones sharing the original material', async () => {
    const { scene } = await loadModel();
    isolateMaterials(scene);
    applyHighlights(scene, 'zone-300-suites', {});
    const suite = scene.getObjectByName('Node_Suites_300_Balcony') as THREE.Mesh;
    const club = scene.getObjectByName('Node_Bowl_200_Club') as THREE.Mesh;
    expect(suite.material).not.toBe(club.material);
    expect((suite.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.9);
    expect((club.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    disposeScene(scene);
  });

  it('never masks an incident when selected or when there is only one alert', () => {
    const zone = { ...COMPREHENSIVE_STADIUM_ZONES[0], alertCount: 1, units: [{ ...COMPREHENSIVE_STADIUM_ZONES[0].units[0], status: 'incident' as const }] };
    expect(resolveZoneHighlightStatus(zone, false)).toBe('critical');
    expect(resolveZoneHighlightStatus(zone, true)).toBe('critical');
  });

  it('disposes shared resources only once', () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    disposeScene(group);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  });
});
