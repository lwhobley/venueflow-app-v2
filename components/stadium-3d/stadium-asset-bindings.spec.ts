import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_MESH_NAMES,
  STADIUM_ZONE_MODEL_BINDINGS,
  findZoneByMeshName,
} from './stadium-model-bindings';

/**
 * The zone bindings are only useful if they name meshes that actually exist in
 * the shipped stadium asset. Nothing at runtime complains about an entry that
 * matches nothing — the zone silently stops being tappable — so these tests
 * read the GLB's node table directly and hold the two in step.
 */
function readGlbNodeNames(): string[] {
  const buffer = readFileSync(path.join(__dirname, '../../assets/nrg-stadium.glb'));
  // glTF binary: 12-byte header, then a JSON chunk with its own 8-byte header.
  const jsonChunkLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonChunkLength).toString('utf8'));
  return (json.nodes ?? []).map((node: { name?: string }) => node.name ?? '').filter(Boolean);
}

const NODE_NAMES = readGlbNodeNames();
const PROCEDURAL_NAMES = Object.values(PROCEDURAL_MESH_NAMES);

/**
 * Structure with no operational meaning: the roof and the plaza rings are
 * scenery, and tapping them is expected to select nothing.
 */
const UNBOUND_BY_DESIGN = /^Node_Roof_/;

describe('stadium 3D asset bindings', () => {
  it('reads the bundled stadium asset', () => {
    expect(NODE_NAMES.length).toBeGreaterThan(50);
    expect(NODE_NAMES).toContain('Node_Field_GrassTurf');
  });

  it('names only meshes that exist in the asset or in the procedural fallback', () => {
    const known = new Set(
      [...NODE_NAMES, ...PROCEDURAL_NAMES].map((name) => name.toLowerCase().replace(/^node_/, ''))
    );

    const unresolved = STADIUM_ZONE_MODEL_BINDINGS.flatMap((binding) =>
      binding.meshNames
        .filter((name) => !known.has(name.toLowerCase().replace(/^node_/, '')))
        .map((name) => `${binding.zoneId}: ${name}`)
    );

    expect(unresolved).toEqual([]);
  });

  it('matches every mesh prefix to at least one node in the asset', () => {
    const unmatched = STADIUM_ZONE_MODEL_BINDINGS.flatMap((binding) =>
      (binding.meshPrefixes ?? [])
        .filter((prefix) => !NODE_NAMES.some((name) => name.toLowerCase().startsWith(prefix.toLowerCase())))
        .map((prefix) => `${binding.zoneId}: ${prefix}`)
    );

    expect(unmatched).toEqual([]);
  });

  it('routes every procedural fallback mesh to a zone, so the fallback stays tappable', () => {
    for (const name of PROCEDURAL_NAMES) {
      expect(findZoneByMeshName(name), name).toBeDefined();
    }
  });

  it('leaves no asset node unselectable except the scenery that has no zone', () => {
    const unbound = NODE_NAMES.filter(
      (name) => !UNBOUND_BY_DESIGN.test(name) && !findZoneByMeshName(name)
    );

    expect(unbound).toEqual([]);
  });

  it('keeps the two zones without geometry explicitly empty rather than mis-bound', () => {
    for (const zoneId of ['zone-concourse-bunkers', 'zone-locker-rooms-aux']) {
      const binding = STADIUM_ZONE_MODEL_BINDINGS.find((b) => b.zoneId === zoneId);
      expect(binding?.meshNames).toEqual([]);
      expect(binding?.meshPrefixes ?? []).toEqual([]);
    }
  });
});
