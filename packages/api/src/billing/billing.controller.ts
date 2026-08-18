import { BadRequestException, Body, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { secretsMatch, verifyStripeSignature } from '../common/webhook-auth';

/**
 * Enterprise Inbound Webhook Receiver:
 * Safe no-op handlers for external legacy hooks. When the matching webhook
 * secret is configured, inbound requests are rejected unless they present a
 * valid signature or bearer credential, so the endpoints cannot be driven by
 * unauthenticated callers.
 *
 * Both secrets are optional integrations, not startup requirements — a
 * deployment that doesn't use RevenueCat or Stripe should still boot. But in
 * production, a *missing* secret must not silently fall through to accepting
 * unauthenticated requests: these handlers are no-ops today, so nothing is
 * exploitable yet, but the moment either grows real side effects, "no secret
 * configured" would otherwise mean "anyone can call this." Reject instead.
 */
@Controller('v1/billing')
export class BillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('revenuecat/webhook')
  async handleRevenueCatWebhook(@Body() _body: any, @Headers() headers: any) {
    const secret = this.config.get<string>('REVENUECAT_WEBHOOK_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('RevenueCat webhook is not configured.');
      }
      return { received: true, mode: 'enterprise' };
    }
    const provided = (headers?.['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '') ?? null;
    if (!secretsMatch(provided, secret)) throw new UnauthorizedException('Invalid RevenueCat webhook authorization.');
    return { received: true, mode: 'enterprise' };
  }

  @Public()
  @Post('stripe/webhook')
  async handleStripeWebhook(@Body() _body: any, @Headers() headers: any, @Req() request: Request) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Stripe webhook is not configured.');
      }
      return { received: true, mode: 'enterprise' };
    }
    if (
      !verifyStripeSignature(
        (request as Request & { rawBody?: Buffer }).rawBody,
        headers?.['stripe-signature'] as string | undefined,
        secret,
      )
    ) {
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }
    return { received: true, mode: 'enterprise' };
  }
}