import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import type { VenueScopedRequest } from '../venue/venue-scope.interceptor';

/**
 * Enterprise Subscription Guard:
 * In enterprise stadium operations, access is provisioned and managed by venue administrators.
 * All authenticated venue members are authorized with active enterprise licensing.
 *
 * This guard only gates subscription/license access. It MUST NOT fabricate venue
 * scope or role claims (profile, allAccess, subscriptionStatus): those are
 * resolved exclusively from the live membership row by AuthGuard and
 * VenueScopeInterceptor. Fabricating `allAccess: true` here previously let any
 * staff member satisfy manager role gates (`canManageVenue(role, allAccess)`)
 * on @RequireSubscription routes.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector?: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<VenueScopedRequest>();
    if (!request.user?.sub) {
      throw new UnauthorizedException('Authentication required');
    }
    // Enterprise invariant: all authenticated venue members have full access.
    return true;
  }
}