import { describe, it, expect } from 'vitest';
import { zonedWallClockToUtc, zonedIsoDate } from './venue-time';

describe('zonedWallClockToUtc', () => {
  it('resolves a local shift time to the correct UTC instant', () => {
    // 18:00 in Los Angeles on 2026-09-12 is PDT (UTC-7) => 01:00Z the next day.
    const ts = zonedWallClockToUtc('America/Los_Angeles', '2026-09-12', '18:00');
    expect(new Date(ts).toISOString()).toBe('2026-09-13T01:00:00.000Z');
  });

  it('is not the naive UTC reading of the same wall clock', () => {
    const zoned = zonedWallClockToUtc('America/Los_Angeles', '2026-09-12', '18:00');
    const naive = Date.parse('2026-09-12T18:00:00Z');
    // Seven hours apart — the gap that made the no-show sweep fire early.
    expect(zoned - naive).toBe(7 * 3600 * 1000);
  });

  it('handles a zone ahead of UTC', () => {
    // 09:00 in Tokyo (UTC+9, no DST) => 00:00Z the same day.
    const ts = zonedWallClockToUtc('Asia/Tokyo', '2026-09-12', '09:00');
    expect(new Date(ts).toISOString()).toBe('2026-09-12T00:00:00.000Z');
  });

  it('stays correct either side of a DST transition', () => {
    // US DST ended 2026-11-01. 12:00 local is UTC-7 before, UTC-8 after.
    const before = zonedWallClockToUtc('America/Los_Angeles', '2026-10-31', '12:00');
    const after = zonedWallClockToUtc('America/Los_Angeles', '2026-11-02', '12:00');
    expect(new Date(before).toISOString()).toBe('2026-10-31T19:00:00.000Z');
    expect(new Date(after).toISOString()).toBe('2026-11-02T20:00:00.000Z');
  });

  it('treats an unknown timezone as UTC rather than throwing', () => {
    const ts = zonedWallClockToUtc('Not/AZone', '2026-09-12', '18:00');
    expect(new Date(ts).toISOString()).toBe('2026-09-12T18:00:00.000Z');
  });

  it('falls back to midnight for an unparseable clock', () => {
    const ts = zonedWallClockToUtc('UTC', '2026-09-12', 'not-a-time');
    expect(new Date(ts).toISOString()).toBe('2026-09-12T00:00:00.000Z');
  });

  it('round-trips back to the same local calendar date', () => {
    const ts = zonedWallClockToUtc('America/Los_Angeles', '2026-09-12', '23:30');
    expect(zonedIsoDate('America/Los_Angeles', ts)).toBe('2026-09-12');
  });
});
