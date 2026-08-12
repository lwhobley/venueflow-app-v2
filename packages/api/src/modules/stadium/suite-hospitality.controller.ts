import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SuiteHospitalityService, CreateSuiteBeoDto, CompleteDeliveryDto, CreateReplenishmentDto } from './suite-hospitality.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { SuiteBeoStatus } from '@prisma/client';
import { Public } from '../../auth/public.decorator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@Controller('v1/stadium/suite-beos')
export class SuiteHospitalityController {
  constructor(private readonly service: SuiteHospitalityService) {}

  @Get()
  async listSuiteBeos(
    @VenueScope() scope: Scope,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: SuiteBeoStatus,
  ) {
    return this.service.listSuiteBeos(scope.venueId, zoneId, status);
  }

  @Public()
  @Get('public-kds')
  async listPublicKds(
    @Query('facilityId') facilityId: string,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: SuiteBeoStatus,
  ) {
    return this.service.listSuiteBeos(facilityId || 'facility-1', zoneId, status);
  }

  @Post()
  async createBeoOrder(@VenueScope() scope: Scope, @Body() body: CreateSuiteBeoDto) {
    return this.service.createBeoOrder({
      ...body,
      facilityId: scope.venueId,
    });
  }

  @Post('seed')
  async seed10VipSuites(@VenueScope() scope: Scope, @Body() body: { organizationId?: string; zoneId?: string }) {
    return this.service.seed10VipSuites(
      scope.venueId,
      body.organizationId ?? 'org-stadium-1',
      body.zoneId ?? 'zone-north',
    );
  }

  @Public()
  @Post('seed-public')
  async seedPublic10VipSuites(@Body() body: { facilityId?: string; organizationId?: string; zoneId?: string }) {
    return this.service.seed10VipSuites(
      body.facilityId ?? 'facility-1',
      body.organizationId ?? 'org-stadium-1',
      body.zoneId ?? 'zone-north',
    );
  }

  @Patch(':id/status')
  async updateOrderStatus(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: { status: SuiteBeoStatus; notes?: string },
  ) {
    return this.service.updateOrderStatus(id, body.status, scope.profileId, undefined, body.notes);
  }

  @Public()
  @Patch(':id/status-public')
  async updateOrderStatusPublic(
    @Param('id') id: string,
    @Body() body: { status: SuiteBeoStatus; notes?: string; actorName?: string },
  ) {
    return this.service.updateOrderStatus(id, body.status, undefined, body.actorName ?? 'Kitchen Staff', body.notes);
  }

  @Post(':id/deliver')
  async markDelivered(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: CompleteDeliveryDto) {
    return this.service.markDelivered(id, {
      ...body,
      deliveredBy: body.deliveredBy || scope.profileId,
    });
  }

  @Public()
  @Post(':id/deliver-public')
  async markDeliveredPublic(@Param('id') id: string, @Body() body: CompleteDeliveryDto) {
    return this.service.markDelivered(id, {
      ...body,
      deliveredBy: body.deliveredBy || 'Suite Attendant Runner',
    });
  }

  @Post(':id/replenish')
  async createReplenishment(@Param('id') id: string, @Body() body: CreateReplenishmentDto) {
    return this.service.createReplenishment(id, body);
  }
}
