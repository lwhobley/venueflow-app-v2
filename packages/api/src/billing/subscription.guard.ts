import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { VenueScopedRequest } from '../venue/venue-scope.interceptor';
import { SUBSCRIPTION_TIER_KEY, SubscriptionTier } from './require-subscription.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveVenueSubscriptionStatus } from './subscription-status';

/**
 * Guards routes behind active or paid subscription checks.
 *
 * Guards run before interceptors in Nest, so request.venueScope is usually not
 * yet populated when this runs; it resolves the scope itself (resolveVenueScope)
 * and caches it on the request for the VenueScopeInterceptor/decorators to reuse.
 *
 * Activated with @RequireSubscription() (any active/trialing subscription) or
 * @RequireSubscription('paid') (paid-only, no trial). Routes without the
 * decorator are not gated.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tier = this.reflector.getAllAndOverride<SubscriptionTier | undefined>(
      SUBSCRIPTION_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!tier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    const scope = request.venueScope ?? (await this.resolveVenueScope(request));

    if (!scope) {
      throw new HttpException('No active venue subscription', HttpStatus.PAYMENT_REQUIRED);
    }

    // allAccess profiles (internal/support accounts) bypass billing checks.
    if (scope.allAccess) {
      return true;
    }

    const status = scope.subscriptionStatus;

    if (tier === 'active') {
      // Mirrors: status === 'trialing' || status === 'active'
      if (status === 'trialing' || status === 'active') {
        return true;
      }
      throw new HttpException(reasonMessage(status), HttpStatus.PAYMENT_REQUIRED);
    }

    if (tier === 'paid') {
      // Mirrors requirePaidSubscription: only 'active' passes
      if (status === 'active') {
        return true;
      }
      throw new HttpException(reasonMessage(status), HttpStatus.PAYMENT_REQUIRED);
    }

    return false;
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
    if (!isActiveMembership(profile.membershipStatus)) return null;

    const subscriptionStatus = await resolveVenueSubscriptionStatus(this.prisma, {
      venueId: profile.venueId,
      venueStatus: profile.venue.subscriptionStatus,
      trialEndsAt: profile.trialEndsAt,
    });

    request.venueScope = {
      userId: user.sub,
      profileId: profile.id,
      fullName: profile.fullName,
      venueId: profile.venueId,
      venueName: profile.venue.name,
      role: profile.role,
      allAccess: profile.allAccess,
      subscriptionStatus,
      trialEndsAt: profile.trialEndsAt ?? null,
    };
    return request.venueScope;
  }
}

function isActiveMembership(status: string | null): boolean {
  return status === null || status === 'active';
}

function reasonMessage(status: string | null): string {
  if (status === 'trialing') return 'A paid subscription is required for this feature';
  if (status === 'past_due') return 'Subscription payment failed — please update your billing details';
  if (status === 'paused' || status === 'cancelled') return 'Subscription cancelled — please resubscribe';
  if (status === 'expired') return 'Trial has expired — please subscribe to continue';
  return 'An active subscription is required';
}
