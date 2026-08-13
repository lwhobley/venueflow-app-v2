import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WranglerController } from './wrangler.controller';

describe('WranglerController', () => {
  it('does not expose manager service data to regular staff', async () => {
    const controller = new WranglerController({} as never, {} as never, {} as never, {} as never);

    await expect(controller.getWrangler({
      userId: 'user-staff-1', profileId: 'staff-1', fullName: 'Staff Member', venueId: 'venue-1', venueName: 'Venue',
      role: 'staff', allAccess: false, subscriptionStatus: 'active', trialEndsAt: null,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
