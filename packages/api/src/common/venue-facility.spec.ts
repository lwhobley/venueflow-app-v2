import { describe, expect, it, vi } from 'vitest';
import { organizationIdForPairedVenue } from './venue-facility';

describe('organizationIdForPairedVenue', () => {
  const venue = {
    id: 'venue-1',
    organizationId: 'org-1',
    name: 'North Room',
    code: 'VW-NORTHROOM',
    timezone: 'America/Chicago',
    address: '1 Main',
    latitude: 29.76,
    longitude: -95.36,
    stadiumCapacity: 18000,
  };

  it('returns the organization id when a paired facility already exists', async () => {
    const db = {
      venue: { findUniqueOrThrow: vi.fn().mockResolvedValue(venue) },
      facility: {
        findUnique: vi.fn().mockResolvedValue({ id: venue.id }),
        create: vi.fn(),
      },
    };

    await expect(organizationIdForPairedVenue(db as any, venue.id)).resolves.toBe('org-1');
    expect(db.facility.create).not.toHaveBeenCalled();
  });

  it('creates a same-id facility when the venue is missing one', async () => {
    const db = {
      venue: { findUniqueOrThrow: vi.fn().mockResolvedValue(venue) },
      facility: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: venue.id }),
      },
    };

    await expect(organizationIdForPairedVenue(db as any, venue.id)).resolves.toBe('org-1');
    expect(db.facility.create).toHaveBeenCalledWith({
      data: {
        id: 'venue-1',
        organizationId: 'org-1',
        code: 'VW-NORTHROOM',
        name: 'North Room',
        timezone: 'America/Chicago',
        address: '1 Main',
        latitude: 29.76,
        longitude: -95.36,
        capacity: 18000,
        active: true,
      },
    });
  });
});
