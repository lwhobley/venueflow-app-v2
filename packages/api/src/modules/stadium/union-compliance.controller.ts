import { Body, Controller, ForbiddenException, Get, Post, Query, UseInterceptors } from '@nestjs/common';
import { UnionComplianceService } from './union-compliance.service';
import { PunchType, PunchVerification } from '@prisma/client';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { canManageVenue } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { organizationIdForPairedVenue } from '../../common/venue-facility';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;
class RecordPunchDto {
  @IsString() workerId!: string;
  @IsIn(['IN', 'OUT', 'MEAL_START', 'MEAL_END']) punchType!: PunchType;
  @IsOptional() @IsIn(['qr_scan', 'pin_entry', 'supervisor_override']) verifiedVia?: PunchVerification;
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsString() outletId?: string;
  @IsOptional() @IsString() overrideReason?: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/union-compliance')
@RequireSubscription()
export class UnionComplianceController {
  constructor(private readonly service: UnionComplianceService, private readonly prisma: PrismaService) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Workforce manager access is required.');
  }

  private async organizationIdFor(facilityId: string) {
    return organizationIdForPairedVenue(this.prisma, facilityId);
  }

  @Get('shift-summary')
  async getShiftSummary(
    @VenueScope() scope: Scope,
    @Query('workerId') workerId: string,
    @Query('businessDate') businessDate?: string,
  ) {
    this.assertManager(scope);
    return this.service.calculateWorkerShiftSummary(workerId, scope.venueId, businessDate);
  }

  @Get('shift-summaries')
  async getShiftSummaries(@VenueScope() scope: Scope, @Query('businessDate') businessDate?: string) {
    this.assertManager(scope);
    return this.service.listFacilityShiftSummaries(scope.venueId, businessDate);
  }

  @Post('punch')
  async recordPunch(@VenueScope() scope: Scope, @Body() body: RecordPunchDto) {
    this.assertManager(scope);
    return this.service.recordPunch(
      await this.organizationIdFor(scope.venueId),
      scope.venueId,
      body.workerId,
      body.punchType,
      body.verifiedVia ?? 'pin_entry',
      body.zoneId,
      body.outletId,
      body.overrideReason,
    );
  }

  @Get('multi-venue-overview')
  async getMultiVenueOverview(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getMultiVenueComplianceOverview(orgId);
  }

  @Get('cross-venue-conflicts')
  async getCrossVenueConflicts(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getCrossVenueSchedulingConflicts(orgId);
  }

  @Get('certifications')
  async getCertifications(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getMultiVenueCertificationStatus(orgId);
  }
}
