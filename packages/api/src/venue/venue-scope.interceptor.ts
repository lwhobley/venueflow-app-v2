import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { resolveVenueSubscriptionStatus } from '../billing/subscription-status';
import { bindAiUsageContext } from '../common/ai-usage-context';
import { SKIP_VENUE_SCOPE_KEY } from './skip-venue-scope.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type VenueScopedRequest = AuthenticatedRequest & {
  venueScope?: {
    userId: string;
    profileId: string;
    fullName: string;
    venueId: string;
    venueName: string;
    role: string;
    allAccess: boolean;
    subscriptionStatus: string | null;
    trialEndsAt: Date | null;
  };
};

@Injectable()
export class VenueScopeInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VENUE_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    if (skip) return next.handle();

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    if (request.venueScope) {
      return bindAiUsageContext(
        { venueId: request.venueScope.venueId, profileId: request.venueScope.profileId, prisma: this.prisma },
        () => next.handle(),
      );
    }

    const user = request.user;
    if (!user?.sub) return next.handle();
    const rawVenueHeader = request.headers['x-venue-id'];
    const requestedVenueId = typeof rawVenueHeader === 'string' && rawVenueHeader.trim()
      ? rawVenueHeader.trim()
      : undefined;

    let profile;
    if (requestedVenueId) {
      profile = await this.prisma.profile.findFirst({
        where: {
          userId: user.sub,
          venueId: requestedVenueId,
          OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
        },
        include: { venue: { select: { id: true, name: true, subscriptionStatus: true } } },
      });
      if (!profile) {
        throw new ForbiddenException('You do not have an active membership at the requested venue.');
      }
    }
    if (!requestedVenueId) {
      profile = await this.prisma.profile.findFirst({
        where: {
          userId: user.sub,
          venueId: { not: null },
          OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
        },
        include: { venue: { select: { id: true, name: true, subscriptionStatus: true } } },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!profile?.venueId || !profile.venue) return next.handle();

    const subscriptionStatus = await resolveVenueSubscriptionStatus(this.prisma, { venueId: profile.venueId, venueStatus: profile.venue.subscriptionStatus, trialEndsAt: profile.trialEndsAt });
    request.venueScope = { userId: user.sub, profileId: profile.id, fullName: profile.fullName, venueId: profile.venueId, venueName: profile.venue.name, role: profile.role, allAccess: profile.allAccess, subscriptionStatus, trialEndsAt: profile.trialEndsAt ?? null };

    return bindAiUsageContext(
      { venueId: profile.venueId, profileId: profile.id, prisma: this.prisma },
      () => next.handle(),
    );
  }
}
