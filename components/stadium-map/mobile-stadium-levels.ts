import type { StadiumZoneData } from './zone-data';

export type MobileStadiumLevelId = 'field' | '100' | '200' | '300' | '400';

export const MOBILE_STADIUM_LEVELS: ReadonlyArray<{
  id: MobileStadiumLevelId;
  label: string;
  shortLabel: string;
  description: string;
  zoneIds: readonly string[];
}> = [
  {
    id: 'field',
    label: 'Field & Service Level',
    shortLabel: 'Field',
    description: 'Sidelines, endzones, lockers and performer spaces',
    zoneIds: ['zone-field-sidelines', 'zone-locker-rooms-aux'],
  },
  {
    id: '100',
    label: 'Level 100',
    shortLabel: '100',
    description: 'Entry gates, concourse outlets and field clubs',
    zoneIds: ['zone-stadium-gates', 'zone-concourse-service-areas', 'zone-concourse-bunkers'],
  },
  {
    id: '200',
    label: 'Level 200 · Clubs',
    shortLabel: '200',
    description: 'Club lounges and premium terraces',
    zoneIds: ['zone-200-club'],
  },
  {
    id: '300',
    label: 'Level 300 · Suites',
    shortLabel: '300',
    description: 'Luxury suites, skyboxes and event spaces',
    zoneIds: ['zone-300-suites'],
  },
  {
    id: '400',
    label: 'Level 400 · Upper Deck',
    shortLabel: '400',
    description: 'Upper concourse and grandstand service areas',
    zoneIds: ['zone-400-upper'],
  },
];

export function getMobileLevelSpaces(zones: StadiumZoneData[], levelId: MobileStadiumLevelId) {
  const level = MOBILE_STADIUM_LEVELS.find((candidate) => candidate.id === levelId);
  if (!level) return [];

  return level.zoneIds.flatMap((zoneId) => zones.find((zone) => zone.id === zoneId)?.units ?? []);
}

export function getMobileLevelForZone(zoneId?: string): MobileStadiumLevelId {
  return MOBILE_STADIUM_LEVELS.find((level) => level.zoneIds.includes(zoneId ?? ''))?.id ?? '100';
}
