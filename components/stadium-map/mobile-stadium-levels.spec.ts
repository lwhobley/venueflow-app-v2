import { describe, expect, it } from 'vitest';
import { COMPREHENSIVE_STADIUM_ZONES } from './zone-data';
import {
  MOBILE_STADIUM_LEVELS,
  getMobileLevelForZone,
  getMobileLevelSpaces,
} from './mobile-stadium-levels';

describe('mobile stadium levels', () => {
  it('assigns every stadium zone to exactly one mobile level', () => {
    const assignedZoneIds = MOBILE_STADIUM_LEVELS.flatMap((level) => level.zoneIds);
    expect(new Set(assignedZoneIds).size).toBe(assignedZoneIds.length);
    expect(new Set(assignedZoneIds)).toEqual(new Set(COMPREHENSIVE_STADIUM_ZONES.map((zone) => zone.id)));
  });

  it('shows clubs and suites as compact level lists', () => {
    expect(getMobileLevelSpaces(COMPREHENSIVE_STADIUM_ZONES, '200').every((unit) => unit.level === '2')).toBe(true);
    expect(getMobileLevelSpaces(COMPREHENSIVE_STADIUM_ZONES, '300').some((unit) => unit.suiteDetails)).toBe(true);
  });

  it('resolves an initial zone to its level and defaults to level 100', () => {
    expect(getMobileLevelForZone('zone-300-suites')).toBe('300');
    expect(getMobileLevelForZone('unknown')).toBe('100');
  });
});
