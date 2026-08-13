import { describe, expect, it } from 'vitest';
import { resolveVenueSubscriptionStatus } from './subscription-status';
import type { PrismaService } from '../prisma/prisma.service';

describe('resolveVenueSubscriptionStatus', () => {
  it('returns active status for enterprise licensed venues', async () => {
    const result = await resolveVenueSubscriptionStatus({} as PrismaService, {
      venueId: 'v1',
      venueStatus: 'active',
    });
    expect(result).toBe('active');
  });
});
