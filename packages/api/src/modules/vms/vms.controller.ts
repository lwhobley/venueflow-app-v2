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
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { VmsService } from './vms.service';
import { VmsWorkforceService } from './vms-workforce.service';
import { VmsNotificationsService } from './vms-notifications.service';
import { VmsSchedulerService } from './vms-scheduler.service';
import {
  AiParseOrderDto,
  ApproveAttendanceDto,
  AuthorizePunchDto,
  ClockInDto,
  ClockOutDto,
  CreateStaffingOrderDto,
  CreateVendorDto,
  CreateVendorServiceDto,
  CreateVmsStaffMemberDto,
  AssignStaffDto,
  CreateOrderFromTemplateDto,
  CreateOrderTemplateDto,
  CsvImportDto,
  SetAvailabilityDto,
  SetNotificationPreferenceDto,
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
  VmsNotificationEvent,
  VmsNotificationStatus,
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
    private readonly workforce: VmsWorkforceService,
    private readonly notifications: VmsNotificationsService,
    private readonly scheduler: VmsSchedulerService,
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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listVendors({
      organizationId: orgId,
      facilityId: scope.venueId,
      status,
      vendorType,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('vendors/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="vendor-directory.csv"')
  async exportVendors(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.exportVendorsCsv(orgId, scope.venueId);
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

  @Patch('vendors/:id/deactivate')
  async deactivateVendor(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.deactivateVendor(id, orgId, scope.venueId, scope.userId, reason);
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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listStaffMembers({
      organizationId: orgId,
      facilityId: scope.venueId,
      vendorId,
      role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('staff')
  async createStaffMember(@VenueScope() scope: Scope, @Body() body: CreateVmsStaffMemberDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.createStaffMember(orgId, scope.venueId, body, scope.userId);
  }

  // ---------------------------------------------------------------------------
  // ORDERS
  // ---------------------------------------------------------------------------

  @Get('orders')
  async listOrders(
    @VenueScope() scope: Scope,
    @Query('status') status?: VmsOrderStatus,
    @Query('shiftDate') shiftDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listOrders({
      organizationId: orgId,
      facilityId: scope.venueId,
      status,
      shiftDate,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('orders/escalations')
  async getUnfilledOrdersNeedingEscalation(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getUnfilledOrdersNeedingEscalation(orgId, scope.venueId);
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
    return this.service.updateOrderStatus(
      id,
      orgId,
      scope.venueId,
      body.status,
      scope.userId,
      body.cancellationReason,
    );
  }

  @Post('orders/:id/bids')
  async submitOrderBid(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: SubmitOrderBidDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.submitOrderBid(id, orgId, scope.venueId, body, scope.userId);
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

  @Post('attendance/authorize-punch')
  async authorizePunch(
    @VenueScope() scope: Scope,
    @Body() body: AuthorizePunchDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.authorizePunch(orgId, scope.venueId, body);
  }

  @Post('attendance/clock-in')
  async clockIn(
    @VenueScope() scope: Scope,
    @Body() body: ClockInDto,
    @Req() req: any,
  ) {
    const isManager = canManageVenue(scope.role, scope.allAccess);
    if (!isManager && !body.pin && !body.badgeCode && !body.punchAuthToken) {
      throw new ForbiddenException('Worker PIN, badge credential, or punch authorization token required for self-service clock punch.');
    }
    const mutationId = (req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || body.clientMutationId)?.toString();
    if (mutationId) {
      body.clientMutationId = mutationId;
    }
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.clockIn(orgId, scope.venueId, body, {
      isManager,
      callerUserId: scope.userId,
      ipAddress: req.ip || req.headers?.['x-forwarded-for'],
    });
  }

  @Post('attendance/clock-out')
  async clockOut(
    @VenueScope() scope: Scope,
    @Body() body: ClockOutDto,
    @Req() req: any,
  ) {
    const isManager = canManageVenue(scope.role, scope.allAccess);
    if (!isManager && !body.pin && !body.badgeCode && !body.punchAuthToken) {
      throw new ForbiddenException('Worker PIN, badge credential, or punch authorization token required for self-service clock punch.');
    }
    const mutationId = (req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'] || body.clientMutationId)?.toString();
    if (mutationId) {
      body.clientMutationId = mutationId;
    }
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.clockOut(orgId, scope.venueId, body, {
      isManager,
      callerUserId: scope.userId,
      ipAddress: req.ip || req.headers?.['x-forwarded-for'],
    });
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

  @Post('attendance/detect-no-shows')
  async detectNoShows(
    @VenueScope() scope: Scope,
    @Query('gracePeriodMinutes') gracePeriodMinutes?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.detectNoShows(
      orgId,
      scope.venueId,
      gracePeriodMinutes ? parseInt(gracePeriodMinutes, 10) : 30,
    );
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
  async getAuditLogs(
    @VenueScope() scope: Scope,
    @Query('entityType') entityType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.getAuditLogs(orgId, scope.venueId, {
      entityType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('audit-logs/export')
  async exportAuditLogs(
    @VenueScope() scope: Scope,
    @Query('entityType') entityType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('format') format?: 'csv' | 'json',
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.exportAuditLogs(orgId, scope.venueId, {
      entityType,
      startDate,
      endDate,
      format,
    });
  }

  // ---------------------------------------------------------------------------
  // STAFF ASSIGNMENTS  (checklist 1.3, 1.4)
  // ---------------------------------------------------------------------------

  @Get('orders/:id/assignments')
  async listOrderAssignments(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.listAssignments({
      organizationId: orgId,
      facilityId: scope.venueId,
      orderId: id,
    });
  }

  @Post('orders/:id/assignments')
  async assignStaffToOrder(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: AssignStaffDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const assignment = await this.workforce.assignStaffToOrder({
      organizationId: orgId,
      facilityId: scope.venueId,
      orderId: id,
      staffMemberId: body.staffMemberId,
      fulfillmentId: body.fulfillmentId,
      notes: body.notes,
      force: body.force,
    });

    await this.service.logAudit({
      organizationId: orgId,
      facilityId: scope.venueId,
      entityType: 'VmsStaffAssignment',
      entityId: assignment.id,
      action: 'ASSIGN_STAFF',
      userId: scope.userId,
      changes: { orderId: id, staffMemberId: body.staffMemberId, forced: Boolean(body.force) },
    });

    return assignment;
  }

  @Delete('assignments/:assignmentId')
  async releaseAssignment(
    @VenueScope() scope: Scope,
    @Param('assignmentId') assignmentId: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const released = await this.workforce.releaseAssignment({
      organizationId: orgId,
      facilityId: scope.venueId,
      assignmentId,
    });

    await this.service.logAudit({
      organizationId: orgId,
      facilityId: scope.venueId,
      entityType: 'VmsStaffAssignment',
      entityId: assignmentId,
      action: 'RELEASE_STAFF',
      userId: scope.userId,
      changes: { orderId: released.orderId, staffMemberId: released.staffMemberId },
    });

    return released;
  }

  // ---------------------------------------------------------------------------
  // AVAILABILITY & CERTIFICATIONS  (checklist 1.2)
  // ---------------------------------------------------------------------------

  @Get('staff/availability')
  async listAvailability(
    @VenueScope() scope: Scope,
    @Query('staffMemberId') staffMemberId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.listAvailability({
      organizationId: orgId,
      facilityId: scope.venueId,
      staffMemberId,
      from,
      to,
    });
  }

  @Post('staff/availability')
  async setAvailability(@VenueScope() scope: Scope, @Body() body: SetAvailabilityDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.setAvailability({
      organizationId: orgId,
      facilityId: scope.venueId,
      staffMemberId: body.staffMemberId,
      startDate: body.startDate,
      endDate: body.endDate,
      available: body.available,
      reason: body.reason,
    });
  }

  @Get('staff/calendar')
  async getAvailabilityCalendar(
    @VenueScope() scope: Scope,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.getAvailabilityCalendar({
      organizationId: orgId,
      facilityId: scope.venueId,
      from: from ?? new Date().toISOString().split('T')[0],
      to: to ?? new Date(Date.now() + 14 * 86400 * 1000).toISOString().split('T')[0],
    });
  }

  @Get('staff/certifications/expiring')
  async listExpiringCertifications(
    @VenueScope() scope: Scope,
    @Query('withinDays') withinDays?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.service.listExpiringCertifications(
      orgId,
      scope.venueId,
      withinDays ? parseInt(withinDays, 10) : 30,
    );
  }

  // ---------------------------------------------------------------------------
  // ORDER TEMPLATES  (checklist 1.3)
  // ---------------------------------------------------------------------------

  @Get('order-templates')
  async listTemplates(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.listTemplates(orgId, scope.venueId);
  }

  @Post('order-templates')
  async createTemplate(@VenueScope() scope: Scope, @Body() body: CreateOrderTemplateDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.createTemplate({
      organizationId: orgId,
      facilityId: scope.venueId,
      createdById: scope.userId,
      ...body,
    });
  }

  @Delete('order-templates/:id')
  async deleteTemplate(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.deleteTemplate(orgId, scope.venueId, id);
  }

  @Post('orders/from-template')
  async createOrderFromTemplate(
    @VenueScope() scope: Scope,
    @Body() body: CreateOrderFromTemplateDto,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const template = await this.workforce.getTemplate(orgId, scope.venueId, body.templateId);

    return this.service.createOrder(
      orgId,
      scope.venueId,
      {
        title: body.title ?? `${template.name} — ${body.shiftDate}`,
        roleRequired: template.roleRequired,
        quantityRequested: template.quantityRequested,
        shiftDate: body.shiftDate,
        startTime: template.startTime,
        endTime: template.endTime,
        durationHours: template.durationHours,
        budgetCents: template.budgetCents || undefined,
        specialRequirements: template.specialRequirements ?? undefined,
        templateName: template.name,
        eventId: body.eventId,
      },
      scope.userId,
    );
  }

  @Post('orders/:id/clone')
  async cloneOrder(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: { shiftDate?: string },
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const source = await this.service.getOrder(id, orgId, scope.venueId);

    return this.service.createOrder(
      orgId,
      scope.venueId,
      {
        title: `${source.title} (copy)`,
        roleRequired: source.roleRequired,
        quantityRequested: source.quantityRequested,
        shiftDate: body?.shiftDate ?? source.shiftDate,
        startTime: source.startTime,
        endTime: source.endTime,
        durationHours: source.durationHours,
        budgetCents: source.budgetCents || undefined,
        specialRequirements: source.specialRequirements ?? undefined,
        templateName: source.templateName ?? undefined,
      },
      scope.userId,
    );
  }

  // ---------------------------------------------------------------------------
  // BULK IMPORT / EXPORT  (checklist 1.1, 1.2)
  // ---------------------------------------------------------------------------

  @Post('vendors/import')
  async importVendors(@VenueScope() scope: Scope, @Body() body: CsvImportDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const result = await this.workforce.importVendorsCsv(orgId, scope.venueId, body.csv);

    await this.service.logAudit({
      organizationId: orgId,
      facilityId: scope.venueId,
      entityType: 'VmsVendor',
      entityId: 'bulk-import',
      action: 'BULK_IMPORT',
      userId: scope.userId,
      changes: { imported: result.imported, skipped: result.skipped, parsed: result.parsed },
    });

    return result;
  }

  @Post('staff/import')
  async importStaff(@VenueScope() scope: Scope, @Body() body: CsvImportDto) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    const result = await this.workforce.importStaffCsv(orgId, scope.venueId, body.csv);

    await this.service.logAudit({
      organizationId: orgId,
      facilityId: scope.venueId,
      entityType: 'VmsStaffMember',
      entityId: 'bulk-import',
      action: 'BULK_IMPORT',
      userId: scope.userId,
      changes: { imported: result.imported, skipped: result.skipped, parsed: result.parsed },
    });

    return result;
  }

  @Get('staff/export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="staff-roster.csv"')
  async exportStaff(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.workforce.exportStaffCsv(orgId, scope.venueId);
  }

  // ---------------------------------------------------------------------------
  // NOTIFICATIONS  (checklist 4.3)
  // ---------------------------------------------------------------------------

  @Get('notifications/log')
  async listNotificationLog(
    @VenueScope() scope: Scope,
    @Query('eventType') eventType?: VmsNotificationEvent,
    @Query('status') status?: VmsNotificationStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.assertManager(scope);
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.notifications.listDeliveryLog(orgId, scope.venueId, {
      eventType,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('notifications/preferences')
  async listNotificationPreferences(@VenueScope() scope: Scope) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.notifications.listPreferences(orgId, scope.venueId, scope.userId);
  }

  @Put('notifications/preferences')
  async setNotificationPreference(
    @VenueScope() scope: Scope,
    @Body() body: SetNotificationPreferenceDto,
  ) {
    const orgId = await this.organizationIdFor(scope.venueId);
    return this.notifications.setPreference({
      organizationId: orgId,
      facilityId: scope.venueId,
      userId: scope.userId,
      eventType: body.eventType,
      emailEnabled: body.emailEnabled,
      smsEnabled: body.smsEnabled,
    });
  }

  /**
   * Manual trigger for the scheduled sweeps. The crons run these on their own
   * timers; this exists so an operator can force a run and so the behaviour is
   * testable without waiting on the scheduler.
   */
  @Post('maintenance/run-sweeps')
  async runSweeps(@VenueScope() scope: Scope) {
    this.assertManager(scope);
    const [noShows, escalations, certifications] = await Promise.all([
      this.scheduler.runNoShowSweep(),
      this.scheduler.runFulfillmentEscalation(),
      this.scheduler.runCertificationExpiryCheck(),
    ]);
    return { noShows, escalations, certifications };
  }
}
