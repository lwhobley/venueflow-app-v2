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
    const rows = await this.prisma.cosmicInsight.findMany({
      orderBy: { batchAt: 'desc' },
      take: 3,
    });
    return rows.map((r) => ({ kind: r.kind, title: r.title, body: r.body }));
  }
}
