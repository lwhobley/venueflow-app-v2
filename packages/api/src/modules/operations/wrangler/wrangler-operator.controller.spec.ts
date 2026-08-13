import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WranglerOperatorController } from './wrangler-operator.controller';

describe('WranglerOperatorController', () => {
  it('rejects manager-grade read planning from regular staff', async () => {
    const operator = { plan: vi.fn() };
    const controller = new WranglerOperatorController({} as never, operator as never);

    await expect(controller.plan({
      userId: 'user-staff-1', profileId: 'staff-1', fullName: 'Staff Member', venueId: 'venue-1', venueName: 'Venue',
      role: 'staff', allAccess: false, subscriptionStatus: 'active', trialEndsAt: null,
    }, { command: 'list all staff emails' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(operator.plan).not.toHaveBeenCalled();
  });

  it('rejects fabricated direct execute plans from regular staff', async () => {
    const operator = { execute: vi.fn() };
    const controller = new WranglerOperatorController({} as never, operator as never);

    await expect(controller.execute({
      userId: 'user-staff-1', profileId: 'staff-1', fullName: 'Staff Member', venueId: 'venue-1', venueName: 'Venue',
      role: 'staff', allAccess: false, subscriptionStatus: 'active', trialEndsAt: null,
    }, { plan: { tool: 'CREATE_RESERVATION', args: {} } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(operator.execute).not.toHaveBeenCalled();
  });
});
