import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { AssignDepartmentMemberDto, CreateUserAreaOverrideDto, SwitchPrimaryDepartmentDto } from './departments.dto';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { organizationIdForPairedVenue } from '../../common/venue-facility';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/departments')
@RequireSubscription()
export class DepartmentsController {
  constructor(
    private readonly service: DepartmentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Resolves the org and guarantees the same-id Facility exists, so `facilityId` is safe as a facilityId. */
  private async organizationIdFor(facilityId: string): Promise<string> {
    return organizationIdForPairedVenue(this.prisma, facilityId);
  }

  @Get('workspace')
  async getWorkspace(@VenueScope() scope: Scope) {
    const orgId = await this.organizationIdFor(scope.venueId);
    await this.service.ensureDefaultDepartments(orgId, scope.venueId);
    return this.service.resolveUserWorkspace(scope.venueId, scope.userId);
  }

  @Post('switch')
  async switchWorkspace(
    @VenueScope() scope: Scope,
    @Body() body: SwitchPrimaryDepartmentDto,
  ) {
    await this.service.switchPrimaryDepartment(scope.venueId, scope.userId, body.departmentId);
    return { success: true, switchedDepartmentId: body.departmentId };
  }

  @Get()
  async listDepartments(@VenueScope() scope: Scope) {
    const orgId = await this.organizationIdFor(scope.venueId);
    await this.service.ensureDefaultDepartments(orgId, scope.venueId);
    return this.service.listDepartments(scope.venueId);
  }

  @Post(':id/members')
  async assignMember(
    @VenueScope() scope: Scope,
    @Param('id') departmentId: string,
    @Body() body: AssignDepartmentMemberDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.assignMember({
      organizationId: orgId,
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      departmentId,
      targetUserId: body.userId,
      isPrimary: body.isPrimary,
    });
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @VenueScope() scope: Scope,
    @Param('id') departmentId: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.service.removeMember({
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      departmentId,
      targetUserId,
    });
    return { success: true };
  }

  @Post('overrides')
  async createOverride(
    @VenueScope() scope: Scope,
    @Body() body: CreateUserAreaOverrideDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.createOverride({
      organizationId: orgId,
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      dto: body,
    });
  }
}
