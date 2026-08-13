import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { VenueScopeInterceptor } from './venue-scope.interceptor';

function contextFor(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('VenueScopeInterceptor', () => {
  it('does not authorize a second venue after the guard resolves no active scope', async () => {
    const prisma = { profile: { findFirst: vi.fn() } } as any;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const interceptor = new VenueScopeInterceptor(prisma, reflector);
    const request: any = { user: { sub: 'user-1' }, headers: { 'x-venue-id': 'venue-foreign' } };
    const next = { handle: vi.fn(() => of('ok')) };

    const observable = await interceptor.intercept(contextFor(request), next);
    expect(observable).toBeDefined();
    expect(prisma.profile.findFirst).not.toHaveBeenCalled();
    expect(request.venueScope).toBeUndefined();
  });

  it('uses exactly the profile and venue resolved by AuthGuard', async () => {
    const profile = {
      id: 'profile-1', fullName: 'Manager', venueId: 'venue-1', role: 'manager', allAccess: false,
      membershipStatus: 'active', trialEndsAt: null,
      venue: { id: 'venue-1', name: 'Venue', subscriptionStatus: 'active' },
    };
    const prisma = {
      profile: { findFirst: vi.fn().mockResolvedValue(profile) },
      subscription: { findFirst: vi.fn().mockResolvedValue(null) },
    } as any;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any;
    const interceptor = new VenueScopeInterceptor(prisma, reflector);
    const request: any = { user: { sub: 'user-1', profileId: 'profile-1', venueId: 'venue-1' }, headers: {} };
    const next = { handle: vi.fn(() => of('ok')) };

    const observable = await interceptor.intercept(contextFor(request), next);
    expect(request.venueScope).toMatchObject({ venueId: 'venue-1', profileId: 'profile-1' });
    expect(prisma.profile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'profile-1', venueId: 'venue-1' }) }));
    expect(observable).toBeDefined();
  });
});
