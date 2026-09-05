import { describe, expect, it } from 'vitest';
import {
  groupPremiumSpaces,
  resolveUnitStatus,
  classifyPremiumSpace,
} from './premium-spaces';
import { COMPREHENSIVE_STADIUM_ZONES, type StadiumZoneData } from './zone-data';
import type { StadiumZoneItem } from '../StadiumUnitDetailModal';

describe('Premium Spaces Pure Grouping Logic', () => {
  it('groups actual stadium zones into distinct level-based premium space groups', () => {
    const groups = groupPremiumSpaces(COMPREHENSIVE_STADIUM_ZONES);

    // Ensure groups exist
    expect(groups.length).toBeGreaterThanOrEqual(4);

    const groupIds = groups.map((g) => g.id);
    const groupTitles = groups.map((g) => g.title);

    // Must include 300 Level Suites and 400 Level Suites as distinct groups
    expect(groupIds).toContain('300-level-suites');
    expect(groupIds).toContain('400-level-suites');
    expect(groupTitles).toContain('300 Level Suites');
    expect(groupTitles).toContain('400 Level Suites');

    // Must include Club Level
    expect(groupIds).toContain('200-level-clubs');
    expect(groupTitles).toContain('Club Level');

    // Must include Owner / Founders Suites
    expect(groupIds).toContain('owner-founders-suites');
    expect(groupTitles).toContain('Owner / Founders Suites');

    // 300 Level and 400 Level should not share units
    const group300 = groups.find((g) => g.id === '300-level-suites');
    const group400 = groups.find((g) => g.id === '400-level-suites');

    expect(group300?.units.length).toBeGreaterThan(0);
    expect(group400?.units.length).toBeGreaterThan(0);

    const units300Ids = new Set(group300?.units.map((u) => u.id));
    const units400Ids = new Set(group400?.units.map((u) => u.id));

    for (const id of units300Ids) {
      expect(units400Ids.has(id)).toBe(false);
    }
  });

  it('never outputs groups with zero units', () => {
    const emptyZone: StadiumZoneData[] = [
      {
        id: 'zone-empty',
        name: 'Empty Zone',
        code: 'EMPTY',
        level: '1',
        department: 'hospitality',
        category: 'luxury_suites',
        unitsCount: 0,
        openCount: 0,
        alertCount: 0,
        units: [],
      },
    ];

    const groups = groupPremiumSpaces(emptyZone);
    expect(groups).toEqual([]);
    for (const group of groups) {
      expect(group.units.length).toBeGreaterThan(0);
    }
  });

  it('preserves array immutability and stable IDs', () => {
    const inputCopy = JSON.parse(JSON.stringify(COMPREHENSIVE_STADIUM_ZONES));
    const groups = groupPremiumSpaces(COMPREHENSIVE_STADIUM_ZONES);

    // Does not mutate the original data
    expect(COMPREHENSIVE_STADIUM_ZONES).toEqual(inputCopy);

    // Check that all groups have non-empty, unique, stable string IDs
    const ids = groups.map((g) => g.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('separates club spaces from suites', () => {
    const groups = groupPremiumSpaces(COMPREHENSIVE_STADIUM_ZONES);
    const clubGroup = groups.find((g) => g.id === '200-level-clubs');
    const suiteGroup = groups.find((g) => g.id === '300-level-suites');

    expect(clubGroup).toBeDefined();
    expect(suiteGroup).toBeDefined();

    // Club group must contain the club lounges
    const clubUnitCodes = clubGroup?.units.map((u) => u.code);
    expect(clubUnitCodes).toContain('CLUB-EAST');
    expect(clubUnitCodes).toContain('CLUB-WEST');

    // Suite group must contain luxury suites
    const suiteUnitCodes = suiteGroup?.units.map((u) => u.code);
    expect(suiteUnitCodes).not.toContain('CLUB-EAST');
    expect(suiteUnitCodes).not.toContain('CLUB-WEST');
  });

  it('aggregates alerts only from units genuinely requiring attention', () => {
    const testZones: StadiumZoneData[] = [
      {
        id: 'zone-test',
        name: 'Test Zone',
        code: 'TEST',
        level: '3',
        department: 'hospitality',
        category: 'luxury_suites',
        unitsCount: 3,
        openCount: 2,
        alertCount: 1,
        units: [
          {
            id: 'unit-normal-1',
            code: 'S-301',
            name: 'Suite 301',
            department: 'hospitality',
            type: 'premium_suite',
            capacity: 20,
            stadiumZone: 'West',
            level: '3',
            status: 'open',
          },
          {
            id: 'unit-incident-2',
            code: 'S-302',
            name: 'Suite 302',
            department: 'hospitality',
            type: 'premium_suite',
            capacity: 20,
            stadiumZone: 'West',
            level: '3',
            status: 'incident',
          },
          {
            id: 'unit-replenish-3',
            code: 'S-303',
            name: 'Suite 303',
            department: 'hospitality',
            type: 'premium_suite',
            capacity: 20,
            stadiumZone: 'West',
            level: '3',
            status: 'open',
            suiteDetails: {
              suiteNumber: '303',
              replenishmentPending: true,
            },
          },
        ],
      },
    ];

    const groups = groupPremiumSpaces(testZones);
    const suiteGroup = groups.find((g) => g.id === '300-level-suites');

    expect(suiteGroup).toBeDefined();
    expect(suiteGroup?.units.length).toBe(3);
    // Suite 302 (incident) and Suite 303 (replenishmentPending) = 2 alerts
    expect(suiteGroup?.alertCount).toBe(2);
  });

  it('does not classify a non-premium unit as a club on stadium level alone', () => {
    const concourseStand: StadiumZoneItem = {
      id: 'unit-level2-stand',
      code: 'SVC-201',
      name: 'Level 200 Concourse Taco Stand',
      department: 'concessions',
      type: 'concourse_service_area',
      capacity: null,
      stadiumZone: 'East Concourse 200',
      level: '2',
      status: 'open',
    };

    // Sits on level 2 but is not a premium space, so it belongs to no group.
    expect(classifyPremiumSpace(concourseStand)).toBeNull();

    const clubLounge: StadiumZoneItem = {
      ...concourseStand,
      id: 'unit-level2-club',
      code: 'CLUB-N',
      name: 'North Club Lounge',
      type: 'club_lounge',
    };

    expect(classifyPremiumSpace(clubLounge)?.groupId).toBe('200-level-clubs');
  });

  it('still groups untagged legacy records through the fallback heuristics', () => {
    const untaggedSuite: StadiumZoneItem = {
      id: 'unit-legacy-318',
      code: 'SUITE-318',
      name: 'Suite 318',
      department: 'premium_hospitality',
      type: 'premium_suite',
      capacity: 22,
      stadiumZone: 'West Suite Tower Level 3',
      level: '3',
      status: 'open',
      suiteDetails: { suiteNumber: '318' },
    };

    // No premiumCategory / stadiumLevel: the compatibility path must still work.
    expect(untaggedSuite.premiumCategory).toBeUndefined();
    expect(classifyPremiumSpace(untaggedSuite)?.groupId).toBe('300-level-suites');
  });

  it('tags every premium unit in the venue data with grouping metadata', () => {
    const untagged: string[] = [];
    let premiumUnits = 0;

    for (const zone of COMPREHENSIVE_STADIUM_ZONES) {
      for (const unit of zone.units) {
        if (!classifyPremiumSpace(unit, zone.id)) {
          // Non-premium units (gates, concessions, locker rooms) stay untagged.
          expect(unit.premiumCategory).toBeUndefined();
          continue;
        }
        premiumUnits += 1;
        if (!unit.premiumCategory || !unit.stadiumLevel) untagged.push(unit.code);
      }
    }

    expect(premiumUnits).toBeGreaterThan(0);
    expect(untagged).toEqual([]);
  });

  it('classifies premium units from explicit metadata rather than hardcoded ids', () => {
    const foundersUnit: StadiumZoneItem = {
      id: 'unit-founders-metadata',
      code: 'S-350',
      name: 'Founders Skybox',
      department: 'premium_hospitality',
      type: 'premium_suite',
      capacity: 24,
      stadiumZone: 'West Suite Tower',
      level: '3',
      stadiumLevel: '300',
      premiumCategory: 'founders_suites',
      status: 'open',
    };

    // No `tier` string to match on: metadata alone must drive the grouping.
    const founders = classifyPremiumSpace(foundersUnit);
    expect(founders?.groupId).toBe('owner-founders-suites');
    expect(founders?.level).toBe('300');

    const fieldUnit: StadiumZoneItem = {
      id: 'unit-field-metadata',
      code: 'GREEN-A',
      name: 'Field-Level Green Room',
      department: 'entertainment_hospitality',
      type: 'aux_performer_room',
      capacity: 25,
      stadiumZone: 'Tunnel Level Backstage',
      level: '0',
      stadiumLevel: 'Field',
      premiumCategory: 'field_suites',
      status: 'restricted',
    };

    const field = classifyPremiumSpace(fieldUnit);
    expect(field?.groupId).toBe('field-level-suites');
  });

  it('derives founders suite level from the suite number when metadata is absent', () => {
    const legacyFounders: StadiumZoneItem = {
      id: 'unit-legacy-founders',
      code: 'S-425',
      name: 'Suite 425',
      department: 'premium_hospitality',
      type: 'premium_suite',
      capacity: 18,
      stadiumZone: 'Upper Suite Tower',
      level: '4',
      status: 'open',
      suiteDetails: { suiteNumber: '425', tier: 'Founders Suite' },
    };

    const result = classifyPremiumSpace(legacyFounders);
    expect(result?.groupId).toBe('owner-founders-suites');
    // Level comes from the 400-series suite number, not a hardcoded '300'.
    expect(result?.level).toBe('400');
  });
});

describe('resolveUnitStatus helper', () => {
  it('identifies incident status as Attention with danger tone', () => {
    const unit: StadiumZoneItem = {
      id: 'u-1',
      code: 'S-1',
      name: 'Suite 1',
      department: 'hospitality',
      type: 'premium_suite',
      capacity: 20,
      stadiumZone: 'West',
      level: '3',
      status: 'incident',
    };

    const status = resolveUnitStatus(unit);
    expect(status.label).toBe('Attention');
    expect(status.tone).toBe('danger');
    expect(status.color).toBe('#D32F2F');
  });

  it('identifies pending orders as In Service with info tone', () => {
    const unit: StadiumZoneItem = {
      id: 'u-2',
      code: 'S-2',
      name: 'Suite 2',
      department: 'hospitality',
      type: 'premium_suite',
      capacity: 20,
      stadiumZone: 'West',
      level: '3',
      status: 'open',
      suiteDetails: {
        suiteNumber: '302',
        inSuiteOrders: [
          {
            id: 'ord-1',
            orderedAt: '12:00 PM',
            orderedBy: 'Host',
            items: 'Tenders and soda',
            totalCents: 4500,
            status: 'delivering',
          },
        ],
      },
    };

    const status = resolveUnitStatus(unit);
    expect(status.label).toBe('In Service');
    expect(status.tone).toBe('info');
  });

  it('identifies ready units with good tone', () => {
    const unit: StadiumZoneItem = {
      id: 'u-3',
      code: 'S-3',
      name: 'Suite 3',
      department: 'hospitality',
      type: 'premium_suite',
      capacity: 20,
      stadiumZone: 'West',
      level: '3',
      status: 'open',
    };

    const status = resolveUnitStatus(unit);
    expect(status.label).toBe('Ready');
    expect(status.tone).toBe('good');
  });
});

describe('Single-open Accordion Behavior Logic', () => {
  it('toggling a collapsed group opens it and collapses previous group', () => {
    let expandedGroupId: string | null = null;

    const toggle = (groupId: string) => {
      expandedGroupId = expandedGroupId === groupId ? null : groupId;
    };

    // Initial tap on 300 Level Suites
    toggle('300-level-suites');
    expect(expandedGroupId).toBe('300-level-suites');

    // Tap on Club Level expands Club Level and collapses 300 Level
    toggle('200-level-clubs');
    expect(expandedGroupId).toBe('200-level-clubs');

    // Tapping Club Level again collapses it
    toggle('200-level-clubs');
    expect(expandedGroupId).toBeNull();
  });
});
