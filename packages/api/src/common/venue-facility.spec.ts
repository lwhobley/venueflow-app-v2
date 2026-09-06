import { describe, expect, it, vi } from 'vitest';
import { ensurePairedFacility, organizationIdForPairedVenue } from './venue-facility';

function makeVenue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'venue-1',
    organizationId: 'org-1',
    name: 'Test Stadium',
    code: 'VW-ABCDEFGHJK',
    timezone: 'America/New_York',
    address: '1 Main St',
    latitude: 40.7,
    longitude: -74,
    stadiumCapacity: 50_000,
    ...overrides,
  } as any;
}

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function makeDb(facilityLookups: Array<{ id: string } | null>) {
  return {
    venue: { findUniqueOrThrow: vi.fn().mockResolvedValue(makeVenue()) },
    facility: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(facilityLookups.shift() ?? null)),
      create: vi.fn().mockResolvedValue({ id: 'venue-1' }),
    },
  } as any;
}

describe('ensurePairedFacility', () => {
  it('creates a Facility carrying the venue id so facilityId writes resolve', async () => {
    const db = makeDb([null]);

    await ensurePairedFacility(db, makeVenue());

    expect(db.facility.create).toHaveBeenCalledWith({
      data: {
        id: 'venue-1',
        organizationId: 'org-1',
        code: 'VW-ABCDEFGHJK',
        name: 'Test Stadium',
        timezone: 'America/New_York',
        address: '1 Main St',
        latitude: 40.7,
        longitude: -74,
        capacity: 50_000,
      },
    });
  });

  it('does nothing when the pair already exists', async () => {
    const db = makeDb([{ id: 'venue-1' }]);

    await ensurePairedFacility(db, makeVenue());

    expect(db.facility.create).not.toHaveBeenCalled();
  });

  it('treats a lost create race as success', async () => {
    const db = makeDb([null, { id: 'venue-1' }]);
    db.facility.create.mockRejectedValueOnce(uniqueViolation());

    await expect(ensurePairedFacility(db, makeVenue())).resolves.toBeUndefined();
    expect(db.facility.create).toHaveBeenCalledTimes(1);
  });

  it('falls back to a venue-derived code when the org already uses the venue code', async () => {
    const db = makeDb([null, null]);
    db.facility.create.mockRejectedValueOnce(uniqueViolation());

    await ensurePairedFacility(db, makeVenue());

    expect(db.facility.create).toHaveBeenCalledTimes(2);
    expect(db.facility.create.mock.calls[1][0].data).toMatchObject({ id: 'venue-1', code: 'venue-venue-1' });
  });

  it('propagates errors that are not unique violations', async () => {
    const db = makeDb([null]);
    db.facility.create.mockRejectedValueOnce(new Error('connection lost'));

    await expect(ensurePairedFacility(db, makeVenue())).rejects.toThrow('connection lost');
  });
});

describe('organizationIdForPairedVenue', () => {
  it('returns the organization and guarantees the pair', async () => {
    const db = makeDb([null]);

    await expect(organizationIdForPairedVenue(db, 'venue-1')).resolves.toBe('org-1');
    expect(db.facility.create).toHaveBeenCalledTimes(1);
  });

  it('throws for an unknown venue rather than inventing an organization', async () => {
    const db = makeDb([null]);
    db.venue.findUniqueOrThrow.mockRejectedValueOnce(Object.assign(new Error('No Venue found'), { code: 'P2025' }));

    await expect(organizationIdForPairedVenue(db, 'missing')).rejects.toThrow('No Venue found');
    expect(db.facility.create).not.toHaveBeenCalled();
  });
});
