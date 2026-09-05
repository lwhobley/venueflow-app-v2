import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { getTenantVenueId, runWithoutTenant } from '../prisma/tenant-context';
import { AuthGuard } from './auth.guard';

const TOKEN_HASH = createHash('sha256').update('token-1').digest('hex');

function makeContext(token: string, venueId?: string) {
  const request = {
    headers: { authorization: `Bearer ${token}`, ...(venueId ? { 'x-venue-id': venueId } : {}) },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

const DEFAULT_PROFILE_ROW = {
  id: 'profile-live',
  email: 'live@example.com',
  fullName: 'Live User',
  role: 'staff',
  allAccess: false,
  trialEndsAt: new Date('2026-01-01T00:00:00Z'),
  venueId: 'venue-live',
  venueName: 'Live Venue',
  venueSubscriptionStatus: 'active',
  venueOrganizationId: 'org-live',
};

function makeGuard(options?: {
  payload?: any;
  session?: any;
  profile?: any;
  isPublic?: boolean;
}) {
  const jwt = {
    verifyAsync: vi.fn().mockResolvedValue(
      options?.payload ?? {
        sub: 'user-1',
        sid: 'session-1',
        email: 'token@example.com',
        name: 'Token User',
        profileId: 'profile-stale',
        venueId: 'venue-stale',
        role: 'owner',
        allAccess: true,
      },
    ),
  } as any;
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(options?.isPublic ?? false),
  } as any;
  // AuthGuard reads its two pre-tenant-context lookups via
  // `this.prisma.$queryRaw` against the app_private.auth_lookup_* SECURITY
  // DEFINER functions (see auth.guard.ts and migration 20260903140000), not
  // plain model calls — mock at that boundary and dispatch on which RPC the
  // tagged-template SQL text names.
  const sessionCall = vi.fn();
  const profileCall = vi.fn();
  const queryRaw = vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('');
    if (sql.includes('auth_lookup_session')) {
      sessionCall(...values);
      const session = 'session' in (options ?? {}) ? options!.session : {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        tokenHash: TOKEN_HASH,
      };
      return Promise.resolve(session ? [session] : []);
    }
    if (sql.includes('auth_lookup_profiles')) {
      profileCall(...values);
      const [, venueId] = values;
      const profile = options && 'profile' in options ? options.profile : DEFAULT_PROFILE_ROW;
      if (!profile) return Promise.resolve([]);
      if (venueId && profile.venueId !== venueId) return Promise.resolve([]);
      return Promise.resolve([profile]);
    }
    throw new Error(`Unexpected $queryRaw call in AuthGuard test: ${sql}`);
  });
  const prisma = { $queryRaw: queryRaw } as any;
  return { guard: new AuthGuard(jwt, reflector, prisma), prisma, jwt, sessionCall, profileCall };
}

describe('AuthGuard', () => {
  it('refreshes request claims from the live profile before controllers run', async () => {
    const { guard, sessionCall, profileCall } = makeGuard();
    const context = makeContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionCall).toHaveBeenCalledWith('session-1');
    // The default JWT payload carries a stale venueId ('venue-stale') that
    // doesn't match DEFAULT_PROFILE_ROW's venue ('venue-live'), so the first
    // profile lookup misses and AuthGuard's own stale-JWT fallback (no venue
    // filter) finds it on the second call — exercising that fallback path is
    // the point, not a specific call count.
    expect(profileCall).toHaveBeenCalledWith('user-1', 'venue-stale');
    expect(profileCall).toHaveBeenCalledWith('user-1', null);
    expect(context.switchToHttp().getRequest().user).toMatchObject({
      email: 'live@example.com',
      name: 'Live User',
      profileId: 'profile-live',
      venueId: 'venue-live',
      venueName: 'Live Venue',
      role: 'staff',
      allAccess: false,
      venueStatus: 'active',
    });
  });

  it('clears privilege claims when the live profile is missing', async () => {
    const { guard } = makeGuard({ profile: null });
    const context = makeContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest().user).toMatchObject({
      profileId: undefined,
      role: undefined,
      allAccess: false,
      venueId: null,
    });
  });

  it('rejects an explicit venue without an active membership and never binds it', async () => {
    const { guard } = makeGuard({ profile: null });

    await runWithoutTenant(async () => {
      await expect(guard.canActivate(makeContext('token-1', 'venue-foreign'))).rejects.toThrow(
        'You do not have an active membership at the requested venue.',
      );
      expect(getTenantVenueId()).toBeUndefined();
    });
  });

  it('rejects when a stored token hash does not match the presented bearer token', async () => {
    const { guard } = makeGuard({
      session: {
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
        tokenHash: 'wrong-hash',
      },
    });

    await expect(guard.canActivate(makeContext('token-1'))).rejects.toThrow('Session is no longer valid. Please sign in again.');
  });
});
