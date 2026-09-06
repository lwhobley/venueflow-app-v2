import { Controller, Get, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';

const INSIGHTS_RATE_LIMIT_MAX = 60;
const INSIGHTS_RATE_LIMIT_WINDOW_MS = 60_000;

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/insights')
export class InsightsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription('active')
  @Get()
  async getLatestInsights(@Req() request: Request) {
    await assertWithinSharedRateLimit(
      this.prisma,
      `insights:${getClientIp(request)}`,
      INSIGHTS_RATE_LIMIT_MAX,
      INSIGHTS_RATE_LIMIT_WINDOW_MS,
      'Too many requests.',
    );
    // Quarantined. `CosmicInsight` has no venueId/organizationId column, so an
    // unfiltered findMany served one tenant's insights to every other tenant.
    // The endpoint stays (clients call it) but returns nothing until the model
    // carries a tenant key and something actually writes rows per venue.
    return [];
  }
}
