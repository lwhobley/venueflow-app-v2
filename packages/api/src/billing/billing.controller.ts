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
    if (secret) {
      const provided = (headers?.['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '') ?? null;
      if (!secretsMatch(provided, secret)) throw new UnauthorizedException('Invalid RevenueCat webhook authorization.');
    }
    return { received: true, mode: 'enterprise' };
  }

  @Public()
  @Post('stripe/webhook')
  async handleStripeWebhook(@Body() _body: any, @Headers() headers: any, @Req() request: Request) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (
      secret &&
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