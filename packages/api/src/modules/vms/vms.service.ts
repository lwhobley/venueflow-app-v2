import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VmsAttendanceStatus,
  VmsFulfillmentStatus,
  VmsOrderStatus,
  VmsSyncSystem,
  VmsVendorStatus,
  VmsVendorType,
} from '@prisma/client';
import {
  ApproveAttendanceDto,
  ClockInDto,
  ClockOutDto,
  CreateStaffingOrderDto,
  CreateVendorDto,
  CreateVendorServiceDto,
  CreateVmsStaffMemberDto,
  SubmitOrderBidDto,
  UpdateVendorDto,
} from './vms.dto';
import { VmsAiService } from './vms-ai.service';
import { VmsIntegrationsService } from './vms-integrations.service';

@Injectable()
export class VmsService {
  private readonly logger = new Logger(VmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: VmsAiService,
    private readonly integrationsService: VmsIntegrationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // VENDORS
  // ---------------------------------------------------------------------------

  async listVendors(params: {
    organizationId: string;
    facilityId: string;
    status?: VmsVendorStatus;
    vendorType?: VmsVendorType;
    search?: string;
  }) {
    const where: any = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.status) where.status = params.status;
    if (params.vendorType) where.vendorType = params.vendorType;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { code: { contains: params.search, mode: 'insensitive' } },
        { contactEmail: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.vmsVendor.findMany({
      where,
      include: {
        services: true,
        _count: {
          select: {
            staffMembers: true,
            orderFulfillments: true,
          },
        },
      },
      orderBy: { rating: 'desc' },
    });
  }

  async getVendor(id: string, organizationId: string, facilityId: string) {
    const vendor = await this.prisma.vmsVendor.findFirst({
      where: { id, organizationId, facilityId },
      include: {
        services: true,
        staffMembers: { take: 50 },
        orderFulfillments: {
          take: 20,
          include: { order: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async createVendor(
    organizationId: string,
    facilityId: string,
    dto: CreateVendorDto,
    userId: string,
  ) {
    const existing = await this.prisma.vmsVendor.findUnique({
      where: {
        organizationId_facilityId_code: {
          organizationId,
          facilityId,
          code: dto.code.trim().toUpperCase(),
        },
      },
    });
    if (existing) {
      throw new BadRequestException(`Vendor with code ${dto.code} already exists in this facility.`);
    }

    const vendor = await this.prisma.vmsVendor.create({
      data: {
        organizationId,
        facilityId,
        name: dto.name,
        code: dto.code.trim().toUpperCase(),
        vendorType: dto.vendorType || VmsVendorType.staffing_agency,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        billingRateMultiplier: dto.billingRateMultiplier ?? 1.35,
        taxId: dto.taxId,
        insuranceExpiry: dto.insuranceExpiry ? new Date(dto.insuranceExpiry) : undefined,
        metadata: dto.metadata ? (dto.metadata as any) : undefined,
      },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsVendor',
      entityId: vendor.id,
      action: 'CREATE',
      userId,
      changes: { name: vendor.name, code: vendor.code },
    });

    return vendor;
  }

  async updateVendor(
    id: string,
    organizationId: string,
    facilityId: string,
    dto: UpdateVendorDto,
    userId: string,
  ) {
    await this.getVendor(id, organizationId, facilityId);

    const updated = await this.prisma.vmsVendor.update({
      where: { id },
      data: {
        name: dto.name,
        vendorType: dto.vendorType,
        status: dto.status,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        rating: dto.rating,
        billingRateMultiplier: dto.billingRateMultiplier,
        taxId: dto.taxId,
        insuranceExpiry: dto.insuranceExpiry ? new Date(dto.insuranceExpiry) : undefined,
        metadata: dto.metadata ? (dto.metadata as any) : undefined,
      },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsVendor',
      entityId: id,
      action: 'UPDATE',
      userId,
      changes: dto as Record<string, unknown>,
    });

    return updated;
  }

  async deleteVendor(id: string, organizationId: string, facilityId: string, userId: string) {
    await this.getVendor(id, organizationId, facilityId);
    await this.prisma.vmsVendor.delete({ where: { id } });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsVendor',
      entityId: id,
      action: 'DELETE',
      userId,
      changes: {},
    });

    return { success: true };
  }

  async addVendorService(
    vendorId: string,
    organizationId: string,
    facilityId: string,
    dto: CreateVendorServiceDto,
  ) {
    await this.getVendor(vendorId, organizationId, facilityId);

    return this.prisma.vmsVendorService.create({
      data: {
        vendorId,
        serviceType: dto.serviceType,
        hourlyRateCents: dto.hourlyRateCents,
        overtimeRateCents: dto.overtimeRateCents ?? Math.round(dto.hourlyRateCents * 1.5),
        minimumNoticeHours: dto.minimumNoticeHours ?? 24,
        availabilityJson: dto.availabilityJson ? (dto.availabilityJson as any) : undefined,
        active: dto.active ?? true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // STAFF MEMBERS
  // ---------------------------------------------------------------------------

  async listStaffMembers(params: {
    organizationId: string;
    facilityId: string;
    vendorId?: string;
    role?: string;
  }) {
    const where: any = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.vendorId) where.vendorId = params.vendorId;

    return this.prisma.vmsStaffMember.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, code: true, vendorType: true } },
      },
      orderBy: { lastName: 'asc' },
    });
  }

  async createStaffMember(
    organizationId: string,
    facilityId: string,
    dto: CreateVmsStaffMemberDto,
  ) {
    return this.prisma.vmsStaffMember.create({
      data: {
        organizationId,
        facilityId,
        vendorId: dto.vendorId,
        workforceType: dto.workforceType,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        skills: dto.skills ?? [],
        certifications: dto.certifications ? (dto.certifications as any) : undefined,
        hourlyRateCents: dto.hourlyRateCents ?? 2500,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // STAFFING ORDERS & REQUISITIONS
  // ---------------------------------------------------------------------------

  async listOrders(params: {
    organizationId: string;
    facilityId: string;
    status?: VmsOrderStatus;
    shiftDate?: string;
  }) {
    const where: any = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.status) where.status = params.status;
    if (params.shiftDate) where.shiftDate = params.shiftDate;

    return this.prisma.vmsStaffingOrder.findMany({
      where,
      include: {
        fulfillments: {
          include: {
            vendor: { select: { id: true, name: true, code: true, rating: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrder(id: string, organizationId: string, facilityId: string) {
    const order = await this.prisma.vmsStaffingOrder.findFirst({
      where: { id, organizationId, facilityId },
      include: {
        fulfillments: {
          include: {
            vendor: true,
          },
        },
        attendances: {
          include: {
            staffMember: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Staffing order not found');
    return order;
  }

  async createOrder(
    organizationId: string,
    facilityId: string,
    dto: CreateStaffingOrderDto,
    userId: string,
  ) {
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    const durationHours = dto.durationHours || 4.0;
    const budgetCents = dto.budgetCents || dto.quantityRequested * durationHours * 2500;

    const order = await this.prisma.vmsStaffingOrder.create({
      data: {
        organizationId,
        facilityId,
        orderNumber,
        title: dto.title,
        roleRequired: dto.roleRequired,
        quantityRequested: dto.quantityRequested,
        shiftDate: dto.shiftDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        durationHours,
        budgetCents,
        specialRequirements: dto.specialRequirements,
        templateName: dto.templateName,
        eventId: dto.eventId,
        status: VmsOrderStatus.requested,
        createdById: userId,
      },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsStaffingOrder',
      entityId: order.id,
      action: 'CREATE',
      userId,
      changes: { orderNumber: order.orderNumber, role: order.roleRequired },
    });

    return order;
  }

  async updateOrderStatus(
    orderId: string,
    organizationId: string,
    facilityId: string,
    status: VmsOrderStatus,
    userId: string,
  ) {
    const order = await this.getOrder(orderId, organizationId, facilityId);
    const updated = await this.prisma.vmsStaffingOrder.update({
      where: { id: order.id },
      data: { status },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsStaffingOrder',
      entityId: order.id,
      action: 'STATUS_CHANGE',
      userId,
      changes: { from: order.status, to: status },
    });

    return updated;
  }

  async submitOrderBid(
    orderId: string,
    organizationId: string,
    facilityId: string,
    dto: SubmitOrderBidDto,
  ) {
    const order = await this.getOrder(orderId, organizationId, facilityId);
    const totalBidCents = Math.round(
      dto.staffCountAssigned * order.durationHours * dto.bidHourlyRateCents,
    );

    return this.prisma.vmsOrderFulfillment.create({
      data: {
        orderId: order.id,
        vendorId: dto.vendorId,
        staffCountAssigned: dto.staffCountAssigned,
        bidHourlyRateCents: dto.bidHourlyRateCents,
        totalBidCents,
        status: VmsFulfillmentStatus.bid_submitted,
        notes: dto.notes,
      },
      include: {
        vendor: true,
      },
    });
  }

  async confirmOrderBid(
    fulfillmentId: string,
    organizationId: string,
    facilityId: string,
    userId: string,
  ) {
    const fulfillment = await this.prisma.vmsOrderFulfillment.findUnique({
      where: { id: fulfillmentId },
      include: { order: true },
    });
    if (!fulfillment) throw new NotFoundException('Fulfillment bid not found');
    if (fulfillment.order.facilityId !== facilityId) {
      throw new BadRequestException('Fulfillment does not belong to this facility');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const f = await tx.vmsOrderFulfillment.update({
        where: { id: fulfillmentId },
        data: {
          status: VmsFulfillmentStatus.confirmed,
          confirmedAt: new Date(),
        },
      });

      const allConfirmed = await tx.vmsOrderFulfillment.findMany({
        where: { orderId: fulfillment.orderId, status: VmsFulfillmentStatus.confirmed },
      });
      const totalFulfilled = allConfirmed.reduce((sum, item) => sum + item.staffCountAssigned, 0);

      await tx.vmsStaffingOrder.update({
        where: { id: fulfillment.orderId },
        data: {
          quantityFulfilled: totalFulfilled,
          status:
            totalFulfilled >= fulfillment.order.quantityRequested
              ? VmsOrderStatus.confirmed
              : VmsOrderStatus.booked,
          actualCostCents: allConfirmed.reduce((sum, item) => sum + item.totalBidCents, 0),
        },
      });

      return f;
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsOrderFulfillment',
      entityId: fulfillmentId,
      action: 'CONFIRM_BID',
      userId,
      changes: { vendorId: fulfillment.vendorId, staffCount: fulfillment.staffCountAssigned },
    });

    return updated;
  }

  /**
   * Gemini-Powered Smart Vendor Matching for a Staffing Order
   */
  async matchVendorsForOrder(orderId: string, organizationId: string, facilityId: string) {
    const order = await this.getOrder(orderId, organizationId, facilityId);
    const vendors = await this.prisma.vmsVendor.findMany({
      where: { organizationId, facilityId, status: VmsVendorStatus.active },
      include: {
        services: { where: { active: true } },
        staffMembers: { where: { status: 'active' } },
      },
    });

    const candidates = vendors
      .map((v) => {
        const matchingService = v.services.find(
          (s) => s.serviceType.toLowerCase() === order.roleRequired.toLowerCase(),
        );
        const hourlyRateCents = matchingService?.hourlyRateCents ?? 2800;
        const overtimeRateCents = matchingService?.overtimeRateCents ?? Math.round(hourlyRateCents * 1.5);
        const minimumNoticeHours = matchingService?.minimumNoticeHours ?? 24;

        return {
          vendorId: v.id,
          vendorName: v.name,
          vendorType: v.vendorType,
          rating: v.rating,
          billingMultiplier: v.billingRateMultiplier,
          serviceType: matchingService?.serviceType || order.roleRequired,
          hourlyRateCents,
          overtimeRateCents,
          minimumNoticeHours,
          activeStaffCount: v.staffMembers.length,
        };
      })
      .filter((c) => c !== null);

    return this.aiService.matchVendorsForOrder(
      {
        roleRequired: order.roleRequired,
        quantityRequested: order.quantityRequested,
        shiftDate: order.shiftDate,
        durationHours: order.durationHours,
        budgetCents: order.budgetCents,
        specialRequirements: order.specialRequirements,
      },
      candidates,
    );
  }

  /**
   * Gemini Natural Language Requisition Parse
   */
  async parseNaturalLanguageOrder(prompt: string) {
    return this.aiService.parseNaturalLanguageOrder(prompt);
  }

  // ---------------------------------------------------------------------------
  // TIME & ATTENDANCE TRACKING
  // ---------------------------------------------------------------------------

  async clockIn(
    organizationId: string,
    facilityId: string,
    dto: ClockInDto,
  ) {
    const staff = await this.prisma.vmsStaffMember.findFirst({
      where: { id: dto.staffMemberId, organizationId, facilityId },
      include: { vendor: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const activePunch = await this.prisma.vmsTimeAttendance.findFirst({
      where: {
        staffMemberId: dto.staffMemberId,
        facilityId,
        status: VmsAttendanceStatus.clocked_in,
      },
    });
    if (activePunch) {
      throw new BadRequestException('Staff member already clocked in.');
    }

    const rateCents = staff.hourlyRateCents;

    return this.prisma.vmsTimeAttendance.create({
      data: {
        organizationId,
        facilityId,
        staffMemberId: dto.staffMemberId,
        orderId: dto.orderId,
        clockIn: new Date(),
        billedRateCents: rateCents,
        status: VmsAttendanceStatus.clocked_in,
        deviceInfo: dto.deviceInfo,
        gpsLatitude: dto.gpsLatitude,
        gpsLongitude: dto.gpsLongitude,
        isWithinGeofence: true,
      },
      include: {
        staffMember: true,
      },
    });
  }

  async clockOut(
    organizationId: string,
    facilityId: string,
    dto: ClockOutDto,
  ) {
    const attendance = await this.prisma.vmsTimeAttendance.findFirst({
      where: { id: dto.attendanceId, organizationId, facilityId },
      include: { staffMember: true },
    });
    if (!attendance) throw new NotFoundException('Attendance record not found');
    if (attendance.status !== VmsAttendanceStatus.clocked_in) {
      throw new BadRequestException('Record is not in clocked_in status');
    }

    const clockOutTime = new Date();
    const durationMs = clockOutTime.getTime() - new Date(attendance.clockIn).getTime();
    const rawHours = Math.max(0.1, Number((durationMs / (1000 * 3600)).toFixed(2)));
    const breakMinutes = dto.breakMinutes ?? 0;
    const billableHours = Math.max(0.1, Number((rawHours - breakMinutes / 60).toFixed(2)));

    // Deviation & Exception flags
    const deviationFlags: string[] = [];
    if (billableHours >= 5.0 && breakMinutes < 30) {
      deviationFlags.push('meal_break_penalty');
    }
    if (billableHours > 8.0) {
      deviationFlags.push('overtime');
    }
    if (billableHours > 12.0) {
      deviationFlags.push('double_time');
    }

    const totalBilledCents = Math.round(billableHours * attendance.billedRateCents);

    return this.prisma.vmsTimeAttendance.update({
      where: { id: dto.attendanceId },
      data: {
        clockOut: clockOutTime,
        hoursWorked: rawHours,
        breakMinutes,
        billableHours,
        totalBilledCents,
        deviationFlags,
        status: deviationFlags.length > 0 ? VmsAttendanceStatus.flagged_exception : VmsAttendanceStatus.clocked_out,
      },
      include: { staffMember: true },
    });
  }

  async approveAttendance(
    attendanceId: string,
    organizationId: string,
    facilityId: string,
    userId: string,
    _dto?: ApproveAttendanceDto,
  ) {
    const attendance = await this.prisma.vmsTimeAttendance.findFirst({
      where: { id: attendanceId, organizationId, facilityId },
    });
    if (!attendance) throw new NotFoundException('Attendance record not found');

    const updated = await this.prisma.vmsTimeAttendance.update({
      where: { id: attendanceId },
      data: {
        status: VmsAttendanceStatus.approved,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
      include: { staffMember: true },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsTimeAttendance',
      entityId: attendanceId,
      action: 'APPROVE_HOURS',
      userId,
      changes: { billableHours: updated.billableHours, totalBilledCents: updated.totalBilledCents },
    });

    return updated;
  }

  async listAttendanceReports(params: {
    organizationId: string;
    facilityId: string;
    startDate?: string;
    endDate?: string;
    status?: VmsAttendanceStatus;
  }) {
    const where: any = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.status) where.status = params.status;
    if (params.startDate || params.endDate) {
      where.clockIn = {};
      if (params.startDate) where.clockIn.gte = new Date(params.startDate);
      if (params.endDate) where.clockIn.lte = new Date(params.endDate);
    }

    return this.prisma.vmsTimeAttendance.findMany({
      where,
      include: {
        staffMember: {
          include: { vendor: { select: { id: true, name: true, code: true } } },
        },
        order: { select: { id: true, orderNumber: true, roleRequired: true } },
      },
      orderBy: { clockIn: 'desc' },
    });
  }

  async exportPayrollAdp(organizationId: string, facilityId: string) {
    const records = await this.prisma.vmsTimeAttendance.findMany({
      where: {
        organizationId,
        facilityId,
        status: { in: [VmsAttendanceStatus.approved, VmsAttendanceStatus.clocked_out] },
      },
      include: { staffMember: true },
      orderBy: { clockIn: 'asc' },
    });

    return this.integrationsService.generateAdpExportCsv(records);
  }

  async exportPayrollGusto(organizationId: string, facilityId: string) {
    const records = await this.prisma.vmsTimeAttendance.findMany({
      where: {
        organizationId,
        facilityId,
        status: { in: [VmsAttendanceStatus.approved, VmsAttendanceStatus.clocked_out] },
      },
      include: { staffMember: true },
      orderBy: { clockIn: 'asc' },
    });

    const now = new Date();
    const periodStart = new Date(now.getTime() - 14 * 86400 * 1000).toISOString().split('T')[0];
    const periodEnd = now.toISOString().split('T')[0];

    return this.integrationsService.generateGustoExportJson(records, periodStart, periodEnd);
  }

  // ---------------------------------------------------------------------------
  // INVENTORY & SYNC
  // ---------------------------------------------------------------------------

  async syncInventory(
    organizationId: string,
    facilityId: string,
    system?: VmsSyncSystem,
    syncType?: string,
    items?: Array<{ sku: string; name: string; quantity: number }>,
  ) {
    return this.integrationsService.syncInventory({
      organizationId,
      facilityId,
      system,
      syncType,
      customItems: items,
    });
  }

  async getInventoryStatus(organizationId: string, facilityId: string) {
    const logs = await this.prisma.vmsInventorySyncLog.findMany({
      where: { organizationId, facilityId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Provide real-time stock snapshot
    const activeSync = await this.integrationsService.syncInventory({ organizationId, facilityId });

    return {
      lastSyncTime: logs[0]?.createdAt ?? new Date(),
      totalSystemsConnected: 3, // Yellow Dog, MarginEdge, Toast
      connectedSystems: ['Yellow Dog', 'MarginEdge', 'Toast POS'],
      supplies: activeSync.supplies,
      recentSyncLogs: logs,
    };
  }

  // ---------------------------------------------------------------------------
  // ANALYTICS & SCORECARDS
  // ---------------------------------------------------------------------------

  async getVendorScorecard(organizationId: string, facilityId: string) {
    const vendors = await this.prisma.vmsVendor.findMany({
      where: { organizationId, facilityId },
      include: {
        orderFulfillments: true,
        staffMembers: {
          include: { attendances: true },
        },
      },
    });

    return vendors.map((v) => {
      const allFulfillments = v.orderFulfillments;
      const totalOrdersAssigned = allFulfillments.length;
      const confirmedOrders = allFulfillments.filter(
        (f) => f.status === VmsFulfillmentStatus.confirmed || f.status === VmsFulfillmentStatus.completed,
      ).length;

      const allAttendances = v.staffMembers.flatMap((s) => s.attendances);
      const totalPunches = allAttendances.length;
      const onTimeDeliveries = allAttendances.filter((a) => !a.deviationFlags.includes('no_show')).length;
      const onTimeRatePercent = totalPunches > 0 ? Math.round((onTimeDeliveries / totalPunches) * 100) : 98;
      const totalBilledCents = allAttendances.reduce((sum, a) => sum + a.totalBilledCents, 0);

      return {
        vendorId: v.id,
        vendorName: v.name,
        code: v.code,
        rating: v.rating,
        totalOrdersAssigned,
        fulfillmentRatePercent: totalOrdersAssigned > 0 ? Math.round((confirmedOrders / totalOrdersAssigned) * 100) : 100,
        onTimeRatePercent,
        totalBilledCents,
        tierStatus: v.rating >= 4.5 ? 'Tier 1 Preferred' : 'Standard Approved',
      };
    });
  }

  async getCostBreakdown(organizationId: string, facilityId: string) {
    const orders = await this.prisma.vmsStaffingOrder.findMany({
      where: { organizationId, facilityId },
      select: {
        roleRequired: true,
        budgetCents: true,
        actualCostCents: true,
        status: true,
      },
    });

    const breakdownByRole: Record<string, { budgetCents: number; actualCents: number; orderCount: number }> = {};
    let totalBudgetCents = 0;
    let totalActualCents = 0;

    for (const o of orders) {
      if (!breakdownByRole[o.roleRequired]) {
        breakdownByRole[o.roleRequired] = { budgetCents: 0, actualCents: 0, orderCount: 0 };
      }
      breakdownByRole[o.roleRequired].budgetCents += o.budgetCents;
      breakdownByRole[o.roleRequired].actualCents += o.actualCostCents;
      breakdownByRole[o.roleRequired].orderCount += 1;

      totalBudgetCents += o.budgetCents;
      totalActualCents += o.actualCostCents;
    }

    return {
      totalBudgetCents,
      totalActualCents,
      costSavingsCents: Math.max(0, totalBudgetCents - totalActualCents),
      roles: Object.entries(breakdownByRole).map(([role, data]) => ({
        role,
        ...data,
      })),
    };
  }

  async getDemandForecast(
    _organizationId: string,
    _facilityId: string,
    eventParams?: { name?: string; type?: string; expectedAttendance?: number; hours?: number },
  ) {
    return this.aiService.forecastStaffingDemand({
      name: eventParams?.name || 'Championship Matchday',
      type: eventParams?.type || 'stadium_sports',
      expectedAttendance: eventParams?.expectedAttendance || 42000,
      hours: eventParams?.hours || 4.5,
    });
  }

  async getAttendanceAnomalies(organizationId: string, facilityId: string) {
    const records = await this.prisma.vmsTimeAttendance.findMany({
      where: { organizationId, facilityId },
      include: { staffMember: true },
      orderBy: { clockIn: 'desc' },
      take: 100,
    });

    const mapped = records.map((r) => ({
      id: r.id,
      staffName: `${r.staffMember.firstName} ${r.staffMember.lastName}`,
      hoursWorked: r.hoursWorked,
      breakMinutes: r.breakMinutes,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      isWithinGeofence: r.isWithinGeofence,
      deviationFlags: r.deviationFlags,
    }));

    return this.aiService.detectAttendanceAnomalies(mapped);
  }

  // ---------------------------------------------------------------------------
  // AUDIT LOGGING
  // ---------------------------------------------------------------------------

  private async logAudit(params: {
    organizationId: string;
    facilityId: string;
    entityType: string;
    entityId: string;
    action: string;
    userId: string;
    changes: Record<string, unknown>;
  }) {
    try {
      await this.prisma.vmsAuditLog.create({
        data: {
          organizationId: params.organizationId,
          facilityId: params.facilityId,
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          performedByUserId: params.userId,
          changes: params.changes ? (params.changes as any) : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record audit log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getAuditLogs(organizationId: string, facilityId: string) {
    return this.prisma.vmsAuditLog.findMany({
      where: { organizationId, facilityId },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
  }
}
