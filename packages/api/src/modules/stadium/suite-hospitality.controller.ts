import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SuiteHospitalityService, CreateSuiteBeoDto, CompleteDeliveryDto, CreateReplenishmentDto } from './suite-hospitality.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { SuiteBeoStatus } from '@prisma/client';
import { canManageVenue } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { IsIn, IsOptional, IsString } from 'class-validator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

class UpdateBeoStatusDto {
  @IsIn(['draft', 'confirmed_beo', 'prep_initiated', 'en_route', 'delivered', 'closed_invoiced'])
  status!: SuiteBeoStatus;
  @IsOptional() @IsString() notes?: string;
}

class SeedSuitesDto {
  @IsString() zoneId!: string;
}

@Controller('v1/stadium/suite-beos')
@RequireSubscription()
export class SuiteHospitalityController {
  constructor(private readonly service: SuiteHospitalityService, private readonly prisma: PrismaService) {}

  private async assertOperator(scope: Scope, zoneId?: string) {
    if (canManageVenue(scope.role, scope.allAccess)) return;
    if (scope.role !== 'suite_manager') {
      throw new ForbiddenException('Premium hospitality manager access is required.');
    }
    const assignment = await this.prisma.scopeAssignment.findFirst({
      where: {
        organizationId: await this.organizationIdFor(scope.venueId), active: true,
        membership: { userId: scope.userId, status: 'active' },
        AND: [
          { OR: [{ facilityId: null }, { facilityId: scope.venueId }] },
          zoneId ? { OR: [{ zoneId: null }, { zoneId }] } : { zoneId: null },
        ],
      },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('This suite operation is outside your assigned facility or zone.');
  }

  private async organizationIdFor(facilityId: string) {
    const venue = await this.prisma.venue.findUniqueOrThrow({ where: { id: facilityId }, select: { organizationId: true } });
    return venue.organizationId;
  }

  @Get()
  async listSuiteBeos(
    @VenueScope() scope: Scope,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: SuiteBeoStatus,
  ) {
    await this.assertOperator(scope, zoneId);
    return this.service.listSuiteBeos(scope.venueId, zoneId, status);
  }

  @Post()
  async createBeoOrder(@VenueScope() scope: Scope, @Body() body: CreateSuiteBeoDto) {
    await this.assertOperator(scope, body.zoneId);
    return this.service.createBeoOrder({
      ...body,
      organizationId: await this.organizationIdFor(scope.venueId),
      facilityId: scope.venueId,
    });
  }

  @Post('seed')
  async seed10VipSuites(@VenueScope() scope: Scope, @Body() body: SeedSuitesDto) {
    await this.assertOperator(scope, body.zoneId);
    return this.service.seed10VipSuites(
      scope.venueId,
      await this.organizationIdFor(scope.venueId),
      body.zoneId,
    );
  }

  @Patch(':id/status')
  async updateOrderStatus(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: UpdateBeoStatusDto,
  ) {
    const order = await this.prisma.suiteBeoOrder.findFirst({ where: { id, facilityId: scope.venueId }, select: { zoneId: true } });
    if (!order) throw new ForbiddenException('Suite BEO order is unavailable in this facility.');
    await this.assertOperator(scope, order.zoneId);
    return this.service.updateOrderStatus(scope.venueId, id, body.status, scope.profileId, scope.fullName, body.notes);
  }

  @Post(':id/deliver')
  async markDelivered(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: CompleteDeliveryDto) {
    const order = await this.prisma.suiteBeoOrder.findFirst({ where: { id, facilityId: scope.venueId }, select: { zoneId: true } });
    if (!order) throw new ForbiddenException('Suite BEO order is unavailable in this facility.');
    await this.assertOperator(scope, order.zoneId);
    return this.service.markDelivered(scope.venueId, id, {
      ...body,
      deliveredBy: body.deliveredBy || scope.profileId,
    });
  }

  @Post(':id/replenish')
  async createReplenishment(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: CreateReplenishmentDto) {
    const order = await this.prisma.suiteBeoOrder.findFirst({ where: { id, facilityId: scope.venueId }, select: { zoneId: true } });
    if (!order) throw new ForbiddenException('Suite BEO order is unavailable in this facility.');
    await this.assertOperator(scope, order.zoneId);
    return this.service.createReplenishment(scope.venueId, id, { ...body, requestedBy: scope.fullName });
  }
}
