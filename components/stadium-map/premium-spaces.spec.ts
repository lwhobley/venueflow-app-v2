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
