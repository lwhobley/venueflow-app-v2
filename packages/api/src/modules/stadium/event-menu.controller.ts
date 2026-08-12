import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { EventMenuService, CreateMenuOverlayDto } from './event-menu.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { Public } from '../../auth/public.decorator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@Controller('v1/stadium/event-menus')
export class EventMenuController {
  constructor(private readonly service: EventMenuService) {}

  @Get()
  async listOverlays(@VenueScope() scope: Scope, @Query('eventId') eventId?: string) {
    return this.service.listOverlays(scope.venueId, eventId);
  }

  @Public()
  @Get('public-overlays')
  async listOverlaysPublic(@Query('facilityId') facilityId: string, @Query('eventId') eventId?: string) {
    return this.service.listOverlays(facilityId || 'facility-1', eventId);
  }

  @Post('overlay')
  async createMenuOverlay(@VenueScope() scope: Scope, @Body() body: CreateMenuOverlayDto) {
    return this.service.createMenuOverlay({
      ...body,
      facilityId: scope.venueId,
    });
  }

  @Public()
  @Post('overlay-public')
  async createMenuOverlayPublic(@Body() body: CreateMenuOverlayDto) {
    return this.service.createMenuOverlay(body);
  }

  @Patch('overlay/:id/toggle')
  async toggleOverlay(@Param('id') id: string, @Body() body: { active: boolean }) {
    return this.service.toggleOverlay(id, body.active);
  }
}
