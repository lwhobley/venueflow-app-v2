import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StadiumZoneItem } from '../StadiumUnitDetailModal';
import type { StadiumZoneData } from './zone-data';

/** Icon glyph names accepted by MaterialCommunityIcons, the icon set already used by the stadium map. */
export type PremiumGroupIconName = keyof typeof MaterialCommunityIcons.glyphMap;

export interface PremiumSpaceGroup {
  id: string;
  title: string;
  level: string;
  icon: PremiumGroupIconName;
  units: StadiumZoneItem[];
  alertCount: number;
}

export type PremiumStatusLabel = 'Ready' | 'Attention' | 'In Service' | 'Restricted' | 'Closed';
export type PremiumStatusTone = 'good' | 'warn' | 'danger' | 'neutral' | 'info';

export interface UnitStatusInfo {
  label: PremiumStatusLabel;
  tone: PremiumStatusTone;
  color: string;
  accessibilityText: string;
}

/**
 * Resolves the operational status badge for a stadium unit based on
 * genuine operational and BEO data.
 */
export function resolveUnitStatus(unit: StadiumZoneItem): UnitStatusInfo {
  if (unit.status === 'incident') {
    return {
      label: 'Attention',
      tone: 'danger',
      color: '#D32F2F',
      accessibilityText: 'Attention needed, incident reported',
    };
  }

  if (unit.suiteDetails?.replenishmentPending) {
    return {
      label: 'Attention',
      tone: 'warn',
      color: '#E65100',
      accessibilityText: 'Attention needed, catering replenishment pending',
    };
  }

  if (
    unit.suiteDetails?.inSuiteOrders &&
    unit.suiteDetails.inSuiteOrders.length > 0 &&
    unit.suiteDetails.inSuiteOrders.some((o) => o.status === 'delivering' || o.status === 'preparing')
  ) {
    return {
      label: 'In Service',
      tone: 'info',
      color: '#0288D1',
      accessibilityText: 'In Service, orders actively being delivered or prepped',
    };
  }

  if (unit.status === 'restricted') {
    return {
      label: 'Restricted',
      tone: 'neutral',
      color: '#757575',
      accessibilityText: 'Restricted access',
    };
  }

  if (unit.status === 'closed') {
    return {
      label: 'Closed',
      tone: 'neutral',
      color: '#9E9E9E',
      accessibilityText: 'Closed',
    };
  }

  // Default active / open with BEO or general readiness
  return {
    label: 'Ready',
    tone: 'good',
    color: '#2E7D32',
    accessibilityText: 'Ready for service',
  };
}

export interface PremiumGroupDescriptor {
  groupId: string;
  groupTitle: string;
  level: string;
  icon: PremiumGroupIconName;
}

type PremiumCategory = NonNullable<StadiumZoneItem['premiumCategory']>;

/**
 * The authoritative category -> display group mapping. A unit tagged with
 * `premiumCategory` is classified from this table alone; the heuristics below
 * exist only for records that predate the metadata.
 */
const GROUP_BY_CATEGORY: Record<
  PremiumCategory,
  { groupId: string; groupTitle: string; icon: PremiumGroupIconName }
> = {
  founders_suites: {
    groupId: 'owner-founders-suites',
    groupTitle: 'Owner / Founders Suites',
    icon: 'crown',
  },
  '300_suites': {
    groupId: '300-level-suites',
    groupTitle: '300 Level Suites',
    icon: 'glass-cocktail',
  },
  '400_suites': {
    groupId: '400-level-suites',
    groupTitle: '400 Level Suites',
    icon: 'seat-individual-suite',
  },
  '200_clubs': {
    groupId: '200-level-clubs',
    groupTitle: 'Club Level',
    icon: 'trophy-award',
  },
  '100_clubs': {
    groupId: '100-level-clubs',
    groupTitle: '100 Level Clubs',
    icon: 'shield-star-outline',
  },
  field_suites: {
    groupId: 'field-level-suites',
    groupTitle: 'Field-Level Suites',
    icon: 'stadium-variant',
  },
  party_suites: {
    groupId: 'party-suites-event-spaces',
    groupTitle: 'Party Suites & Event Spaces',
    icon: 'party-popper',
  },
  premium_lounges: {
    groupId: 'private-clubs-premium-lounges',
    groupTitle: 'Private Clubs & Premium Lounges',
    icon: 'shield-crown',
  },
};

/**
 * Unit types that represent a premium hospitality space.
 *
 * Not used for classification — that is driven entirely by `premiumCategory`.
 * This is exported so data-integrity checks can assert that every premium
 * record actually carries the metadata the directory depends on.
 */
export const PREMIUM_UNIT_TYPES = new Set([
  'premium_suite',
  'club_lounge',
  'premium_lounge',
  'party_suite',
  'endzone_lounge',
  'concourse_bunker',
]);

export function isPremiumUnitType(unit: StadiumZoneItem): boolean {
  return PREMIUM_UNIT_TYPES.has(unit.type);
}

/**
 * Resolves the stadium level a premium unit sits on, preferring explicit
 * `stadiumLevel` metadata and falling back to the unit's suite number or its
 * raw `level` value, so a tagged unit still reports a level when the optional
 * `stadiumLevel` field is absent.
 */
function resolveSuiteLevel(unit: StadiumZoneItem, suiteNumber: number): string {
  if (unit.stadiumLevel) return unit.stadiumLevel;
  if (suiteNumber >= 100 && suiteNumber < 600) {
    return `${Math.floor(suiteNumber / 100)}00`;
  }
  if (unit.level && unit.level !== '0') return `${unit.level}00`;
  return 'Field';
}

/**
 * Categorizes an individual unit into a premium space group.
 *
 * Classification is driven solely by the unit's `premiumCategory` metadata: a
 * unit without it is not a premium space and belongs to no group. Units must
 * therefore be tagged in the zone data to appear in the directory.
 */
export function classifyPremiumSpace(unit: StadiumZoneItem): PremiumGroupDescriptor | null {
  if (!unit.premiumCategory) return null;

  const suiteNumber = parseInt(unit.suiteDetails?.suiteNumber ?? '0', 10);
  return {
    ...GROUP_BY_CATEGORY[unit.premiumCategory],
    level: resolveSuiteLevel(unit, suiteNumber),
  };
}

/**
 * Pure function to group premium spaces from stadium zone data by stadium level.
 *
 * Requirements:
 * - Groups units into compact collapsible sections (e.g., 300 Level Suites, Club Level, etc.)
 * - Filters out any group with 0 units
 * - Preserves immutability and stable IDs
 * - Computes genuine alert counts
 */
export function groupPremiumSpaces(zones: StadiumZoneData[]): PremiumSpaceGroup[] {
  const groupMap = new Map<
    string,
    {
      id: string;
      title: string;
      level: string;
      icon: PremiumGroupIconName;
      units: StadiumZoneItem[];
      alertCount: number;
    }
  >();

  // Defined display groups in preferred elevation ordering
  const GROUP_ORDER = [
    'owner-founders-suites',
    '300-level-suites',
    '200-level-clubs',
    '400-level-suites',
    '100-level-clubs',
    'field-level-suites',
    'party-suites-event-spaces',
    'private-clubs-premium-lounges',
  ];

  for (const zone of zones) {
    for (const unit of zone.units) {
      const classification = classifyPremiumSpace(unit);
      if (!classification) continue;

      let existing = groupMap.get(classification.groupId);
      if (!existing) {
        existing = {
          id: classification.groupId,
          title: classification.groupTitle,
          level: classification.level,
          icon: classification.icon,
          units: [],
          alertCount: 0,
        };
        groupMap.set(classification.groupId, existing);
      }

      existing.units.push(unit);

      const status = resolveUnitStatus(unit);
      if (status.label === 'Attention') {
        existing.alertCount += 1;
      }
    }
  }

  // Sort groups according to defined elevation order and exclude empty groups
  const sortedGroups: PremiumSpaceGroup[] = [];
  for (const groupId of GROUP_ORDER) {
    const grp = groupMap.get(groupId);
    if (grp && grp.units.length > 0) {
      // Sort units by suite number or code within group
      const sortedUnits = [...grp.units].sort((a, b) => {
        const numA = parseInt(a.suiteDetails?.suiteNumber ?? '0', 10);
        const numB = parseInt(b.suiteDetails?.suiteNumber ?? '0', 10);
        if (numA && numB) return numA - numB;
        return a.code.localeCompare(b.code);
      });

      sortedGroups.push({
        ...grp,
        units: sortedUnits,
      });
    }
  }

  // Include any custom dynamically created groups not in GROUP_ORDER
  for (const [gId, grp] of groupMap.entries()) {
    if (!GROUP_ORDER.includes(gId) && grp.units.length > 0) {
      sortedGroups.push(grp);
    }
  }

  return sortedGroups;
}
