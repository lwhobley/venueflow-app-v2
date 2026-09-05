import type { StadiumZoneItem } from '../StadiumUnitDetailModal';
import type { StadiumZoneData } from './zone-data';

export interface PremiumSpaceGroup {
  id: string;
  title: string;
  level: string;
  icon: string;
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

/**
 * Categorizes an individual unit into a premium space group identifier.
 */
export function classifyPremiumSpace(
  unit: StadiumZoneItem,
  zoneId?: string,
): {
  groupId: string;
  groupTitle: string;
  level: string;
  icon: string;
} | null {
  // Explicit override takes precedence
  if (unit.displayGroup === 'event_spaces' || unit.type === 'party_suite') {
    return {
      groupId: 'party-suites-event-spaces',
      groupTitle: 'Party Suites & Event Spaces',
      level: unit.level ?? '3',
      icon: 'party-popper',
    };
  }

  if (unit.displayGroup === 'premium' || unit.type === 'premium_lounge') {
    return {
      groupId: 'private-clubs-premium-lounges',
      groupTitle: 'Private Clubs & Premium Lounges',
      level: unit.level ?? '2',
      icon: 'shield-crown',
    };
  }

  // 1. Owner / Founders Suites
  const isFounders =
    unit.premiumCategory === 'founders_suites' ||
    Boolean(
      unit.suiteDetails?.tier?.toLowerCase().includes('founder') ||
        unit.suiteDetails?.tier?.toLowerCase().includes('commissioner'),
    );

  if (isFounders) {
    return {
      groupId: 'owner-founders-suites',
      groupTitle: 'Owner / Founders Suites',
      level: '300',
      icon: 'crown',
    };
  }

  const suiteNumber = parseInt(unit.suiteDetails?.suiteNumber ?? '0', 10);

  // 2. 300 Level Suites
  const is300Suite =
    unit.premiumCategory === '300_suites' ||
    (unit.type === 'premium_suite' && (unit.level === '3' || unit.stadiumLevel === '300' || (suiteNumber >= 300 && suiteNumber < 400)));

  if (is300Suite) {
    return {
      groupId: '300-level-suites',
      groupTitle: '300 Level Suites',
      level: '300',
      icon: 'glass-cocktail',
    };
  }

  // 3. 400 Level Suites
  const is400Suite =
    unit.premiumCategory === '400_suites' ||
    (unit.type === 'premium_suite' && (unit.level === '4' || unit.stadiumLevel === '400' || (suiteNumber >= 400 && suiteNumber < 500)));

  if (is400Suite) {
    return {
      groupId: '400-level-suites',
      groupTitle: '400 Level Suites',
      level: '400',
      icon: 'seat-individual-suite',
    };
  }

  // 4. 200 Level Clubs / Club Level
  const is200Club =
    unit.premiumCategory === '200_clubs' ||
    zoneId === 'zone-200-club' ||
    unit.type === 'club_lounge' ||
    unit.level === '2' ||
    unit.stadiumLevel === '200';

  if (is200Club) {
    return {
      groupId: '200-level-clubs',
      groupTitle: 'Club Level',
      level: '200',
      icon: 'trophy-award',
    };
  }

  // 5. 100 Level Clubs
  const is100Club =
    unit.premiumCategory === '100_clubs' ||
    zoneId === 'zone-concourse-bunkers' ||
    unit.type === 'concourse_bunker' ||
    (unit.level === '1' && unit.type.includes('club'));

  if (is100Club) {
    return {
      groupId: '100-level-clubs',
      groupTitle: '100 Level Clubs',
      level: '100',
      icon: 'shield-star-outline',
    };
  }

  // 6. Field-Level Suites / Field VIP Lounges
  const isFieldSuite =
    unit.premiumCategory === 'field_suites' ||
    unit.type === 'endzone_lounge' ||
    unit.id === 'u-aux-headliner' ||
    (unit.type === 'premium_suite' && (unit.level === '0' || unit.stadiumLevel === 'Field'));

  if (isFieldSuite) {
    return {
      groupId: 'field-level-suites',
      groupTitle: 'Field-Level Suites',
      level: 'Field',
      icon: 'stadium-variant',
    };
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
      icon: string;
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
