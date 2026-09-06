import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { DailyRosterService } from './daily-roster.service';
import {
  AdjustRosterDto,
  AssignRosterWorkerDto,
  CreateDailyRosterDto,
  UpdateRosterWorkerDto,
} from './daily-roster.dto';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { organizationIdForPairedVenue } from '../../common/venue-facility';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/stadium/daily-rosters')
@RequireSubscription()
export class DailyRosterController {
  constructor(
    private readonly service: DailyRosterService,
    private readonly prisma: PrismaService,
  ) {}

  /** Resolves the org and guarantees the same-id Facility exists, so `facilityId` is safe as a facilityId. */
  private async organizationIdFor(facilityId: string): Promise<string> {
    return organizationIdForPairedVenue(this.prisma, facilityId);
  }

  @Get()
  async listRosters(
    @VenueScope() scope: Scope,
    @Query('operationalDate') operationalDate?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listRosters({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      operationalDate,
      departmentId,
      status,
    });
  }

  @Post()
  async createRoster(
    @VenueScope() scope: Scope,
    @Body() body: CreateDailyRosterDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.createRoster({
      organizationId: orgId,
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      dto: body,
    });
  }

  @Get(':id')
  async getRoster(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
  ) {
    return this.service.getRoster({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      rosterId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
    });
  }

  @Post(':id/workers')
  async addWorker(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
    @Body() body: AssignRosterWorkerDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.addWorker({
      organizationId: orgId,
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      rosterId,
      dto: body,
    });
  }

  @Patch(':id/workers/:workerId')
  async updateWorker(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
    @Param('workerId') workerId: string,
    @Body() body: UpdateRosterWorkerDto,
  ) {
    return this.service.updateWorker({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      rosterId,
      workerId,
      dto: body,
    });
  }

  @Post(':id/submit')
  async submitRoster(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
  ) {
    return this.service.submitRoster({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      rosterId,
    });
  }

  @Post(':id/approve')
  async approveRoster(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
  ) {
    return this.service.approveRoster({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      rosterId,
    });
  }

  @Post(':id/close')
  async closeRoster(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
  ) {
    return this.service.closeRoster({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      rosterId,
    });
  }

  @Post(':id/adjust')
  async adjustClosedRoster(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
    @Body() body: AdjustRosterDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.adjustClosedRoster({
      organizationId: orgId,
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      rosterId,
      dto: body,
    });
  }

  @Get(':id/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="daily-roster.csv"')
  async exportRosterCsv(
    @VenueScope() scope: Scope,
    @Param('id') rosterId: string,
  ) {
    return this.service.exportRosterCsv({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      rosterId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
    });
  }
}
