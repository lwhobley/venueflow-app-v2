import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { EventMenuService, CreateMenuOverlayDto } from './event-menu.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageVenue } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { organizationIdForPairedVenue } from '../../common/venue-facility';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { IsBoolean } from 'class-validator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;
class ToggleOverlayDto { @IsBoolean() active!: boolean; }

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/event-menus')
@RequireSubscription()
export class EventMenuController {
  constructor(private readonly service: EventMenuService, private readonly prisma: PrismaService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Event manager access is required.');
  }

  private async organizationIdFor(facilityId: string) {
    return organizationIdForPairedVenue(this.prisma, facilityId);
  }

  @Get()
  async listOverlays(@VenueScope() scope: Scope, @Query('eventId') eventId?: string) {
    return this.service.listOverlays(scope.venueId, eventId);
  }

  @Post('overlay')
  async createMenuOverlay(@VenueScope() scope: Scope, @Body() body: CreateMenuOverlayDto) {
    this.assertManager(scope);
    return this.service.createMenuOverlay({
      ...body,
      organizationId: await this.organizationIdFor(scope.venueId),
      facilityId: scope.venueId,
    });
  }

  @Patch('overlay/:id/toggle')
  async toggleOverlay(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: ToggleOverlayDto) {
    this.assertManager(scope);
    return this.service.toggleOverlay(scope.venueId, id, body.active);
  }
}
