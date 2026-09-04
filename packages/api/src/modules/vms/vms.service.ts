import {
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Prisma,
  VmsAssignmentStatus,
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
import { VmsWorkforceService } from './vms-workforce.service';
import { VmsNotificationsService } from './vms-notifications.service';
import { VmsNotificationEvent } from '@prisma/client';
import { zonedIsoDate, zonedWallClockToUtc } from '../../common/venue-time';

/** Failed punch attempts before a worker is locked out, and for how long. */
export const MAX_PUNCH_ATTEMPTS = 5;
export const PUNCH_LOCKOUT_MINUTES = 15;

/**
 * Scrypt-based Key Derivation for Worker PINs (N3)
 */
export function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}

export function verifyPin(pin: string, salt: string, expectedHash: string): boolean {
  try {
    const derived = crypto.scryptSync(pin, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Omit credential materials from API responses (N2)
 */
export function sanitizeStaffMember<T extends Record<string, any>>(staff: T): Omit<T, 'pinHash' | 'pinSalt'> {
  if (!staff) return staff;
  const { pinHash, pinSalt, ...safe } = staff;
  return safe as any;
}

@Injectable()
export class VmsService {
  private readonly logger = new Logger(VmsService.name);
  /**
   * Failed-punch throttling is persisted rather than held in process memory:
   * an in-process Map reset on every deploy and, across replicas, gave an
   * attacker MAX_PUNCH_ATTEMPTS tries per instance instead of in total
   * (review finding P5).
   */
  private async checkPunchLockout(organizationId: string, facilityId: string, staffId: string) {
    const record = await this.prisma.vmsPunchLockout.findUnique({
      where: { staffMemberId: staffId },
      select: { lockedUntil: true, facilityId: true },
    });
    if (!record || record.facilityId !== facilityId) return;
    if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
      const minutesRemaining = Math.ceil((record.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(
        `Too many failed punch attempts. Worker locked out for ${minutesRemaining} more minute(s).`,
      );
    }
  }

  private async recordFailedPunchAttempt(
    organizationId: string,
    facilityId: string,
    staffId: string,
  ) {
    try {
      const existing = await this.prisma.vmsPunchLockout.findUnique({
        where: { staffMemberId: staffId },
        select: { failedCount: true, lockedUntil: true },
      });

      // A lapsed lockout starts a fresh count rather than resuming the old one.
      const lapsed = existing?.lockedUntil ? existing.lockedUntil.getTime() <= Date.now() : false;
      const nextCount = existing && !lapsed ? existing.failedCount + 1 : 1;
      const lockedUntil =
        nextCount >= MAX_PUNCH_ATTEMPTS ? new Date(Date.now() + PUNCH_LOCKOUT_MINUTES * 60 * 1000) : null;

      await this.prisma.vmsPunchLockout.upsert({
        where: { staffMemberId: staffId },
        create: {
          organizationId,
          facilityId,
          staffMemberId: staffId,
          failedCount: nextCount,
          lockedUntil,
          lastAttemptAt: new Date(),
        },
        update: { failedCount: nextCount, lockedUntil, lastAttemptAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist punch lockout for ${staffId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resetFailedPunchAttempts(staffId: string) {
    try {
      await this.prisma.vmsPunchLockout.deleteMany({ where: { staffMemberId: staffId } });
    } catch (err) {
      this.logger.warn(
        `Failed to clear punch lockout for ${staffId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: VmsAiService,
    private readonly integrationsService: VmsIntegrationsService,
    private readonly workforceService: VmsWorkforceService,
    private readonly notifications: VmsNotificationsService,
  ) {}

  /**
   * Certifications lapsing inside the window (checklist 1.2). Delegated so the
   * scheduler has a single entry point alongside the other sweeps.
   */
  async listExpiringCertifications(organizationId: string, facilityId: string, withinDays = 30) {
    return this.workforceService.listExpiringCertifications(organizationId, facilityId, withinDays);
  }

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
    if (vendor.staffMembers) {
      vendor.staffMembers = vendor.staffMembers.map(sanitizeStaffMember) as any;
    }
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

    const records = await this.prisma.vmsStaffMember.findMany({
      where,
      skip,
      take: limit,
      include: {
        vendor: { select: { id: true, name: true, code: true, vendorType: true } },
      },
      orderBy: { lastName: 'asc' },
    });
    return records.map(sanitizeStaffMember);
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
      pinHash = hashPin(dto.pin, pinSalt);
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

    return sanitizeStaffMember(staff);
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
    if (order.attendances) {
      order.attendances = order.attendances.map((a) => ({
        ...a,
        staffMember: a.staffMember ? sanitizeStaffMember(a.staffMember) : a.staffMember,
      })) as any;
    }
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

    this.notifications.notifyAfterCommit({
      organizationId,
      facilityId,
      eventType: VmsNotificationEvent.order_submitted,
      subject: `Staffing order ${order.orderNumber} submitted`,
      body:
        `A new staffing order has been raised.\n\n` +
        `Order: ${order.orderNumber}\n` +
        `Role: ${order.roleRequired}\n` +
        `Headcount: ${order.quantityRequested}\n` +
        `Shift: ${order.shiftDate} ${order.startTime}–${order.endTime}\n` +
        `Budget: $${(order.budgetCents / 100).toFixed(2)}`,
      entityType: 'VmsStaffingOrder',
      entityId: order.id,
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
    const todayStr = now.toISOString().split('T')[0];
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
        shiftDate: { gte: todayStr, lte: shiftDateCutoff },
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

    this.notifications.notifyAfterCommit({
      organizationId,
      facilityId,
      eventType: VmsNotificationEvent.bid_received,
      subject: `Bid received for ${order.orderNumber}`,
      body:
        `${vendor.name} has bid on staffing order ${order.orderNumber}.\n\n` +
        `Role: ${order.roleRequired}\n` +
        `Staff offered: ${dto.staffCountAssigned} of ${order.quantityRequested}\n` +
        `Rate: $${(dto.bidHourlyRateCents / 100).toFixed(2)}/hr\n` +
        `Bid total: $${(totalBidCents / 100).toFixed(2)}`,
      entityType: 'VmsOrderFulfillment',
      entityId: fulfillment.id,
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

    this.notifications.notifyAfterCommit({
      organizationId,
      facilityId,
      eventType: VmsNotificationEvent.order_confirmed,
      subject: `Order ${fulfillment.order.orderNumber} staffing confirmed`,
      body:
        `A vendor bid has been accepted for order ${fulfillment.order.orderNumber}.\n\n` +
        `Role: ${fulfillment.order.roleRequired}\n` +
        `Staff confirmed: ${fulfillment.staffCountAssigned}\n` +
        `Assign named workers so shift reminders and no-show detection can run.`,
      entityType: 'VmsOrderFulfillment',
      entityId: fulfillmentId,
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

    // Worker credential check (B4, N3, N5):
    if (!options?.isManager) {
      // Lockout guards the self-service path only. Applying it to a manager
      // punch would block the documented remedy for a locked-out worker and
      // leave their shift unrecorded, which the no-show sweep later reads as
      // an absence.
      await this.checkPunchLockout(organizationId, facilityId, staff.id);

      if (!staff.pinHash && !staff.badgeNumber) {
        throw new ForbiddenException(
          'Staff member has no PIN or badge credential configured on file. A manager must record this punch.',
        );
      }
      if (staff.pinHash && staff.pinSalt) {
        if (!dto.pin) {
          throw new BadRequestException('Worker PIN required for clock-in.');
        }
        if (!verifyPin(dto.pin, staff.pinSalt, staff.pinHash)) {
          await this.recordFailedPunchAttempt(organizationId, facilityId, staff.id);
          throw new BadRequestException('Invalid worker PIN.');
        }
      } else if (staff.badgeNumber) {
        if (
          !dto.badgeCode ||
          !this.timingSafeCompare(
            dto.badgeCode.trim().toLowerCase(),
            staff.badgeNumber.trim().toLowerCase(),
          )
        ) {
          await this.recordFailedPunchAttempt(organizationId, facilityId, staff.id);
          throw new BadRequestException('Invalid worker badge code.');
        }
      }
      await this.resetFailedPunchAttempts(staff.id);
    }

    // Active punch check: Key on clockOut: null to prevent open punch accumulation (N4)
    const activePunch = await this.prisma.vmsTimeAttendance.findFirst({
      where: {
        staffMemberId: dto.staffMemberId,
        facilityId,
        clockOut: null,
      },
    });
    if (activePunch) {
      throw new BadRequestException('Staff member already has an active clock-in without clock-out.');
    }

    // Geofencing verification (F1, N9):
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
      } else {
        this.logger.warn(`Facility ${facilityId} coordinates are not configured; geofence check could not be verified.`);
        deviationFlags.push('geofence_unconfigured');
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

    if (attendance.staffMember) {
      attendance.staffMember = sanitizeStaffMember(attendance.staffMember) as any;
    }

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

    // Check lockout
    if (attendance.staffMemberId) {
      if (attendance.staffMemberId) {
        await this.checkPunchLockout(organizationId, facilityId, attendance.staffMemberId);
      }
    }

    // Worker credential check on self clock-out (B4, N3, N5):
    if (!options?.isManager) {
      const staff = attendance.staffMember;
      if (!staff?.pinHash && !staff?.badgeNumber) {
        throw new ForbiddenException(
          'Staff member has no PIN or badge credential configured on file. A manager must record this punch.',
        );
      }
      if (staff?.pinHash && staff?.pinSalt) {
        if (!dto.pin) throw new BadRequestException('Worker PIN required for clock-out.');
        if (!verifyPin(dto.pin, staff.pinSalt, staff.pinHash)) {
          if (staff.id) await this.recordFailedPunchAttempt(organizationId, facilityId, staff.id);
          throw new BadRequestException('Invalid worker PIN.');
        }
      } else if (staff?.badgeNumber) {
        if (
          !dto.badgeCode ||
          !this.timingSafeCompare(
            dto.badgeCode.trim().toLowerCase(),
            staff.badgeNumber.trim().toLowerCase(),
          )
        ) {
          if (staff.id) await this.recordFailedPunchAttempt(organizationId, facilityId, staff.id);
          throw new BadRequestException('Invalid worker badge code.');
        }
      }
      if (staff?.id) await this.resetFailedPunchAttempts(staff.id);
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
      userId: options?.callerUserId || attendance.staffMemberId || 'system',
      ipAddress: options?.ipAddress,
      before: { clockIn: attendance.clockIn, status: attendance.status },
      changes: { hoursWorked: rawHours, billableHours, deviationFlags, totalBilledCents },
    });

    if (updated.staffMember) {
      updated.staffMember = sanitizeStaffMember(updated.staffMember) as any;
    }

    if (deviationFlags.length > 0 && updated.staffMember) {
      this.notifications.notifyAfterCommit({
        organizationId,
        facilityId,
        eventType: VmsNotificationEvent.time_deviation,
        subject: `Time deviation flagged for ${updated.staffMember.firstName} ${updated.staffMember.lastName}`,
        body:
          `A shift closed with exceptions that need manager review.\n\n` +
          `Worker: ${updated.staffMember.firstName} ${updated.staffMember.lastName}\n` +
          `Hours worked: ${rawHours.toFixed(2)} (billable ${billableHours.toFixed(2)})\n` +
          `Break: ${breakMinutes} minutes\n` +
          `Flags: ${deviationFlags.join(', ')}\n\n` +
          `Approve or adjust the entry before it reaches payroll.`,
        entityType: 'VmsTimeAttendance',
        entityId: dto.attendanceId,
      });
    }

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

    const reports = await this.prisma.vmsTimeAttendance.findMany({
      where,
      include: {
        staffMember: {
          include: { vendor: { select: { id: true, name: true, code: true } } },
        },
        order: { select: { id: true, orderNumber: true, roleRequired: true } },
      },
      orderBy: { clockIn: 'desc' },
    });
    return reports.map((r) => ({
      ...r,
      staffMember: r.staffMember ? sanitizeStaffMember(r.staffMember) : r.staffMember,
    }));
  }

  /**
   * No-Show Detection (checklist 1.5, 2.3).
   *
   * Attribution comes from VmsStaffAssignment: only a worker who was actually
   * rostered onto the order can be recorded as a no-show. The earlier version
   * picked an arbitrary unpunched member of the vendor's roster, which wrote a
   * fabricated absence against someone who was never scheduled (review finding
   * Q1). Where an order is simply under-filled and nobody was assigned to the
   * missing slot, the gap is recorded against the fulfilling vendor with a null
   * staff member rather than pinned on a person.
   */
  async detectNoShows(organizationId: string, facilityId: string, gracePeriodMinutes = 30) {
    const now = new Date();

    // Shift times are venue-local wall clock. Reading them as UTC moves every
    // venue by its own offset, so a US evening shift looked overdue in the
    // early afternoon and the sweep flagged workers before they were due.
    const facility = await this.prisma.facility.findUnique({
      where: { organizationId_id: { organizationId, id: facilityId } },
      select: { timezone: true },
    });
    const timezone = facility?.timezone ?? null;

    // Bound the scan by the venue's own calendar date, not the server's.
    const todayLocal = zonedIsoDate(timezone, now.getTime());

    const orders = await this.prisma.vmsStaffingOrder.findMany({
      where: {
        organizationId,
        facilityId,
        status: { in: [VmsOrderStatus.confirmed, VmsOrderStatus.booked] },
        shiftDate: { lte: todayLocal },
      },
      include: {
        fulfillments: {
          where: { status: { in: [VmsFulfillmentStatus.confirmed, VmsFulfillmentStatus.completed] } },
          select: { id: true, vendorId: true },
        },
        // Every assignment, whatever its status. Filtering to assigned|confirmed
        // here would drop workers this sweep already marked no_show, and the
        // unfilled-slot arithmetic below would then invent a phantom shortfall
        // for a slot that was in fact staffed.
        assignments: {
          include: { staffMember: { select: { id: true, firstName: true, lastName: true, vendorId: true } } },
        },
        attendances: {
          select: { id: true, staffMemberId: true, deviationFlags: true },
        },
      },
    });

    const flaggedNoShows: Array<{
      orderId: string;
      orderNumber: string;
      vendorId: string | null;
      staffMemberId: string | null;
      staffName: string | null;
      role: string;
      reason: string;
    }> = [];

    for (const order of orders) {
      const scheduledStartMs = zonedWallClockToUtc(timezone, order.shiftDate, order.startTime || '09:00');
      if (!Number.isFinite(scheduledStartMs)) {
        this.logger.warn(
          'Skipping no-show check for order ' + order.orderNumber + ': unparseable shift date/time',
        );
        continue;
      }
      const scheduledStart = new Date(scheduledStartMs);
      const threshold = new Date(scheduledStartMs + gracePeriodMinutes * 60 * 1000);
      if (now <= threshold) continue;

      const punchedStaffIds = new Set(
        order.attendances
          .filter((a) => !a.deviationFlags.includes('no_show'))
          .map((a) => a.staffMemberId)
          .filter((id): id is string => Boolean(id)),
      );
      const alreadyFlagged = new Set(
        order.attendances
          .filter((a) => a.deviationFlags.includes('no_show'))
          .map((a) => a.staffMemberId),
      );

      const defaultVendorId = order.fulfillments[0]?.vendorId ?? null;

      // 1. Workers rostered onto this shift who never punched in. Assignments
      //    already resolved to no_show or released are not re-flagged.
      const absentees = order.assignments.filter(
        (a) =>
          (a.status === VmsAssignmentStatus.assigned || a.status === VmsAssignmentStatus.confirmed) &&
          !punchedStaffIds.has(a.staffMemberId) &&
          !alreadyFlagged.has(a.staffMemberId),
      );

      for (const absentee of absentees) {
        const vendorId = absentee.staffMember.vendorId ?? defaultVendorId;

        // The attendance row, the assignment transition and the audit entry are
        // one unit: cron work has no ambient request transaction, so without
        // this a failed audit write would leave an unaudited no-show behind.
        const record = await this.prisma.$transaction(async (tx) => {
          const created = await tx.vmsTimeAttendance.create({
            data: {
              organizationId,
              facilityId,
              staffMemberId: absentee.staffMemberId,
              orderId: order.id,
              clockIn: scheduledStart,
              clockOut: scheduledStart,
              billableHours: 0,
              billedRateCents: 0,
              totalBilledCents: 0,
              status: VmsAttendanceStatus.flagged_exception,
              isWithinGeofence: false,
              deviationFlags: ['no_show'],
            },
          });

          await tx.vmsStaffAssignment.update({
            where: { id: absentee.id },
            data: { status: VmsAssignmentStatus.no_show },
          });

          await this.logAudit(
            {
              organizationId,
              facilityId,
              entityType: 'VmsTimeAttendance',
              entityId: created.id,
              action: 'EXCEPTION_FLAGGED',
              userId: 'system_scheduler',
              changes: {
                orderId: order.id,
                vendorId,
                staffMemberId: absentee.staffMemberId,
                reason: 'Assigned worker did not report before the grace period elapsed',
              },
            },
            tx,
          );

          return created;
        });

        flaggedNoShows.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          vendorId,
          staffMemberId: absentee.staffMemberId,
          staffName: absentee.staffMember.firstName + ' ' + absentee.staffMember.lastName,
          role: order.roleRequired,
          reason: 'Assigned but no clock-in ' + gracePeriodMinutes + 'm after shift start',
        });

        void record;
      }

      // 2. Headcount the vendor confirmed but never named a worker for. Counted
      //    against every assignment regardless of status, so a slot that was
      //    assigned and then flagged absent is not also billed as unstaffed.
      const unfilledSlots = Math.max(
        0,
        order.quantityFulfilled -
          order.assignments.length -
          order.attendances.filter((a) => a.deviationFlags.includes('unfilled_shift')).length,
      );

      for (let i = 0; i < unfilledSlots; i++) {
        const fulfillment = order.fulfillments[i % (order.fulfillments.length || 1)];
        const vendorId = fulfillment?.vendorId ?? null;

        await this.prisma.$transaction(async (tx) => {
          const created = await tx.vmsTimeAttendance.create({
            data: {
              organizationId,
              facilityId,
              staffMemberId: null,
              orderId: order.id,
              clockIn: scheduledStart,
              clockOut: scheduledStart,
              billableHours: 0,
              billedRateCents: 0,
              totalBilledCents: 0,
              status: VmsAttendanceStatus.flagged_exception,
              isWithinGeofence: false,
              deviationFlags: ['no_show', 'unfilled_shift'],
            },
          });

          await this.logAudit(
            {
              organizationId,
              facilityId,
              entityType: 'VmsTimeAttendance',
              entityId: created.id,
              action: 'EXCEPTION_FLAGGED',
              userId: 'system_scheduler',
              changes: {
                orderId: order.id,
                vendorId,
                staffMemberId: null,
                reason: 'Vendor confirmed headcount was never assigned to a worker',
              },
            },
            tx,
          );
        });

        flaggedNoShows.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          vendorId,
          staffMemberId: null,
          staffName: null,
          role: order.roleRequired,
          reason: 'Confirmed headcount never assigned to a named worker',
        });
      }

      if (absentees.length > 0 || unfilledSlots > 0) {
        this.logger.warn(
          'No-show sweep flagged ' + (absentees.length + unfilledSlots) + ' slot(s) on order ' + order.orderNumber,
        );
      }
    }

    return {
      scannedOrdersCount: orders.length,
      flaggedNoShowsCount: flaggedNoShows.length,
      flaggedNoShows,
    };
  }

  async exportPayrollAdp(organizationId: string, facilityId: string) {
    const records = await this.prisma.vmsTimeAttendance.findMany({
      where: {
        organizationId,
        facilityId,
        staffMemberId: { not: null },
        status: { in: [VmsAttendanceStatus.approved, VmsAttendanceStatus.clocked_out] },
      },
      include: { staffMember: true },
      orderBy: { clockIn: 'asc' },
    });

    const validRecords = records.filter(
      (r): r is typeof r & { staffMember: NonNullable<typeof r.staffMember> } => r.staffMember !== null,
    );

    return this.integrationsService.generateAdpExportCsv(validRecords);
  }

  async exportPayrollGusto(organizationId: string, facilityId: string) {
    const records = await this.prisma.vmsTimeAttendance.findMany({
      where: {
        organizationId,
        facilityId,
        staffMemberId: { not: null },
        status: { in: [VmsAttendanceStatus.approved, VmsAttendanceStatus.clocked_out] },
      },
      include: { staffMember: true },
      orderBy: { clockIn: 'asc' },
    });

    const validRecords = records.filter(
      (r): r is typeof r & { staffMember: NonNullable<typeof r.staffMember> } => r.staffMember !== null,
    );

    const now = new Date();
    const periodStart = new Date(now.getTime() - 14 * 86400 * 1000).toISOString().split('T')[0];
    const periodEnd = now.toISOString().split('T')[0];

    return this.integrationsService.generateGustoExportJson(validRecords, periodStart, periodEnd);
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

  /**
   * Vendor scorecard (checklist 1.1).
   *
   * Aggregated in the database rather than by loading every vendor's staff and
   * every one of their attendance rows into memory (review finding F9).
   *
   * Attendance is attributed to a vendor two ways, unioned: through the staff
   * member's vendor for a normal punch, and through the order's confirmed
   * fulfillment for an unattributed no-show, which has no staff member at all.
   * Without the second arm the scorecard stayed blind to exactly the worst
   * case — a vendor that supplied nobody (review finding Q2).
   */
  async getVendorScorecard(organizationId: string, facilityId: string) {
    const vendors = await this.prisma.vmsVendor.findMany({
      where: { organizationId, facilityId },
      select: { id: true, name: true, code: true, rating: true },
      orderBy: { name: 'asc' },
    });
    if (vendors.length === 0) return [];

    const fulfillmentGroups = await this.prisma.vmsOrderFulfillment.groupBy({
      by: ['vendorId', 'status'],
      where: { order: { organizationId, facilityId } },
      _count: { _all: true },
    });

    const attendanceRows = await this.prisma.$queryRaw<
      Array<{
        vendorId: string;
        totalPunches: bigint;
        offTargetPunches: bigint;
        totalBilledCents: bigint;
      }>
    >(Prisma.sql`
      SELECT
        v."vendorId"                                        AS "vendorId",
        COUNT(*)                                            AS "totalPunches",
        COUNT(*) FILTER (
          WHERE 'no_show' = ANY(v."deviationFlags")
             OR 'off_site_punch' = ANY(v."deviationFlags")
        )                                                   AS "offTargetPunches",
        COALESCE(SUM(v."totalBilledCents"), 0)              AS "totalBilledCents"
      FROM (
        -- Punches attributed through the worker's own vendor.
        SELECT sm."vendorId", a."deviationFlags", a."totalBilledCents"
        FROM "VmsTimeAttendance" a
        JOIN "VmsStaffMember" sm ON sm."id" = a."staffMemberId"
        WHERE a."organizationId" = ${organizationId}
          AND a."facilityId" = ${facilityId}
          AND sm."vendorId" IS NOT NULL

        UNION ALL

        -- Unattributed no-shows, attributed through the confirmed fulfillment.
        -- DISTINCT ON pins each attendance row to exactly one vendor: an order
        -- filled by two agencies has two confirmed fulfillments, and a plain
        -- join would charge the same missing slot to both of them.
        -- Wrapped: an ORDER BY written directly in a UNION arm binds to the
        -- whole union, where "a" is out of scope (42P01).
        SELECT "vendorId", "deviationFlags", "totalBilledCents" FROM (
          SELECT DISTINCT ON (a."id")
            f."vendorId", a."deviationFlags", a."totalBilledCents"
          FROM "VmsTimeAttendance" a
          JOIN "VmsOrderFulfillment" f ON f."orderId" = a."orderId"
          WHERE a."organizationId" = ${organizationId}
            AND a."facilityId" = ${facilityId}
            AND a."staffMemberId" IS NULL
            AND f."status" IN ('confirmed', 'completed')
          ORDER BY a."id", f."createdAt" ASC, f."id" ASC
        ) deduped
      ) v
      WHERE v."vendorId" IS NOT NULL
      GROUP BY v."vendorId"
    `);

    const fulfillmentByVendor = new Map<string, { total: number; confirmed: number }>();
    for (const group of fulfillmentGroups) {
      const entry = fulfillmentByVendor.get(group.vendorId) ?? { total: 0, confirmed: 0 };
      const count = group._count._all;
      entry.total += count;
      if (
        group.status === VmsFulfillmentStatus.confirmed ||
        group.status === VmsFulfillmentStatus.completed
      ) {
        entry.confirmed += count;
      }
      fulfillmentByVendor.set(group.vendorId, entry);
    }

    const attendanceByVendor = new Map<
      string,
      { totalPunches: number; offTarget: number; billedCents: number }
    >();
    for (const row of attendanceRows) {
      attendanceByVendor.set(row.vendorId, {
        totalPunches: Number(row.totalPunches),
        offTarget: Number(row.offTargetPunches),
        billedCents: Number(row.totalBilledCents),
      });
    }

    return vendors.map((v) => {
      const fulfillment = fulfillmentByVendor.get(v.id) ?? { total: 0, confirmed: 0 };
      const attendance = attendanceByVendor.get(v.id) ?? {
        totalPunches: 0,
        offTarget: 0,
        billedCents: 0,
      };

      // Null rather than an invented figure when there is nothing to measure.
      const onTimeRatePercent =
        attendance.totalPunches > 0
          ? Math.round(((attendance.totalPunches - attendance.offTarget) / attendance.totalPunches) * 100)
          : null;
      const fulfillmentRatePercent =
        fulfillment.total > 0 ? Math.round((fulfillment.confirmed / fulfillment.total) * 100) : null;

      return {
        vendorId: v.id,
        vendorName: v.name,
        code: v.code,
        rating: v.rating,
        totalOrdersAssigned: fulfillment.total,
        fulfillmentRatePercent,
        onTimeRatePercent,
        noShowCount: attendance.offTarget,
        hasData: attendance.totalPunches > 0 || fulfillment.total > 0,
        totalBilledCents: attendance.billedCents,
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
      staffName: r.staffMember ? `${r.staffMember.firstName} ${r.staffMember.lastName}` : 'Unassigned Slot',
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

  async logAudit(
    params: {
      organizationId: string;
      facilityId: string;
      entityType: string;
      entityId: string;
      action: string;
      userId: string;
      changes?: Record<string, unknown>;
      before?: Record<string, unknown>;
      ipAddress?: string;
    },
    /**
     * Transaction client to write through. HTTP requests already run inside
     * TenantRequestTransactionInterceptor's transaction, but cron work does
     * not — background callers must pass their own so a failed audit write
     * rolls back the row it was recording rather than leaving it unaudited.
     */
    client?: Pick<PrismaService, 'vmsAuditLog'>,
  ) {
    try {
      const payload = {
        ...(params.changes || {}),
        before: params.before,
        ipAddress: params.ipAddress,
      };

      await (client ?? this.prisma).vmsAuditLog.create({
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
      // Section 5.3 requires a complete audit trail, so a failed audit write
      // fails the operation it was recording rather than being swallowed —
      // otherwise the log can silently miss events it is supposed to prove.
      this.logger.error(
        `Failed to record audit log: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'Unable to record the audit entry for this action; the operation was rolled back.',
      );
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

  async exportAuditLogs(
    organizationId: string,
    facilityId: string,
    filters?: { entityType?: string; startDate?: string; endDate?: string; format?: 'csv' | 'json' },
  ) {
    const where: any = { organizationId, facilityId };
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.startDate || filters?.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = new Date(filters.startDate);
      if (filters.endDate) where.timestamp.lte = new Date(filters.endDate);
    }

    const logs = await this.prisma.vmsAuditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 5000,
    });

    if (filters?.format === 'json') {
      return logs;
    }

    const headers = ['Timestamp', 'Entity Type', 'Entity ID', 'Action', 'Performed By', 'Changes'];
    const rows = logs.map((l) => [
      l.timestamp.toISOString(),
      l.entityType,
      l.entityId,
      l.action,
      l.performedByUserId,
      `"${JSON.stringify(l.changes).replace(/"/g, '""')}"`,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
