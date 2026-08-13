import { describe, expect, it, vi } from 'vitest';
import { SubscriptionGuard } from './subscription.guard';

function makeContext(venueScope: unknown, user?: unknown) {
  const request = { venueScope, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

function makeGuard() {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) } as any;
  const prisma = {} as any;
  return new SubscriptionGuard(reflector, prisma);
}

const scope = (subscriptionStatus: string | null = 'active', allAccess = true) => ({
  profileId: 'p1',
  fullName: 'Admin',
  venueId: 'v1',
  venueName: 'Stadium Venue',
  role: 'manager',
  allAccess,
  subscriptionStatus,
  trialEndsAt: null,
});

describe('SubscriptionGuard', () => {
  it('allows access to all routes for enterprise venue members', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext(scope('active')))).resolves.toBe(true);
  });

  it('authorizes authenticated enterprise users', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext(scope('active', true)))).resolves.toBe(true);
  });
});
