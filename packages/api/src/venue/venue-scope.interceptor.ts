import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
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
    // Always derive venue scope from the live membership row below. Never trust
    // a venueScope that a guard or interceptor pre-populated: a fabricated scope
    // (e.g. hardcoded allAccess: true) would flow into role gates in handlers.
    const user = request.user;
    if (!user?.sub || !user.profileId || !user.venueId) return next.handle();
    // AuthGuard already resolved this profile from the verified active
    // membership. Never select a second venue here; doing so can authorize one
    // venue while Prisma is scoped to another.
    const profile = await this.prisma.profile.findFirst({
      where: {
        id: user.profileId,
        userId: user.sub,
        venueId: user.venueId,
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
      include: { venue: { select: { id: true, name: true, subscriptionStatus: true } } },
    });
    if (!profile?.venueId || !profile.venue) return next.handle();

    const subscriptionStatus = await resolveVenueSubscriptionStatus(this.prisma, { venueId: profile.venueId, venueStatus: profile.venue.subscriptionStatus, trialEndsAt: profile.trialEndsAt });
    request.venueScope = { userId: user.sub, profileId: profile.id, fullName: profile.fullName, venueId: profile.venueId, venueName: profile.venue.name, role: profile.role, allAccess: profile.allAccess, subscriptionStatus, trialEndsAt: profile.trialEndsAt ?? null };

    return bindAiUsageContext(
      { venueId: profile.venueId, profileId: profile.id, prisma: this.prisma },
      () => next.handle(),
    );
  }
}
