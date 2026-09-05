import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { enterTenant } from '../prisma/tenant-context';
import { tenantIsolationEnforced } from '../prisma/tenant-isolation-config';

export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  sid?: string;
  profileId?: string;
  venueId?: string | null;
  venueName?: string | null;
  organizationId?: string | null;
  allAccess?: boolean;
  trialEndsAt?: string | null;
  venueStatus?: string | null;
};

export type AuthenticatedRequest = Request & {
  user?: AuthUser;
};

// Session lookup queries the database directly to ensure instant revocation
// across all replicas when a session is invalidated (e.g. logout).
// The Supabase Postgres pooler handles this efficiently.

type SessionBootstrapRow = { userId: string; expiresAt: Date; tokenHash: string | null };

type ProfileBootstrapRow = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  allAccess: boolean;
  trialEndsAt: Date | null;
  venueId: string | null;
  venueName: string | null;
  venueSubscriptionStatus: string | null;
  venueOrganizationId: string | null;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  // These two lookups run BEFORE any tenant context exists — they are what
  // DISCOVERS the venueId in the first place, so no app.venue_id GUC can be
  // bound yet. Session/User/Profile/Venue all carry RLS; Session and User
  // have no stadium_api policy at all (they're global, not tenant-owned —
  // see VENUE_SCOPED_MODELS in tenant-scope.ts), and Profile's/Venue's own
  // policies require the very venueId this lookup exists to determine. Under
  // a future NOBYPASSRLS stadium_api runtime role, plain Prisma calls here
  // would return zero rows for every request. Routed through the narrow
  // SECURITY DEFINER functions from migration 20260903140000 instead — see
  // that migration's comment and docs/rls-cutover-runbook.md. Verified
  // end-to-end against a real NOBYPASSRLS role locally: these two calls (and
  // only these) work with zero GUCs bound, while every other table stays
  // fail-closed until the tenant context below is resolved and bound.
  // Behaves identically under today's bypass role too (SECURITY DEFINER does
  // not require caller privilege), so this is a single code path, not a
  // cutover-only branch.
  private async lookupSession(sessionId: string): Promise<SessionBootstrapRow | null> {
    const rows = await this.prisma.$queryRaw<SessionBootstrapRow[]>`
      SELECT * FROM app_private.auth_lookup_session(${sessionId})
    `;
    return rows[0] ?? null;
  }

  private async lookupProfiles(userId: string, venueId?: string): Promise<ProfileBootstrapRow[]> {
    return this.prisma.$queryRaw<ProfileBootstrapRow[]>`
      SELECT * FROM app_private.auth_lookup_profiles(${userId}, ${venueId ?? null})
    `;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER ?? 'venue-wrangler-enterprise',
        audience: process.env.JWT_AUDIENCE ?? 'venue-wrangler-mobile',
      });
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Token is missing a subject claim');
    }

    // Every accepted token must be backed by a revocable Session row. This lets
    // logout, password reset, and account deletion invalidate access
    // immediately instead of waiting for JWT expiry.
    if (!payload.sid) {
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }
    const now = Date.now();
    const row = await this.lookupSession(payload.sid);
    const session = row
      ? { userId: row.userId, expiresAt: row.expiresAt.getTime(), tokenHash: row.tokenHash }
      : null;

    if (!session || session.userId !== payload.sub || session.expiresAt <= now) {
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }
    if (session.tokenHash) {
      const provided = createHash('sha256').update(token).digest();
      let expected: Buffer;
      try {
        expected = Buffer.from(session.tokenHash, 'hex');
      } catch {
        expected = Buffer.alloc(0);
      }
      if (expected.length !== provided.length || !timingSafeEqual(provided, expected)) {
        throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
      }
    } else {
      // A session row without a stored token hash cannot prove token
      // possession, so treat it as invalid rather than skipping the check.
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }

    const rawVenueHeader = request.headers?.['x-venue-id'];
    const headerVenueId = typeof rawVenueHeader === 'string' && rawVenueHeader.trim()
      ? rawVenueHeader.trim()
      : undefined;
    const requestedVenueId = headerVenueId || payload.venueId || undefined;
    // lookupProfiles already applies the same filters the old Prisma query did
    // (userId match, membershipStatus null-or-active, ordered by createdAt
    // asc) — see migration 20260903140000. venueId filtering, when
    // requestedVenueId is set, happens inside the RPC too; take the first row.
    let liveProfile: ProfileBootstrapRow | null = (await this.lookupProfiles(payload.sub, requestedVenueId))[0] ?? null;
    if (!liveProfile && headerVenueId) {
      throw new ForbiddenException('You do not have an active membership at the requested venue.');
    }
    // A stale JWT may reference a venue the user has since left. With no
    // explicit venue request, fall back only to another verified active
    // membership so normal account recovery and venue switching remain usable.
    if (!liveProfile && !headerVenueId && requestedVenueId) {
      const rows = await this.lookupProfiles(payload.sub);
      liveProfile = rows.find((p) => p.venueId !== null) ?? null;
    }
    // Privilege claims come only from the live profile. When the profile row is
    // gone, clear role/allAccess/profileId rather than trusting stale JWT fields
    // (venueId already cleared to null in that case).
    const resolvedUser: AuthUser = {
      ...payload,
      email: liveProfile?.email ?? payload.email,
      name: liveProfile?.fullName ?? payload.name,
      profileId: liveProfile?.id,
      role: liveProfile?.role,
      allAccess: liveProfile?.allAccess ?? false,
      trialEndsAt: liveProfile?.trialEndsAt?.toISOString() ?? null,
      venueId: liveProfile?.venueId ?? null,
      venueName: liveProfile?.venueName ?? null,
      organizationId: liveProfile?.venueOrganizationId ?? null,
      venueStatus: liveProfile?.venueSubscriptionStatus ?? null,
    };

    request.user = resolvedUser;

    // Bind tenant context for the rest of the request. Inert unless the env
    // flag is on AND a verified active profile carries a venueId (auth flows, webhooks, and
    // venueless system tasks legitimately have none and remain unscoped).
    // Never bind the raw header/JWT claim. A tenant context is derived only
    // from the live membership row loaded above.
    const tenantVenueId = resolvedUser.venueId;
    if (tenantIsolationEnforced() && tenantVenueId) {
      enterTenant({
        venueId: tenantVenueId,
        facilityId: tenantVenueId,
        organizationId: resolvedUser.organizationId ?? undefined,
        userId: resolvedUser.sub,
      });
    }

    return true;
  }

  private getBearerToken(request: Request): string | null {
    const header = request.headers?.authorization;
    if (header) {
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token) return token;
    }
    // Intentionally do not accept tokens from query strings. Query tokens leak
    // into access logs, Referer headers, browser history, and shared URLs.
    return null;
  }
}
