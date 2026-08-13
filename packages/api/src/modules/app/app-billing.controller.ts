import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileService } from './profile.service';

/**
 * Enterprise Billing Controller:
 * Stadium operations are managed via enterprise contracts.
 * Consumer paywalls, Stripe checkouts, and RevenueCat mobile in-app purchases are disabled.
 */
@Controller('v1/app')
export class AppBillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('billing')
  async getMyVenueBilling(@CurrentUser() user: AuthUser) {
    const profile = await this.profiles.getProfile(user);
    if (!profile?.venueId) return null;

    return {
      venueId: profile.venueId,
      status: 'active',
      platform: 'enterprise',
      trialStartedAt: null,
      trialEndsAt: null,
      currentPeriodStart: Date.now(),
      currentPeriodEnd: Date.now() + 365 * 24 * 60 * 60 * 1000,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      planId: 'enterprise_licensed',
      priceCents: 0,
      currency: 'USD',
    };
  }

  @UseGuards(AuthGuard)
  @Post('billing/stripe/checkout')
  async createStripeCheckout(@CurrentUser() _user: AuthUser, @Body() _body?: any) {
    return {
      url: '/(tabs)/home',
      message: 'Enterprise accounts are fully licensed and managed externally.',
    };
  }

  @UseGuards(AuthGuard)
  @Post('billing/stripe/portal')
  async createStripePortal(@CurrentUser() _user: AuthUser) {
    return {
      url: '/settings/billing',
      message: 'Enterprise billing is administered via direct organization invoicing.',
    };
  }

  @UseGuards(AuthGuard)
  @Post('billing/apple/sync')
  async syncAppleSubscription(@CurrentUser() _user: AuthUser, @Body() _body?: any) {
    return {
      success: true,
      status: 'active',
      message: 'Enterprise account access verified.',
    };
  }
}
