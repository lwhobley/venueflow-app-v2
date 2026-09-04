import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { VmsService } from './vms.service';
import {
  AiParseOrderDto,
  ApproveAttendanceDto,
  ClockInDto,
  ClockOutDto,
  CreateStaffingOrderDto,
  CreateVendorDto,
  CreateVendorServiceDto,
  CreateVmsStaffMemberDto,
  SubmitOrderBidDto,
  TriggerInventorySyncDto,
  UpdateOrderStatusDto,
  UpdateVendorDto,
} from './vms.dto';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { canManageVenue } from '../../auth/roles';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VmsAttendanceStatus,
  VmsOrderStatus,
  VmsVendorStatus,
  VmsVendorType,
} from '@prisma/client';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/vms')
@RequireSubscription()
export class VmsController {
  constructor(
    private readonly service: VmsService,
    private readonly prisma: PrismaService,
  ) {}

  private assertManager(scope: Scope) {
    if (!canManageVenue(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Venue or workforce manager authorization required.');
    }
  }

  private async organizationIdFor(facilityId: string): Promise<string> {
    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: facilityId },
      select: { organizationId: true },
    });
    return venue.organizationId;
  }

  // ---------------------------------------------------------------------------
  // VENDORS
  // ---------------------------------------------------------------------------

  @Get('vendors')
  async listVendors(
    @VenueScope() scope: Scope,
    @Query('status') status?: VmsVendorStatus,
    @Query('vendorType') vendorType?: VmsVendorType,
    @Query('search') search?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listVendors({
      organizationId: orgId,
      facilityId: scope.venueId,
      status,
      vendorType,
      search,
    });
  }

  @Get('vendors/:id')
  async getVendor(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getVendor(id, orgId, scope.venueId);
  }

  @Post('vendors')
  async createVendor(@VenueScope() scope: Scope, @Body() body: CreateVendorDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.createVendor(orgId, scope.venueId, body, scope.userId);
  }

  @Put('vendors/:id')
  async updateVendor(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: UpdateVendorDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.updateVendor(id, orgId, scope.venueId, body, scope.userId);
  }

  @Delete('vendors/:id')
  async deleteVendor(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.deleteVendor(id, orgId, scope.venueId, scope.userId);
  }

  @Post('vendors/:id/services')
  async addVendorService(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: CreateVendorServiceDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.addVendorService(id, orgId, scope.venueId, body);
  }

  // ---------------------------------------------------------------------------
  // STAFF
  // ---------------------------------------------------------------------------

  @Get('staff')
  async listStaffMembers(
    @VenueScope() scope: Scope,
    @Query('vendorId') vendorId?: string,
    @Query('role') role?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listStaffMembers({
      organizationId: orgId,
      facilityId: scope.venueId,
      vendorId,
      role,
    });
  }

  @Post('staff')
  async createStaffMember(@VenueScope() scope: Scope, @Body() body: CreateVmsStaffMemberDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.createStaffMember(orgId, scope.venueId, body);
  }

  // ---------------------------------------------------------------------------
  // ORDERS
  // ---------------------------------------------------------------------------

  @Get('orders')
  async listOrders(
    @VenueScope() scope: Scope,
    @Query('status') status?: VmsOrderStatus,
    @Query('shiftDate') shiftDate?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listOrders({
      organizationId: orgId,
      facilityId: scope.venueId,
      status,
      shiftDate,
    });
  }

  @Get('orders/:id')
  async getOrder(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getOrder(id, orgId, scope.venueId);
  }

  @Post('orders')
  async createOrder(@VenueScope() scope: Scope, @Body() body: CreateStaffingOrderDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.createOrder(orgId, scope.venueId, body, scope.userId);
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.updateOrderStatus(id, orgId, scope.venueId, body.status, scope.userId);
  }

  @Post('orders/:id/bids')
  async submitOrderBid(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: SubmitOrderBidDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.submitOrderBid(id, orgId, scope.venueId, body);
  }

  @Post('orders/fulfillments/:fulfillmentId/confirm')
  async confirmOrderBid(
    @VenueScope() scope: Scope,
    @Param('fulfillmentId') fulfillmentId: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.confirmOrderBid(fulfillmentId, orgId, scope.venueId, scope.userId);
  }

  @Post('orders/:id/match')
  async matchVendorsForOrder(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.matchVendorsForOrder(id, orgId, scope.venueId);
  }

  @Post('orders/ai-parse')
  async parseNaturalLanguageOrder(
    @VenueScope() scope: Scope,
    @Body() body: AiParseOrderDto,
  ) {
    this.assertManager(scope);
    return this.service.parseNaturalLanguageOrder(body.naturalLanguagePrompt);
  }

  // ---------------------------------------------------------------------------
  // TIME & ATTENDANCE
  // ---------------------------------------------------------------------------

  @Post('attendance/clock-in')
  async clockIn(@VenueScope() scope: Scope, @Body() body: ClockInDto) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.clockIn(orgId, scope.venueId, body);
  }

  @Post('attendance/clock-out')
  async clockOut(@VenueScope() scope: Scope, @Body() body: ClockOutDto) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.clockOut(orgId, scope.venueId, body);
  }

  @Post('attendance/:id/approve')
  async approveAttendance(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: ApproveAttendanceDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.approveAttendance(id, orgId, scope.venueId, scope.userId, body);
  }

  @Get('attendance/reports')
  async listAttendanceReports(
    @VenueScope() scope: Scope,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: VmsAttendanceStatus,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listAttendanceReports({
      organizationId: orgId,
      facilityId: scope.venueId,
      startDate,
      endDate,
      status,
    });
  }

  @Get('attendance/payroll/adp')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="adp-payroll-export.csv"')
  async exportPayrollAdp(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const res = await this.service.exportPayrollAdp(orgId, scope.venueId);
    return res.csvContent;
  }

  @Get('attendance/payroll/gusto')
  async exportPayrollGusto(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.exportPayrollGusto(orgId, scope.venueId);
  }

  // ---------------------------------------------------------------------------
  // INVENTORY & INTEGRATIONS
  // ---------------------------------------------------------------------------

  @Post('integrations/sync')
  async triggerInventorySync(
    @VenueScope() scope: Scope,
    @Body() body: TriggerInventorySyncDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.syncInventory(orgId, scope.venueId, body.system, body.syncType, body.items);
  }

  @Get('inventory/status')
  async getInventoryStatus(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getInventoryStatus(orgId, scope.venueId);
  }

  // ---------------------------------------------------------------------------
  // ANALYTICS & SCORECARDS
  // ---------------------------------------------------------------------------

  @Get('analytics/vendor-scorecard')
  async getVendorScorecard(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getVendorScorecard(orgId, scope.venueId);
  }

  @Get('analytics/cost-breakdown')
  async getCostBreakdown(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getCostBreakdown(orgId, scope.venueId);
  }

  @Get('analytics/forecast')
  async getDemandForecast(
    @VenueScope() scope: Scope,
    @Query('name') name?: string,
    @Query('type') type?: string,
    @Query('expectedAttendance') expectedAttendance?: string,
    @Query('hours') hours?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getDemandForecast(orgId, scope.venueId, {
      name,
      type,
      expectedAttendance: expectedAttendance ? parseInt(expectedAttendance, 10) : undefined,
      hours: hours ? parseFloat(hours) : undefined,
    });
  }

  @Get('analytics/anomalies')
  async getAttendanceAnomalies(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getAttendanceAnomalies(orgId, scope.venueId);
  }

  @Get('audit-logs')
  async getAuditLogs(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getAuditLogs(orgId, scope.venueId);
  }
}
