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

export const STADIUM_ZONE_MODEL_BINDINGS: StadiumZoneModelBinding[] = [
  {
    zoneId: 'zone-field-sidelines',
    name: 'Field Level & Sidelines',
    level: '0',
    category: 'field_sidelines',
    meshNames: [
      'Field_GrassTurf',
      'Endzone_North_Texans',
      'Endzone_South_Texans',
      'Field_Sideline_W',
      'Field_Sideline_E',
      'Bench_Texans_Home',
      'Bench_Visiting_Away',
      'Node_Field_GrassTurf',
      'Node_Endzone_North',
      'Node_Endzone_South',
      'ZONE_field',
    ],
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
      'Bowl_100_LowerNavy',
      'Concourse_100_Ring',
      'Node_Bowl_100_Lower',
      'Node_Concourse_100',
      'ZONE_lower_bowl',
      'ZONE_north_concourse',
      'ZONE_south_concourse',
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
    meshNames: [
      'Bunker_North',
      'Bunker_South',
      'Node_Bunker_North',
      'Node_Bunker_South',
      'ZONE_premium_club',
    ],
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
      'Bowl_200_ClubNavy',
      'Ribbon_LED_Board',
      'Node_Bowl_200_Club',
      'Node_Ribbon_LED',
      'ZONE_club_level',
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
      'Suites_300_Balcony',
      'Suites_300_Glass',
      'Node_Suites_300_Balcony',
      'Node_Suites_300_Glass',
      'ZONE_suites_300',
    ],
    anchor: [-10.8, 4.4, 0],
    cameraPreset: 'premium',
    colorHex: '#FFD700',
  },
  {
    zoneId: 'zone-upper-deck',
    name: 'Upper Deck 500/600',
    level: '5',
    category: 'upper_deck',
    meshNames: [
      'Suites_400_Balcony',
      'Suites_400_Glass',
      'Bowl_500_UpperRed',
      'Upper_Concourse_Rim',
      'Node_Bowl_500_UpperRed',
      'Node_Upper_Rim',
      'ZONE_suites_400',
    ],
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
      'Gate_Ford_Tower',
      'Gate_Kroger_Tower',
      'Gate_Phillips66_Tower',
      'Gate_Xfinity_Tower',
      'Gate_Ford_Badge',
      'Gate_Kroger_Badge',
      'Node_Gate_Ford_Tower',
      'ZONE_main_gate',
    ],
    anchor: [0, 3.0, -14],
    cameraPreset: 'exterior',
    colorHex: '#004B87',
  },
  {
    zoneId: 'zone-locker-rooms-aux',
    name: 'Team Lockers & Auxiliary Suites',
    level: '0',
    category: 'locker_rooms_aux',
    meshNames: [
      'Bench_Texans_Home',
      'Bench_Visiting_Away',
      'Node_Bench_Home',
      'Node_Bench_Away',
      'ZONE_commissary_boh',
    ],
    anchor: [-7, 0.4, -6],
    cameraPreset: 'field',
    colorHex: '#7B1FA2',
  },
  {
    zoneId: 'zone-commissary-boh',
    name: 'Central Commissary & Logistics',
    level: '0',
    category: 'commissary_boh',
    meshNames: [
      'Plaza_GroundSlab',
      'Exterior_Wall_West',
      'Node_Plaza_Ground',
      'ZONE_loading_dock',
    ],
    anchor: [-14, 1.0, 0],
    cameraPreset: 'concourse',
    colorHex: '#455A64',
  },
];

export function findZoneBinding(zoneId: string): StadiumZoneModelBinding | undefined {
  if (!zoneId) return undefined;
  return STADIUM_ZONE_MODEL_BINDINGS.find((b) => b.zoneId === zoneId);
}

export function findZoneByMeshName(meshName: string): StadiumZoneModelBinding | undefined {
  if (!meshName) return undefined;
  const lowerMesh = meshName.toLowerCase();
  return STADIUM_ZONE_MODEL_BINDINGS.find((b) =>
    b.meshNames.some((m) => {
      const lowerM = m.toLowerCase();
      return lowerMesh.includes(lowerM) || lowerM.includes(lowerMesh);
    })
  );
}

export function resolveZoneHighlightStatus(
  zone: StadiumZoneData | undefined,
  isSelected: boolean
): OperationalHighlightStatus {
  if (isSelected) return 'selected';
  if (!zone) return 'normal';

  if (zone.alertCount > 0) {
    return zone.alertCount >= 3 ? 'critical' : 'attention';
  }

  const hasIncident = zone.units.some((u) => u.status === 'incident');
  if (hasIncident) return 'critical';

  const hasRestricted = zone.units.some((u) => u.status === 'restricted');
  if (hasRestricted) return 'watch';

  const hasPendingReplenish = zone.units.some((u) => Boolean(u.suiteDetails?.replenishmentPending));
  if (hasPendingReplenish) return 'attention';

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
