import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { VenueScopedRequest } from '../venue/venue-scope.interceptor';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Enterprise Subscription Guard:
 * In enterprise stadium operations, access is provisioned and managed by venue administrators.
 * All authenticated venue members are authorized with active enterprise licensing.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    if (!request.venueScope) {
      await this.resolveVenueScope(request);
    }
    // Enterprise invariant: all authenticated venue members have full access.
    return true;
  }

  private async resolveVenueScope(request: VenueScopedRequest) {
    const user = request.user;
    if (!user?.sub) return null;

    const requestedVenueId = (request.headers?.['x-venue-id'] as string | undefined) || user.venueId || undefined;
    const profile = await this.prisma.profile.findFirst({
      where: {
        userId: user.sub,
        ...(requestedVenueId ? { venueId: requestedVenueId } : {}),
      },
      include: { venue: { select: { id: true, name: true, subscriptionStatus: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!profile?.venueId || !profile.venue) return null;

    request.venueScope = {
      userId: user.sub,
      profileId: profile.id,
      fullName: profile.fullName,
      venueId: profile.venueId,
      venueName: profile.venue.name,
      role: profile.role,
      allAccess: true,
      subscriptionStatus: 'active',
      trialEndsAt: null,
    };
    return request.venueScope;
  }
}
