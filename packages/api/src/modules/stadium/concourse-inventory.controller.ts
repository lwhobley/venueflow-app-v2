import { Body, Controller, ForbiddenException, Get, Headers, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ConcourseInventoryService, CreateStandSheetDto, RecordCountOutDto, CreateTransferDto, HawkerCheckoutDto, HawkerSettleDto } from './concourse-inventory.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageVenue } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { IsIn, IsString } from 'class-validator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

class UpdateTransferStatusDto {
  @IsIn(['approved', 'in_transit', 'completed', 'rejected'])
  status!: 'approved' | 'in_transit' | 'completed' | 'rejected';
}

class SeedOutletsDto { @IsString() zoneId!: string; }

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/concourse')
@RequireSubscription()
export class ConcourseInventoryController {
  constructor(private readonly service: ConcourseInventoryService, private readonly prisma: PrismaService) {}

  private async assertOperator(scope: Scope, zoneId?: string) {
    if (canManageVenue(scope.role, scope.allAccess)) return;
    if (scope.role !== 'concourse_supervisor') {
      throw new ForbiddenException('Concourse operations manager access is required.');
    }
    const assignment = await this.prisma.scopeAssignment.findFirst({
      where: {
        organizationId: await this.organizationIdFor(scope.venueId), active: true,
        membership: { userId: scope.userId, status: 'active' },
        AND: [
          { OR: [{ facilityId: null }, { facilityId: scope.venueId }] },
          // Listing an entire facility is valid for a facility-wide assignment;
          // zone-only supervisors must provide a zone filter rather than being
          // silently denied by a null-zone query.
          zoneId ? { OR: [{ zoneId: null }, { zoneId }] } : { OR: [{ zoneId: null }, { zoneId: { not: null } }] },
        ],
      },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('This concourse operation is outside your assigned facility or zone.');
  }

  private async organizationIdFor(facilityId: string) {
    const venue = await this.prisma.venue.findUniqueOrThrow({ where: { id: facilityId }, select: { organizationId: true } });
    return venue.organizationId;
  }

  @Get('stand-sheets')
  async listStandSheets(@VenueScope() scope: Scope, @Query('zoneId') zoneId?: string, @Query('outletId') outletId?: string) {
    await this.assertOperator(scope, zoneId);
    return this.service.listStandSheets(scope.venueId, zoneId, outletId);
  }

  @Post('stand-sheets')
  async createStandSheet(@VenueScope() scope: Scope, @Body() body: CreateStandSheetDto) {
    await this.assertOperator(scope, body.zoneId);
    return this.service.createStandSheet({
      ...body, organizationId: await this.organizationIdFor(scope.venueId), facilityId: scope.venueId,
      supervisorId: scope.profileId, supervisorName: scope.fullName,
    });
  }

  @Post('stand-sheets/:id/reconcile')
  async reconcileStandSheet(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: RecordCountOutDto, @Headers('idempotency-key') idempotencyKey?: string) {
    const sheet = await this.prisma.standSheet.findFirst({ where: { id, facilityId: scope.venueId }, select: { zoneId: true } });
    if (!sheet) throw new ForbiddenException('Stand sheet is unavailable in this facility.');
    await this.assertOperator(scope, sheet.zoneId);
    return this.service.reconcileStandSheet(scope.venueId, id, body, idempotencyKey);
  }

  @Get('transfers')
  async listTransfers(@VenueScope() scope: Scope) {
    await this.assertOperator(scope);
    return this.service.listTransfers(scope.venueId);
  }

  @Post('transfers')
  async submitTransferRequest(@VenueScope() scope: Scope, @Body() body: CreateTransferDto) {
    await this.assertOperator(scope);
    return this.service.submitTransferRequest({ ...body, organizationId: await this.organizationIdFor(scope.venueId), facilityId: scope.venueId, requestedBy: scope.fullName });
  }

  @Get('hawkers')
  async listHawkerSessions(@VenueScope() scope: Scope) {
    await this.assertOperator(scope);
    return this.service.listHawkerSessions(scope.venueId);
  }

  @Patch('transfers/:id/status')
  async updateTransferStatus(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: UpdateTransferStatusDto) {
    await this.assertOperator(scope);
    return this.service.updateTransferStatus(scope.venueId, id, body.status);
  }

  @Post('hawkers/checkout')
  async checkoutHawkerInventory(@VenueScope() scope: Scope, @Body() body: HawkerCheckoutDto) {
    await this.assertOperator(scope);
    return this.service.checkoutHawkerInventory({ ...body, organizationId: await this.organizationIdFor(scope.venueId), facilityId: scope.venueId });
  }

  @Post('hawkers/:id/settle')
  async settleHawkerSession(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: HawkerSettleDto) {
    await this.assertOperator(scope);
    return this.service.settleHawkerSession(scope.venueId, id, body);
  }

  @Post('seed-outlets')
  async seedOutlets(@VenueScope() scope: Scope, @Body() body: SeedOutletsDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Seeding concourse outlets is disabled in production.');
    }
    await this.assertOperator(scope, body.zoneId);
    return this.service.seedConcourseOutletsAndWarehouse(
      scope.venueId,
      await this.organizationIdFor(scope.venueId),
      body.zoneId,
    );
  }
}
