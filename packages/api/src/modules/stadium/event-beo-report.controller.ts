import { Controller, ForbiddenException, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { EventBeoReportService } from './event-beo-report.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageVenue } from '../../auth/roles';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/events/:eventId/beo-report')
@RequireSubscription()
export class EventBeoReportController {
  constructor(private readonly service: EventBeoReportService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Manager access is required to publish a BEO report.');
    }
  }

  /**
   * The published report. Every venue member can read it — the point of
   * publishing is that departments and suite hosts work from one copy.
   */
  @Get()
  async getPublished(@VenueScope() scope: Scope, @Param('eventId') eventId: string) {
    return this.service.getPublishedReport(scope.venueId, eventId);
  }

  /** Live assembly of what the next publish would contain. Managers only. */
  @Get('preview')
  async preview(@VenueScope() scope: Scope, @Param('eventId') eventId: string) {
    this.assertManager(scope);
    return this.service.buildReport(scope.venueId, eventId);
  }

  @Get('versions')
  async versions(@VenueScope() scope: Scope, @Param('eventId') eventId: string) {
    this.assertManager(scope);
    return this.service.listVersions(scope.venueId, eventId);
  }

  @Post('publish')
  async publish(@VenueScope() scope: Scope, @Param('eventId') eventId: string) {
    this.assertManager(scope);
    return this.service.publish(scope.venueId, eventId, {
      profileId: scope.profileId,
      fullName: scope.fullName,
    });
  }
}
