import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
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
    page?: number;
    limit?: number;
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

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    return this.prisma.vmsVendor.findMany({
      where,
      skip,
      take: limit,
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
    const previous = await this.getVendor(id, organizationId, facilityId);

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
      before: { name: previous.name, status: previous.status, rating: previous.rating },
      changes: dto as Record<string, unknown>,
    });

    return updated;
  }

  async deactivateVendor(
    id: string,
    organizationId: string,
    facilityId: string,
    userId: string,
    reason?: string,
  ) {
    const vendor = await this.getVendor(id, organizationId, facilityId);
    const updated = await this.prisma.vmsVendor.update({
      where: { id },
      data: { status: VmsVendorStatus.inactive },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsVendor',
      entityId: id,
      action: 'DEACTIVATE',
      userId,
      before: { status: vendor.status },
      changes: { status: VmsVendorStatus.inactive, reason },
    });

    return updated;
  }

  async deleteVendor(id: string, organizationId: string, facilityId: string, userId: string) {
    const vendor = await this.getVendor(id, organizationId, facilityId);
    const activeFulfillments = await this.prisma.vmsOrderFulfillment.count({
      where: {
        vendorId: id,
        status: {
          in: [
            VmsFulfillmentStatus.bid_submitted,
            VmsFulfillmentStatus.bid_accepted,
            VmsFulfillmentStatus.confirmed,
          ],
        },
      },
    });

    if (activeFulfillments > 0) {
      throw new BadRequestException(
        `Cannot delete vendor '${vendor.name}': there are ${activeFulfillments} active or confirmed order fulfillments associated with this vendor. Please deactivate the vendor instead to preserve historical records.`,
      );
    }

    await this.prisma.vmsVendor.delete({ where: { id } });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsVendor',
      entityId: id,
      action: 'DELETE',
      userId,
      before: { id: vendor.id, code: vendor.code, name: vendor.name },
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
    page?: number;
    limit?: number;
  }) {
    const where: any = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.vendorId) where.vendorId = params.vendorId;
    if (params.role) where.skills = { has: params.role };

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    return this.prisma.vmsStaffMember.findMany({
      where,
      skip,
      take: limit,
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
    userId?: string,
  ) {
    // Validate vendor ownership if supplied (F3)
    if (dto.vendorId) {
      await this.getVendor(dto.vendorId, organizationId, facilityId);
    }

    let pinHash: string | undefined;
    let pinSalt: string | undefined;
    if (dto.pin) {
      pinSalt = crypto.randomBytes(16).toString('hex');
      pinHash = crypto.createHash('sha256').update(dto.pin + pinSalt).digest('hex');
    }

    const staff = await this.prisma.vmsStaffMember.create({
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
        badgeNumber: dto.badgeNumber,
        pinHash,
        pinSalt,
      },
      include: {
        vendor: true,
      },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsStaffMember',
      entityId: staff.id,
      action: 'CREATE',
      userId: userId || 'system',
      changes: { firstName: staff.firstName, lastName: staff.lastName, vendorId: staff.vendorId },
    });

    return staff;
  }

  // ---------------------------------------------------------------------------
  // STAFFING ORDERS & REQUISITIONS
  // ---------------------------------------------------------------------------

  async listOrders(params: {
    organizationId: string;
    facilityId: string;
    status?: VmsOrderStatus;
    shiftDate?: string;
    page?: number;
    limit?: number;
  }) {
    const where: any = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.status) where.status = params.status;
    if (params.shiftDate) where.shiftDate = params.shiftDate;

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    return this.prisma.vmsStaffingOrder.findMany({
      where,
      skip,
      take: limit,
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
    cancellationReason?: string,
  ) {
    const order = await this.getOrder(orderId, organizationId, facilityId);

    // Order status transition state machine (F7)
    const validTransitions: Record<VmsOrderStatus, VmsOrderStatus[]> = {
      [VmsOrderStatus.draft]: [VmsOrderStatus.requested, VmsOrderStatus.cancelled],
      [VmsOrderStatus.requested]: [VmsOrderStatus.quoted, VmsOrderStatus.booked, VmsOrderStatus.confirmed, VmsOrderStatus.cancelled],
      [VmsOrderStatus.quoted]: [VmsOrderStatus.booked, VmsOrderStatus.confirmed, VmsOrderStatus.cancelled],
      [VmsOrderStatus.booked]: [VmsOrderStatus.confirmed, VmsOrderStatus.completed, VmsOrderStatus.cancelled],
      [VmsOrderStatus.confirmed]: [VmsOrderStatus.completed, VmsOrderStatus.cancelled],
      [VmsOrderStatus.completed]: [],
      [VmsOrderStatus.cancelled]: [],
    };

    const allowed = validTransitions[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Invalid order status transition from '${order.status}' to '${status}'. Allowed transitions: [${allowed.join(', ')}]`,
      );
    }

    const updated = await this.prisma.vmsStaffingOrder.update({
      where: { id: order.id },
      data: {
        status,
        cancellationReason: status === VmsOrderStatus.cancelled ? cancellationReason : undefined,
      },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsStaffingOrder',
      entityId: order.id,
      action: 'STATUS_CHANGE',
      userId,
      before: { status: order.status },
      changes: { from: order.status, to: status, cancellationReason },
    });

    return updated;
  }

  async getUnfilledOrdersNeedingEscalation(organizationId: string, facilityId: string) {
    const now = new Date();
    const in48Hours = new Date(now.getTime() + 48 * 3600 * 1000);
    const shiftDateCutoff = in48Hours.toISOString().split('T')[0];

    return this.prisma.vmsStaffingOrder.findMany({
      where: {
        organizationId,
        facilityId,
        status: {
          in: [
            VmsOrderStatus.draft,
            VmsOrderStatus.requested,
            VmsOrderStatus.quoted,
            VmsOrderStatus.booked,
          ],
        },
        shiftDate: { lte: shiftDateCutoff },
      },
      include: {
        fulfillments: { include: { vendor: true } },
      },
      orderBy: { shiftDate: 'asc' },
    });
  }

  async submitOrderBid(
    orderId: string,
    organizationId: string,
    facilityId: string,
    dto: SubmitOrderBidDto,
    userId?: string,
  ) {
    const order = await this.getOrder(orderId, organizationId, facilityId);
    // Validate vendor belongs to caller's organization and facility (F3)
    const vendor = await this.getVendor(dto.vendorId, organizationId, facilityId);

    const totalBidCents = Math.round(
      dto.staffCountAssigned * order.durationHours * dto.bidHourlyRateCents,
    );

    const fulfillment = await this.prisma.vmsOrderFulfillment.create({
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

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsOrderFulfillment',
      entityId: fulfillment.id,
      action: 'SUBMIT_BID',
      userId: userId || 'system',
      changes: {
        orderId: order.id,
        vendorId: vendor.id,
        vendorName: vendor.name,
        staffCount: dto.staffCountAssigned,
        bidHourlyRateCents: dto.bidHourlyRateCents,
      },
    });

    return fulfillment;
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

  calculateHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  async clockIn(
    organizationId: string,
    facilityId: string,
    dto: ClockInDto,
    options?: { isManager?: boolean; callerUserId?: string; ipAddress?: string },
  ) {
    const staff = await this.prisma.vmsStaffMember.findFirst({
      where: { id: dto.staffMemberId, organizationId, facilityId },
      include: { vendor: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    // Worker credential check (B4):
    if (!options?.isManager) {
      if (staff.pinHash && staff.pinSalt) {
        if (!dto.pin) {
          throw new BadRequestException('Worker PIN required for clock-in.');
        }
        const hash = crypto.createHash('sha256').update(dto.pin + staff.pinSalt).digest('hex');
        if (hash !== staff.pinHash) {
          throw new BadRequestException('Invalid worker PIN.');
        }
      } else if (staff.badgeNumber) {
        if (!dto.badgeCode || dto.badgeCode.trim().toLowerCase() !== staff.badgeNumber.trim().toLowerCase()) {
          throw new BadRequestException('Invalid worker badge code.');
        }
      }
    }

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

    // Geofencing verification (F1):
    let isWithinGeofence = true;
    const deviationFlags: string[] = [];

    if (dto.gpsLatitude != null && dto.gpsLongitude != null) {
      const facility = await this.prisma.facility.findUnique({
        where: { organizationId_id: { organizationId, id: facilityId } },
        select: { latitude: true, longitude: true },
      });

      if (facility?.latitude != null && facility?.longitude != null) {
        const distanceMeters = this.calculateHaversineDistanceMeters(
          dto.gpsLatitude,
          dto.gpsLongitude,
          facility.latitude,
          facility.longitude,
        );
        if (distanceMeters > 500) {
          isWithinGeofence = false;
          deviationFlags.push('off_site_punch');
        }
      }
    }

    // Apply vendor billing rate multiplier (F11):
    const multiplier = staff.vendor?.billingRateMultiplier ?? 1.0;
    const rateCents = Math.round(staff.hourlyRateCents * multiplier);

    const attendance = await this.prisma.vmsTimeAttendance.create({
      data: {
        organizationId,
        facilityId,
        staffMemberId: dto.staffMemberId,
        orderId: dto.orderId,
        clockIn: new Date(),
        billedRateCents: rateCents,
        status: deviationFlags.length > 0 ? VmsAttendanceStatus.flagged_exception : VmsAttendanceStatus.clocked_in,
        deviceInfo: dto.deviceInfo,
        gpsLatitude: dto.gpsLatitude,
        gpsLongitude: dto.gpsLongitude,
        isWithinGeofence,
        deviationFlags,
      },
      include: {
        staffMember: true,
      },
    });

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsTimeAttendance',
      entityId: attendance.id,
      action: 'CLOCK_IN',
      userId: options?.callerUserId || staff.id,
      ipAddress: options?.ipAddress,
      changes: { staffMemberId: staff.id, isWithinGeofence, deviationFlags },
    });

    return attendance;
  }

  async clockOut(
    organizationId: string,
    facilityId: string,
    dto: ClockOutDto,
    options?: { isManager?: boolean; callerUserId?: string; ipAddress?: string },
  ) {
    const attendance = await this.prisma.vmsTimeAttendance.findFirst({
      where: { id: dto.attendanceId, organizationId, facilityId },
      include: { staffMember: true },
    });
    if (!attendance) throw new NotFoundException('Attendance record not found');
    if (attendance.status !== VmsAttendanceStatus.clocked_in && attendance.status !== VmsAttendanceStatus.flagged_exception) {
      throw new BadRequestException('Record is not in active clocked-in status');
    }

    // Worker credential check on self clock-out (B4):
    if (!options?.isManager) {
      const staff = attendance.staffMember;
      if (staff?.pinHash && staff?.pinSalt) {
        if (!dto.pin) throw new BadRequestException('Worker PIN required for clock-out.');
        const hash = crypto.createHash('sha256').update(dto.pin + staff.pinSalt).digest('hex');
        if (hash !== staff.pinHash) throw new BadRequestException('Invalid worker PIN.');
      } else if (staff?.badgeNumber) {
        if (!dto.badgeCode || dto.badgeCode.trim().toLowerCase() !== staff.badgeNumber.trim().toLowerCase()) {
          throw new BadRequestException('Invalid worker badge code.');
        }
      }
    }

    const clockOutTime = new Date();
    const durationMs = clockOutTime.getTime() - new Date(attendance.clockIn).getTime();
    const rawHours = Math.max(0.1, Number((durationMs / (1000 * 3600)).toFixed(2)));

    // Validate breakMinutes: cannot exceed raw duration (B4)
    const breakMinutes = dto.breakMinutes ?? 0;
    if (breakMinutes > rawHours * 60) {
      throw new BadRequestException('Break minutes cannot exceed total shift duration.');
    }

    const billableHours = Math.max(0.1, Number((rawHours - breakMinutes / 60).toFixed(2)));

    // Deviation & Exception flags: statutory meal penalty rule
    const deviationFlags = [...(attendance.deviationFlags || [])];
    if (rawHours >= 5.0 && breakMinutes < 30) {
      if (!deviationFlags.includes('meal_break_penalty')) {
        deviationFlags.push('meal_break_penalty');
      }
    }
    if (billableHours > 8.0 && !deviationFlags.includes('overtime')) {
      deviationFlags.push('overtime');
    }
    if (billableHours > 12.0 && !deviationFlags.includes('double_time')) {
      deviationFlags.push('double_time');
    }

    const totalBilledCents = Math.round(billableHours * attendance.billedRateCents);

    const updated = await this.prisma.vmsTimeAttendance.update({
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

    await this.logAudit({
      organizationId,
      facilityId,
      entityType: 'VmsTimeAttendance',
      entityId: dto.attendanceId,
      action: 'CLOCK_OUT',
      userId: options?.callerUserId || attendance.staffMemberId,
      ipAddress: options?.ipAddress,
      before: { clockIn: attendance.clockIn, status: attendance.status },
      changes: { hoursWorked: rawHours, billableHours, deviationFlags, totalBilledCents },
    });

    return updated;
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

    // Pure read query for the latest snapshot - no DB mutation on GET! (F12, B3)
    const snapshot = await this.integrationsService.getLatestInventorySnapshot({ organizationId, facilityId });

    // Distinct systems that have actually performed a sync in this facility
    const distinctSystems = Array.from(new Set(logs.map((l) => l.system)));

    return {
      lastSyncTime: snapshot.lastSyncTime ?? (logs[0]?.createdAt ?? null),
      totalSystemsConnected: distinctSystems.length,
      connectedSystems: distinctSystems.length > 0 ? distinctSystems : ['yellow_dog (pending first sync)'],
      supplies: snapshot.supplies,
      recentSyncLogs: logs,
      status: snapshot.status,
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
      const onTimeDeliveries = allAttendances.filter(
        (a) => !a.deviationFlags.includes('no_show') && !a.deviationFlags.includes('off_site_punch'),
      ).length;

      // Real on-time calculation without fabricated 98% fallback (F1)
      const onTimeRatePercent = totalPunches > 0 ? Math.round((onTimeDeliveries / totalPunches) * 100) : null;
      const fulfillmentRatePercent = totalOrdersAssigned > 0 ? Math.round((confirmedOrders / totalOrdersAssigned) * 100) : null;
      const totalBilledCents = allAttendances.reduce((sum, a) => sum + a.totalBilledCents, 0);

      return {
        vendorId: v.id,
        vendorName: v.name,
        code: v.code,
        rating: v.rating,
        totalOrdersAssigned,
        fulfillmentRatePercent,
        onTimeRatePercent,
        hasData: totalPunches > 0 || totalOrdersAssigned > 0,
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
    organizationId: string,
    facilityId: string,
    eventParams?: { name?: string; type?: string; expectedAttendance?: number; hours?: number },
  ) {
    // Read historical orders to inform demand forecasting (F2)
    const pastOrders = await this.prisma.vmsStaffingOrder.findMany({
      where: { organizationId, facilityId },
      select: {
        roleRequired: true,
        quantityRequested: true,
        quantityFulfilled: true,
        durationHours: true,
      },
      take: 50,
    });

    return this.aiService.forecastStaffingDemand({
      name: eventParams?.name || 'Championship Matchday',
      type: eventParams?.type || 'stadium_sports',
      expectedAttendance: eventParams?.expectedAttendance || 42000,
      hours: eventParams?.hours || 4.5,
      historicalOrders: pastOrders,
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

  async logAudit(params: {
    organizationId: string;
    facilityId: string;
    entityType: string;
    entityId: string;
    action: string;
    userId: string;
    changes?: Record<string, unknown>;
    before?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    try {
      const payload = {
        ...(params.changes || {}),
        before: params.before,
        ipAddress: params.ipAddress,
      };

      await this.prisma.vmsAuditLog.create({
        data: {
          organizationId: params.organizationId,
          facilityId: params.facilityId,
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          performedByUserId: params.userId,
          changes: payload as any,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to record audit log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getAuditLogs(
    organizationId: string,
    facilityId: string,
    filters?: { entityType?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, filters?.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: any = { organizationId, facilityId };
    if (filters?.entityType) where.entityType = filters.entityType;

    return this.prisma.vmsAuditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
    });
  }
}
