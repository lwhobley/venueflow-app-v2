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
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue(
        options?.session ?? {
          userId: 'user-1',
          expiresAt: new Date(Date.now() + 60_000),
          tokenHash: TOKEN_HASH,
        },
      ),
    },
    profile: {
      findUnique: vi.fn().mockResolvedValue(
        options && 'profile' in options
          ? options.profile
          : {
              id: 'profile-live',
              email: 'live@example.com',
              fullName: 'Live User',
              role: 'staff',
              allAccess: false,
              trialEndsAt: new Date('2026-01-01T00:00:00Z'),
              venueId: 'venue-live',
              venue: { name: 'Live Venue', subscriptionStatus: 'active' },
            },
      ),
      findFirst: vi.fn().mockImplementation((args: any) => prisma.profile.findUnique(args)),
    },
  } as any;
  return { guard: new AuthGuard(jwt, reflector, prisma), prisma, jwt };
}

describe('AuthGuard', () => {
  it('refreshes request claims from the live profile before controllers run', async () => {
    const { guard, prisma } = makeGuard();
    const context = makeContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-1' } }));
    expect(prisma.profile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }));
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
