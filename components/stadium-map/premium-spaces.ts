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

/** Unit types that represent a premium hospitality space rather than a general one. */
const PREMIUM_UNIT_TYPES = new Set([
  'premium_suite',
  'club_lounge',
  'premium_lounge',
  'party_suite',
  'endzone_lounge',
  'concourse_bunker',
]);

function isPremiumUnitType(unit: StadiumZoneItem): boolean {
  return PREMIUM_UNIT_TYPES.has(unit.type) || unit.type.includes('club');
}

/**
 * Resolves the stadium level a premium unit sits on, preferring explicit
 * `stadiumLevel` metadata and falling back to the unit's suite number or
 * its raw `level` value so records without metadata still group sensibly.
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
 * Categorizes an individual unit into a premium space group identifier.
 *
 * Explicit `premiumCategory` metadata is authoritative. Everything after it is
 * a compatibility fallback for units that carry no grouping metadata, and is
 * deliberately conservative: a unit must look like a premium space by type or
 * sit in a known premium zone before a level alone will place it in a group.
 */
export function classifyPremiumSpace(
  unit: StadiumZoneItem,
  zoneId?: string,
): PremiumGroupDescriptor | null {
  const suiteNumber = parseInt(unit.suiteDetails?.suiteNumber ?? '0', 10);

  // 1. Explicit metadata wins outright.
  if (unit.premiumCategory) {
    const group = GROUP_BY_CATEGORY[unit.premiumCategory];
    return { ...group, level: resolveSuiteLevel(unit, suiteNumber) };
  }

  // ── Fallbacks for untagged records ──────────────────────────────────────
  if (unit.displayGroup === 'event_spaces' || unit.type === 'party_suite') {
    return {
      ...GROUP_BY_CATEGORY.party_suites,
      level: resolveSuiteLevel(unit, suiteNumber),
    };
  }

  if (unit.displayGroup === 'premium' || unit.type === 'premium_lounge') {
    return {
      ...GROUP_BY_CATEGORY.premium_lounges,
      level: resolveSuiteLevel(unit, suiteNumber),
    };
  }

  const isFounders = Boolean(
    unit.suiteDetails?.tier?.toLowerCase().includes('founder') ||
      unit.suiteDetails?.tier?.toLowerCase().includes('commissioner'),
  );

  if (isFounders) {
    return {
      ...GROUP_BY_CATEGORY.founders_suites,
      level: resolveSuiteLevel(unit, suiteNumber),
    };
  }

  const is300Suite =
    unit.type === 'premium_suite' &&
    (unit.level === '3' || unit.stadiumLevel === '300' || (suiteNumber >= 300 && suiteNumber < 400));

  if (is300Suite) {
    return { ...GROUP_BY_CATEGORY['300_suites'], level: '300' };
  }

  const is400Suite =
    unit.type === 'premium_suite' &&
    (unit.level === '4' || unit.stadiumLevel === '400' || (suiteNumber >= 400 && suiteNumber < 500));

  if (is400Suite) {
    return { ...GROUP_BY_CATEGORY['400_suites'], level: '400' };
  }

  // Level alone is not enough: the unit must also look like a premium space.
  const is200Club =
    zoneId === 'zone-200-club' ||
    unit.type === 'club_lounge' ||
    ((unit.level === '2' || unit.stadiumLevel === '200') && isPremiumUnitType(unit));

  if (is200Club) {
    return { ...GROUP_BY_CATEGORY['200_clubs'], level: '200' };
  }

  const is100Club =
    zoneId === 'zone-concourse-bunkers' ||
    unit.type === 'concourse_bunker' ||
    ((unit.level === '1' || unit.stadiumLevel === '100') && isPremiumUnitType(unit));

  if (is100Club) {
    return { ...GROUP_BY_CATEGORY['100_clubs'], level: '100' };
  }

  const isFieldSuite =
    unit.type === 'endzone_lounge' ||
    (unit.type === 'premium_suite' && (unit.level === '0' || unit.stadiumLevel === 'Field'));

  if (isFieldSuite) {
    return { ...GROUP_BY_CATEGORY.field_suites, level: 'Field' };
  }

  return null;
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
      const classification = classifyPremiumSpace(unit, zone.id);
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
