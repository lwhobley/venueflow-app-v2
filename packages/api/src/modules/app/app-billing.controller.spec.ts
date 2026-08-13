import { describe, expect, it, vi } from 'vitest';
import { AppBillingController } from './app-billing.controller';

function makeController() {
  const prisma: any = {
    subscription: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const profiles = {
    getProfile: vi.fn(),
  };

  const controller = new AppBillingController(prisma, profiles as any);
  return { controller, prisma, profiles };
}

const user = { sub: 'user-1' } as any;

describe('AppBillingController', () => {
  describe('getMyVenueBilling', () => {
    it('returns null when the caller has no venue profile', async () => {
      const { controller, profiles } = makeController();
      profiles.getProfile.mockResolvedValue(null);
      await expect(controller.getMyVenueBilling(user)).resolves.toBeNull();
    });

    it('returns enterprise active billing tier when profile exists', async () => {
      const { controller, profiles } = makeController();
      profiles.getProfile.mockResolvedValue({ id: 'p1', venueId: 'venue-1' });
      const res = await controller.getMyVenueBilling(user);
      expect(res).toMatchObject({
        venueId: 'venue-1',
        status: 'active',
        platform: 'enterprise',
        planId: 'enterprise_licensed',
      });
    });
  });

  describe('createStripeCheckout', () => {
    it('returns enterprise response', async () => {
      const { controller } = makeController();
      const res = await controller.createStripeCheckout(user);
      expect(res).toMatchObject({
        url: '/(tabs)/home',
      });
    });
  });

  describe('createStripePortal', () => {
    it('returns enterprise response', async () => {
      const { controller } = makeController();
      const res = await controller.createStripePortal(user);
      expect(res).toMatchObject({
        url: '/settings/billing',
      });
    });
  });
});
