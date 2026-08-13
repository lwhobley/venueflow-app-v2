import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Enterprise Inbound Webhook Receiver:
 * Safe no-op handlers for external legacy hooks.
 */
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post('revenuecat/webhook')
  async handleRevenueCatWebhook(@Body() _body: any, @Headers() _headers: any) {
    return { received: true, mode: 'enterprise' };
  }

  @Public()
  @Post('stripe/webhook')
  async handleStripeWebhook(@Body() _body: any, @Headers() _headers: any) {
    return { received: true, mode: 'enterprise' };
  }
}
