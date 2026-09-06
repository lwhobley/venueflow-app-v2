import type { StadiumZoneData } from '../stadium-map/zone-data';
import type {
  CameraPreset,
  CameraPresetId,
  OperationalHighlightStatus,
  StadiumZoneModelBinding,
  ZoneHighlightState,
} from './stadium-3d.types';

export const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: {
    id: 'overview',
    label: 'Overview',
    icon: 'stadium-outline',
    description: 'Full bowl isometric architectural view',
    position: [28, 24, 36],
    target: [0, 2, 0],
  },
  exterior: {
    id: 'exterior',
    label: 'Exterior',
    icon: 'door-sliding',
    description: 'Main entrance gates and facade towers',
    position: [0, 16, 54],
    target: [0, 4, 15],
  },
  field: {
    id: 'field',
    label: 'Field',
    icon: 'football',
    description: 'Pitch level, player benches and endzones',
    position: [0, 4.5, 22],
    target: [0, 1, 0],
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    icon: 'crown-outline',
    description: 'Club 200 terraces and 300/400 luxury suites',
    position: [-22, 10, 16],
    target: [-6, 4, 0],
  },
  concourse: {
    id: 'concourse',
    label: 'Concourse',
    icon: 'storefront-outline',
    description: 'Level 100 food & beverage service areas',
    position: [0, 9, -32],
    target: [0, 2, -10],
  },
};

/**
 * Names given to the procedural bowl the canvas builds when the GLB cannot
 * load. They are bound to zones exactly like the asset's own meshes so the
 * fallback stays tappable, and living here keeps the two sides in step.
 */
export const PROCEDURAL_MESH_NAMES = {
  turf: 'Field_GrassTurf',
  endzoneNorth: 'Endzone_North_Texans',
  endzoneSouth: 'Endzone_South_Texans',
  bowl100: 'Bowl_100_LowerNavy',
  bowl200: 'Bowl_200_ClubNavy',
  suites300: 'Suites_300_Balcony',
  upperBowl: 'Bowl_500_UpperRed',
  gateFord: 'Gate_Ford_Tower',
  gateKroger: 'Gate_Kroger_Tower',
} as const;

export const STADIUM_ZONE_MODEL_BINDINGS: StadiumZoneModelBinding[] = [
  {
    zoneId: 'zone-field-sidelines',
    name: 'Field Level & Sidelines',
    level: '0',
    category: 'field_sidelines',
    meshNames: [
      'Node_Field_GrassTurf',
      'Node_Endzone_North',
      'Node_Endzone_South',
      'Node_Sideline_W',
      'Node_Sideline_E',
      'Node_Endline_N',
      'Node_Endline_S',
      'Node_Wall_W',
      'Node_Wall_E',
      'Node_Wall_N',
      'Node_Wall_S',
      'Node_Bench_Home',
      'Node_Bench_Away',
      'Node_Logo_Base',
      'Node_Logo_RedHorn',
      'Node_Logo_WhiteStar',
      // Procedural fallback geometry, which uses its own names.
      PROCEDURAL_MESH_NAMES.turf,
      PROCEDURAL_MESH_NAMES.endzoneNorth,
      PROCEDURAL_MESH_NAMES.endzoneSouth,
    ],
    // Field markings and goal posts sit on top of the turf; without these a tap
    // on a yard line or an endzone letter selected nothing at all.
    meshPrefixes: ['Node_TurfBand_', 'Node_YardLine_', 'Node_EZ_Letter_', 'Node_GP_'],
    anchor: [0, 0.4, 0],
    cameraPreset: 'field',
    colorHex: '#00E5FF',
  },
  {
    zoneId: 'zone-concourse-service-areas',
    name: 'Concourse 100 Service Areas',
    level: '1',
    category: 'concourse_service_areas',
    meshNames: [
      'Node_Bowl_100_Lower',
      'Node_Concourse_100',
      PROCEDURAL_MESH_NAMES.bowl100,
    ],
    anchor: [0, 2.5, -6],
    cameraPreset: 'concourse',
    colorHex: '#FFA000',
  },
  {
    zoneId: 'zone-concourse-bunkers',
    name: 'VIP Field Bunkers',
    level: '1',
    category: 'concourse_bunkers',
    // This asset has no bunker geometry. Use the Operations Map/directory.
    meshNames: [],
    anchor: [0, 1.2, -11.5],
    cameraPreset: 'field',
    colorHex: '#69F0AE',
  },
  {
    zoneId: 'zone-200-club',
    name: 'Club Level 200',
    level: '2',
    category: 'club_level',
    meshNames: [
      'Node_Bowl_200_Club',
      'Node_Ribbon_LED',
      PROCEDURAL_MESH_NAMES.bowl200,
    ],
    anchor: [10, 3.4, 0],
    cameraPreset: 'premium',
    colorHex: '#00E5FF',
  },
  {
    zoneId: 'zone-300-suites',
    name: 'Luxury Executive Suites 300',
    level: '3',
    category: 'luxury_suites',
    meshNames: [
      'Node_Suites_300_Balcony',
      'Node_Suites_300_Glass',
      PROCEDURAL_MESH_NAMES.suites300,
    ],
    anchor: [-10.8, 4.4, 0],
    cameraPreset: 'premium',
    colorHex: '#FFD700',
  },
  {
    zoneId: 'zone-400-upper',
    name: '400 Upper Deck Concourse & Skyline Bars',
    level: '4',
    category: 'upper_deck',
    meshNames: [
      'Node_Suites_400_Balcony',
      'Node_Suites_400_Glass',
      'Node_Bowl_500_UpperRed',
      'Node_Upper_Rim',
      PROCEDURAL_MESH_NAMES.upperBowl,
    ],
    // The video boards and their pillars rise out of this deck, so a tap on the
    // most obvious landmark in the scene resolves to a zone rather than nothing.
    meshPrefixes: ['Node_Jumbotron_', 'Node_Jumbo_Pillar_'],
    anchor: [0, 6.4, 13.5],
    cameraPreset: 'overview',
    colorHex: '#B71C1C',
  },
  {
    zoneId: 'zone-stadium-gates',
    name: 'Main Entry Gates',
    level: '1',
    category: 'stadium_gates',
    meshNames: [
      'Node_Plaza_Ground',
      'Node_Ext_Wall_W',
      'Node_Ext_Glass_W',
      'Node_Ext_Wall_E',
      'Node_Ext_Glass_E',
      PROCEDURAL_MESH_NAMES.gateFord,
      PROCEDURAL_MESH_NAMES.gateKroger,
    ],
    // Every gate tower and its sponsor sign, without naming all eight.
    meshPrefixes: ['Node_Gate_'],
    anchor: [0, 3.0, -14],
    cameraPreset: 'exterior',
    colorHex: '#004B87',
  },
  {
    zoneId: 'zone-locker-rooms-aux',
    name: 'Team Lockers & Auxiliary Suites',
    level: '0',
    category: 'locker_rooms_aux',
    // This asset has no locker-room geometry. Use the Operations Map/directory.
    meshNames: [],
    anchor: [-7, 0.4, -6],
    cameraPreset: 'field',
    colorHex: '#7B1FA2',
  },
];

export function findZoneBinding(zoneId: string): StadiumZoneModelBinding | undefined {
  if (!zoneId) return undefined;
  return STADIUM_ZONE_MODEL_BINDINGS.find((b) => b.zoneId === zoneId);
}

/**
 * GLTF nodes in this asset are exported as `Node_<name>`, while the procedural
 * fallback names its meshes bare. Comparing on the un-prefixed, lower-cased
 * name means a binding entry written either way resolves against either source.
 */
function normalizeMeshName(meshName: string): string {
  return meshName.toLowerCase().replace(/^node_/, '');
}

export function findZoneByMeshName(meshName: string): StadiumZoneModelBinding | undefined {
  if (!meshName) return undefined;
  const normalized = normalizeMeshName(meshName);
  return STADIUM_ZONE_MODEL_BINDINGS.find(
    (b) =>
      b.meshNames.some((m) => normalizeMeshName(m) === normalized) ||
      (b.meshPrefixes ?? []).some((prefix) => normalized.startsWith(normalizeMeshName(prefix)))
  );
}

export function resolveZoneHighlightStatus(
  zone: StadiumZoneData | undefined,
  isSelected: boolean
): OperationalHighlightStatus {
  if (!zone) return 'normal';

  const hasIncident = zone.units.some((u) => u.status === 'incident');
  if (hasIncident) return 'critical';

  if (zone.alertCount > 0) {
    return zone.alertCount >= 3 ? 'critical' : 'attention';
  }

  const hasRestricted = zone.units.some((u) => u.status === 'restricted');
  if (hasRestricted) return 'watch';

  const hasPendingReplenish = zone.units.some((u) => Boolean(u.suiteDetails?.replenishmentPending));
  if (hasPendingReplenish) return 'attention';
  if (isSelected) return 'selected';

  const hasActiveOrders = zone.units.some(
    (u) =>
      Boolean(u.suiteDetails?.inSuiteOrders && u.suiteDetails.inSuiteOrders.length > 0) ||
      Boolean(u.standDetails?.inSeatOrders && u.standDetails.inSeatOrders.length > 0)
  );
  if (hasActiveOrders) return 'watch';

  if (zone.openCount > 0) return 'ready';

  return 'normal';
}

export function getHighlightColor(status: OperationalHighlightStatus): {
  colorHex: string;
  emissiveColor: string;
  intensity: number;
} {
  switch (status) {
    case 'selected':
      return { colorHex: '#00E5FF', emissiveColor: '#00E5FF', intensity: 0.9 };
    case 'critical':
      return { colorHex: '#D32F2F', emissiveColor: '#FF1744', intensity: 0.85 };
    case 'attention':
      return { colorHex: '#F57C00', emissiveColor: '#FF6D00', intensity: 0.75 };
    case 'watch':
      return { colorHex: '#FFB300', emissiveColor: '#FFC107', intensity: 0.65 };
    case 'ready':
      return { colorHex: '#00E676', emissiveColor: '#00C853', intensity: 0.55 };
    case 'normal':
    default:
      return { colorHex: '#90A4AE', emissiveColor: '#000000', intensity: 0.0 };
  }
}

/**
 * One label per status, so the legend, the zone card and the accessible zone
 * list all describe a glowing zone with the same word. They previously carried
 * three separate colour tables and two vocabularies.
 */
export const HIGHLIGHT_STATUS_LABELS: Record<OperationalHighlightStatus, string> = {
  selected: 'Selected',
  critical: 'Critical alert',
  attention: 'Attention needed',
  watch: 'In service',
  ready: 'Operational ready',
  normal: 'Idle',
};

/** The statuses the on-canvas legend explains, in escalation order. */
export const LEGEND_STATUSES: OperationalHighlightStatus[] = [
  'ready',
  'watch',
  'critical',
  'selected',
];

export function buildZoneHighlightStates(
  zones: StadiumZoneData[],
  selectedZoneId: string | null
): Record<string, ZoneHighlightState> {
  const result: Record<string, ZoneHighlightState> = {};

  for (const zone of zones) {
    const isSelected = selectedZoneId === zone.id;
    const status = resolveZoneHighlightStatus(zone, isSelected);
    const { emissiveColor, intensity } = getHighlightColor(status);

    result[zone.id] = {
      zoneId: zone.id,
      status,
      alertCount: zone.alertCount ?? 0,
      openUnitsCount: zone.openCount ?? 0,
      totalUnitsCount: zone.unitsCount ?? zone.units.length,
      emissiveColor,
      emissiveIntensity: intensity,
    };
  }

  return result;
}
