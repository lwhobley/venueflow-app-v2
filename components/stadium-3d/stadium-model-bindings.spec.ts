import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_PRESETS,
  STADIUM_ZONE_MODEL_BINDINGS,
  buildZoneHighlightStates,
  findZoneBinding,
  findZoneByMeshName,
  getHighlightColor,
  resolveZoneHighlightStatus,
} from './stadium-model-bindings';
import type { StadiumZoneData } from '../stadium-map/zone-data';

describe('stadium-model-bindings', () => {
  it('validates all camera presets contain required coordinates and valid ranges', () => {
    const presetKeys = Object.keys(CAMERA_PRESETS);
    expect(presetKeys.length).toBe(5);

    for (const key of presetKeys) {
      const preset = CAMERA_PRESETS[key as keyof typeof CAMERA_PRESETS];
      expect(preset.position).toHaveLength(3);
      expect(preset.target).toHaveLength(3);
      expect(preset.position[1]).toBeGreaterThan(0); // Camera should stay above floor

      const camera = new THREE.PerspectiveCamera(40, 390 / 480, 0.1, 1000);
      camera.position.fromArray(preset.position);
      camera.lookAt(new THREE.Vector3().fromArray(preset.target));
      camera.updateMatrixWorld();
      const projectedTarget = new THREE.Vector3().fromArray(preset.target).project(camera);
      expect(Math.abs(projectedTarget.x)).toBeLessThan(0.001);
      expect(Math.abs(projectedTarget.y)).toBeLessThan(0.001);
      expect(projectedTarget.z).toBeGreaterThan(-1);
      expect(projectedTarget.z).toBeLessThan(1);
    }
  });

  it('maps existing zone IDs to model bindings with valid anchors and presets', () => {
    const fieldBinding = findZoneBinding('zone-field-sidelines');
    expect(fieldBinding).toBeDefined();
    expect(fieldBinding?.name).toContain('Field');
    expect(fieldBinding?.meshNames.length).toBeGreaterThan(0);
    expect(fieldBinding?.cameraPreset).toBe('field');

    const suiteBinding = findZoneBinding('zone-300-suites');
    expect(suiteBinding).toBeDefined();
    expect(suiteBinding?.name).toContain('Suites');
    expect(suiteBinding?.cameraPreset).toBe('premium');
  });

  it('returns undefined safely for unknown or empty zone IDs', () => {
    expect(findZoneBinding('')).toBeUndefined();
    expect(findZoneBinding('unknown-zone-xyz')).toBeUndefined();
  });

  it('finds zone bindings by matching mesh name case-insensitively', () => {
    const byExact = findZoneByMeshName('Field_GrassTurf');
    expect(byExact?.zoneId).toBe('zone-field-sidelines');

    const byLower = findZoneByMeshName('node_bowl_100_lower');
    expect(byLower?.zoneId).toBe('zone-concourse-service-areas');

    const bySuites = findZoneByMeshName('Suites_300_Glass');
    expect(bySuites?.zoneId).toBe('zone-300-suites');

    expect(findZoneByMeshName('unrelated_mesh_999')).toBeUndefined();
  });

  it('resolves operational highlight status according to operational states', () => {
    const mockZone: StadiumZoneData = {
      id: 'zone-test',
      name: 'Test Zone',
      code: 'TEST',
      level: '1',
      department: 'test',
      category: 'concourse_service_areas',
      unitsCount: 2,
      openCount: 2,
      alertCount: 0,
      units: [
        {
          id: 'u-1',
          code: 'U1',
          name: 'Unit 1',
          department: 'test',
          type: 'test',
          capacity: null,
          stadiumZone: null,
          level: '1',
          status: 'open',
        },
      ],
    };

    // When selected, always returns selected
    expect(resolveZoneHighlightStatus(mockZone, true)).toBe('selected');

    // Open units, 0 alerts -> ready
    expect(resolveZoneHighlightStatus(mockZone, false)).toBe('ready');

    // Incident -> critical
    const incidentZone: StadiumZoneData = {
      ...mockZone,
      units: [{ ...mockZone.units[0], status: 'incident' }],
    };
    expect(resolveZoneHighlightStatus(incidentZone, false)).toBe('critical');

    // Alerts -> attention or critical
    const alertZone: StadiumZoneData = {
      ...mockZone,
      alertCount: 1,
    };
    expect(resolveZoneHighlightStatus(alertZone, false)).toBe('attention');

    const highAlertZone: StadiumZoneData = {
      ...mockZone,
      alertCount: 4,
    };
    expect(resolveZoneHighlightStatus(highAlertZone, false)).toBe('critical');
  });

  it('computes correct emissive colors and intensities for all highlight statuses', () => {
    const selectedColor = getHighlightColor('selected');
    expect(selectedColor.colorHex).toBe('#00E5FF');
    expect(selectedColor.intensity).toBeGreaterThan(0.8);

    const normalColor = getHighlightColor('normal');
    expect(normalColor.intensity).toBe(0.0);

    const readyColor = getHighlightColor('ready');
    expect(readyColor.colorHex).toBe('#00E676');

    const criticalColor = getHighlightColor('critical');
    expect(criticalColor.colorHex).toBe('#D32F2F');
  });

  it('builds full zone highlight map without mutating original zone data', () => {
    const testZones: StadiumZoneData[] = [
      {
        id: 'zone-1',
        name: 'Zone 1',
        code: 'Z1',
        level: '1',
        department: 'dept',
        category: 'stadium_gates',
        unitsCount: 1,
        openCount: 1,
        alertCount: 0,
        units: [
          {
            id: 'u-z1',
            code: 'UZ1',
            name: 'Unit Z1',
            department: 'dept',
            type: 'gate',
            capacity: null,
            stadiumZone: null,
            level: '1',
            status: 'open',
          },
        ],
      },
      {
        id: 'zone-2',
        name: 'Zone 2',
        code: 'Z2',
        level: '2',
        department: 'dept',
        category: 'club_level',
        unitsCount: 1,
        openCount: 0,
        alertCount: 2,
        units: [],
      },
    ];

    const originalJson = JSON.stringify(testZones);
    const highlightStates = buildZoneHighlightStates(testZones, 'zone-1');

    // Verify immutability
    expect(JSON.stringify(testZones)).toBe(originalJson);

    // Verify output
    expect(highlightStates['zone-1'].status).toBe('selected');
    expect(highlightStates['zone-2'].status).toBe('attention');
  });
});
