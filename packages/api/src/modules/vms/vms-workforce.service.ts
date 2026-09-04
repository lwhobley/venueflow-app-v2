import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  VmsAssignmentStatus,
  VmsOrderStatus,
  VmsVendorStatus,
  VmsVendorType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CertificationDue {
  staffMemberId: string;
  staffName: string;
  certification: string;
  expiresOn: string;
  daysRemaining: number;
  expired: boolean;
}

export interface AvailabilityConflict {
  kind: 'unavailable_window' | 'overlapping_shift';
  detail: string;
  conflictingOrderId?: string;
}

/** Shape accepted by the staff/vendor CSV importers. */
export interface CsvImportResult {
  parsed: number;
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

/**
 * Minimal RFC-4180 CSV reader: handles quoted fields, escaped double quotes and
 * embedded commas/newlines. Written inline rather than pulled from a dependency
 * because it is the only CSV parsing in the codebase and the format is fixed.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/** Quote a value for CSV output, escaping embedded quotes. */
export function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Staff assignments, availability, certification tracking, order templates and
 * bulk CSV import/export.
 *
 * Split from VmsService so the core requisition/attendance flow stays readable;
 * the two collaborate through VmsService, which owns audit logging.
 */
@Injectable()
export class VmsWorkforceService {
  private readonly logger = new Logger(VmsWorkforceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // STAFF ASSIGNMENTS  (closes review findings Q1/Q2)
  // ---------------------------------------------------------------------------

  /**
   * Availability + double-booking check for a staff member against an order's
   * shift date. Returns every conflict found rather than the first, so the
   * caller can show the full picture (checklist 1.2).
   */
  async findAssignmentConflicts(params: {
    organizationId: string;
    facilityId: string;
    staffMemberId: string;
    shiftDate: string;
    excludeOrderId?: string;
  }): Promise<AvailabilityConflict[]> {
    const conflicts: AvailabilityConflict[] = [];
    const dayStart = new Date(`${params.shiftDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${params.shiftDate}T23:59:59.999Z`);

    if (Number.isNaN(dayStart.getTime())) {
      throw new BadRequestException(`Invalid shift date '${params.shiftDate}'.`);
    }

    const blocks = await this.prisma.vmsStaffAvailability.findMany({
      where: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        staffMemberId: params.staffMemberId,
        available: false,
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
    });

    for (const block of blocks) {
      conflicts.push({
        kind: 'unavailable_window',
        detail:
          `Marked unavailable ${block.startDate.toISOString().split('T')[0]} → ` +
          `${block.endDate.toISOString().split('T')[0]}` +
          (block.reason ? ` (${block.reason})` : ''),
      });
    }

    const sameDay = await this.prisma.vmsStaffAssignment.findMany({
      where: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        staffMemberId: params.staffMemberId,
        status: { in: [VmsAssignmentStatus.assigned, VmsAssignmentStatus.confirmed] },
        orderId: params.excludeOrderId ? { not: params.excludeOrderId } : undefined,
        order: { shiftDate: params.shiftDate },
      },
      include: { order: { select: { id: true, orderNumber: true, startTime: true, endTime: true } } },
    });

    for (const existing of sameDay) {
      conflicts.push({
        kind: 'overlapping_shift',
        detail:
          `Already assigned to order ${existing.order.orderNumber} on ${params.shiftDate} ` +
          `(${existing.order.startTime}–${existing.order.endTime})`,
        conflictingOrderId: existing.order.id,
      });
    }

    return conflicts;
  }

  async assignStaffToOrder(params: {
    organizationId: string;
    facilityId: string;
    orderId: string;
    staffMemberId: string;
    fulfillmentId?: string;
    notes?: string;
    /** Set to override a detected conflict; the override is recorded in notes. */
    force?: boolean;
  }) {
    const order = await this.prisma.vmsStaffingOrder.findFirst({
      where: {
        id: params.orderId,
        organizationId: params.organizationId,
        facilityId: params.facilityId,
      },
      select: { id: true, shiftDate: true, status: true },
    });
    if (!order) throw new NotFoundException('Staffing order not found');
    if (order.status === VmsOrderStatus.cancelled || order.status === VmsOrderStatus.completed) {
      throw new BadRequestException(`Cannot assign staff to a ${order.status} order.`);
    }

    const staff = await this.prisma.vmsStaffMember.findFirst({
      where: {
        id: params.staffMemberId,
        organizationId: params.organizationId,
        facilityId: params.facilityId,
      },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const conflicts = await this.findAssignmentConflicts({
      organizationId: params.organizationId,
      facilityId: params.facilityId,
      staffMemberId: params.staffMemberId,
      shiftDate: order.shiftDate,
      excludeOrderId: params.orderId,
    });

    if (conflicts.length > 0 && !params.force) {
      throw new BadRequestException(
        `Cannot assign: ${conflicts.map((c) => c.detail).join('; ')}. Re-submit with force=true to override.`,
      );
    }

    const overrideNote =
      conflicts.length > 0 ? `[override] ${conflicts.map((c) => c.detail).join('; ')}` : undefined;
    const notes = [params.notes, overrideNote].filter(Boolean).join(' ') || undefined;

    return this.prisma.vmsStaffAssignment.upsert({
      where: { orderId_staffMemberId: { orderId: params.orderId, staffMemberId: params.staffMemberId } },
      create: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        orderId: params.orderId,
        staffMemberId: params.staffMemberId,
        fulfillmentId: params.fulfillmentId,
        notes,
      },
      update: {
        status: VmsAssignmentStatus.assigned,
        releasedAt: null,
        fulfillmentId: params.fulfillmentId,
        notes,
      },
      include: { staffMember: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async releaseAssignment(params: {
    organizationId: string;
    facilityId: string;
    assignmentId: string;
  }) {
    const assignment = await this.prisma.vmsStaffAssignment.findFirst({
      where: {
        id: params.assignmentId,
        organizationId: params.organizationId,
        facilityId: params.facilityId,
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    return this.prisma.vmsStaffAssignment.update({
      where: { id: params.assignmentId },
      data: { status: VmsAssignmentStatus.released, releasedAt: new Date() },
    });
  }

  async listAssignments(params: {
    organizationId: string;
    facilityId: string;
    orderId?: string;
    staffMemberId?: string;
  }) {
    return this.prisma.vmsStaffAssignment.findMany({
      where: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        orderId: params.orderId,
        staffMemberId: params.staffMemberId,
      },
      include: {
        staffMember: {
          select: { id: true, firstName: true, lastName: true, skills: true, vendorId: true },
        },
        order: { select: { id: true, orderNumber: true, roleRequired: true, shiftDate: true, startTime: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------------------
  // AVAILABILITY  (checklist 1.2)
  // ---------------------------------------------------------------------------

  async setAvailability(params: {
    organizationId: string;
    facilityId: string;
    staffMemberId: string;
    startDate: string;
    endDate: string;
    available: boolean;
    reason?: string;
  }) {
    const staff = await this.prisma.vmsStaffMember.findFirst({
      where: {
        id: params.staffMemberId,
        organizationId: params.organizationId,
        facilityId: params.facilityId,
      },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid dates.');
    }
    if (end < start) {
      throw new BadRequestException('endDate cannot be before startDate.');
    }

    return this.prisma.vmsStaffAvailability.create({
      data: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        staffMemberId: params.staffMemberId,
        startDate: start,
        endDate: end,
        available: params.available,
        reason: params.reason,
      },
    });
  }

  async listAvailability(params: {
    organizationId: string;
    facilityId: string;
    staffMemberId?: string;
    from?: string;
    to?: string;
  }) {
    const where: Record<string, unknown> = {
      organizationId: params.organizationId,
      facilityId: params.facilityId,
    };
    if (params.staffMemberId) where.staffMemberId = params.staffMemberId;
    if (params.from) where.endDate = { gte: new Date(params.from) };
    if (params.to) where.startDate = { lte: new Date(params.to) };

    return this.prisma.vmsStaffAvailability.findMany({
      where,
      include: { staffMember: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { startDate: 'asc' },
    });
  }

  /**
   * Calendar view: assignments and unavailable blocks for a date range, with
   * same-day double-bookings surfaced as conflicts (checklist 1.2).
   */
  async getAvailabilityCalendar(params: {
    organizationId: string;
    facilityId: string;
    from: string;
    to: string;
  }) {
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(`${params.to}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from and to must be valid YYYY-MM-DD dates.');
    }

    const [assignments, blocks] = await Promise.all([
      this.prisma.vmsStaffAssignment.findMany({
        where: {
          organizationId: params.organizationId,
          facilityId: params.facilityId,
          status: { in: [VmsAssignmentStatus.assigned, VmsAssignmentStatus.confirmed] },
          order: { shiftDate: { gte: params.from, lte: params.to } },
        },
        include: {
          staffMember: { select: { id: true, firstName: true, lastName: true } },
          order: { select: { id: true, orderNumber: true, roleRequired: true, shiftDate: true, startTime: true, endTime: true } },
        },
      }),
      this.prisma.vmsStaffAvailability.findMany({
        where: {
          organizationId: params.organizationId,
          facilityId: params.facilityId,
          available: false,
          startDate: { lte: to },
          endDate: { gte: from },
        },
        include: { staffMember: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    // Same staff member on two orders sharing a shift date is a double-booking.
    const seen = new Map<string, string[]>();
    const conflicts: Array<{ staffMemberId: string; staffName: string; shiftDate: string; orderIds: string[] }> = [];

    for (const a of assignments) {
      const key = `${a.staffMemberId}::${a.order.shiftDate}`;
      const existing = seen.get(key) ?? [];
      existing.push(a.order.id);
      seen.set(key, existing);
    }
    for (const a of assignments) {
      const key = `${a.staffMemberId}::${a.order.shiftDate}`;
      const orderIds = seen.get(key);
      if (orderIds && orderIds.length > 1 && !conflicts.some((c) => c.staffMemberId === a.staffMemberId && c.shiftDate === a.order.shiftDate)) {
        conflicts.push({
          staffMemberId: a.staffMemberId,
          staffName: `${a.staffMember.firstName} ${a.staffMember.lastName}`,
          shiftDate: a.order.shiftDate,
          orderIds: Array.from(new Set(orderIds)),
        });
      }
    }

    return {
      from: params.from,
      to: params.to,
      assignments: assignments.map((a) => ({
        assignmentId: a.id,
        staffMemberId: a.staffMemberId,
        staffName: `${a.staffMember.firstName} ${a.staffMember.lastName}`,
        orderId: a.order.id,
        orderNumber: a.order.orderNumber,
        role: a.order.roleRequired,
        shiftDate: a.order.shiftDate,
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        status: a.status,
      })),
      unavailableBlocks: blocks.map((b) => ({
        staffMemberId: b.staffMemberId,
        staffName: `${b.staffMember.firstName} ${b.staffMember.lastName}`,
        startDate: b.startDate.toISOString().split('T')[0],
        endDate: b.endDate.toISOString().split('T')[0],
        reason: b.reason,
      })),
      conflicts,
    };
  }

  // ---------------------------------------------------------------------------
  // CERTIFICATIONS  (checklist 1.2)
  // ---------------------------------------------------------------------------

  /**
   * Reads the `certifications` JSON column and returns everything expiring
   * within `withinDays`. Accepts either an array of
   * `{ name, expiresAt }` or an object map of `{ name: expiresAt }`, so existing
   * rows written in either shape are understood.
   */
  async listExpiringCertifications(
    organizationId: string,
    facilityId: string,
    withinDays = 30,
  ): Promise<CertificationDue[]> {
    const staff = await this.prisma.vmsStaffMember.findMany({
      // `NOT: { certifications: undefined }` reads as a filter but Prisma treats
      // undefined as "no condition", so it silently loaded the whole roster.
      // Prisma.DbNull is the JSON-column null the filter actually needs.
      where: {
        organizationId,
        facilityId,
        status: 'active',
        certifications: { not: Prisma.DbNull },
      },
      select: { id: true, firstName: true, lastName: true, certifications: true },
    });

    const now = Date.now();
    const horizon = now + withinDays * 86400 * 1000;
    const due: CertificationDue[] = [];

    for (const member of staff) {
      for (const [name, rawDate] of this.certificationEntries(member.certifications)) {
        const expiry = new Date(rawDate);
        if (Number.isNaN(expiry.getTime())) continue;
        if (expiry.getTime() > horizon) continue;

        const daysRemaining = Math.ceil((expiry.getTime() - now) / 86400000);
        due.push({
          staffMemberId: member.id,
          staffName: `${member.firstName} ${member.lastName}`,
          certification: name,
          expiresOn: expiry.toISOString().split('T')[0],
          daysRemaining,
          expired: daysRemaining < 0,
        });
      }
    }

    return due.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  private certificationEntries(raw: unknown): Array<[string, string]> {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      const out: Array<[string, string]> = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const name = record.name ?? record.certification ?? record.type;
        const expires = record.expiresAt ?? record.expiry ?? record.expiresOn;
        if (typeof name === 'string' && typeof expires === 'string') out.push([name, expires]);
      }
      return out;
    }

    if (typeof raw === 'object') {
      return Object.entries(raw as Record<string, unknown>).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string',
      );
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // ORDER TEMPLATES  (checklist 1.3)
  // ---------------------------------------------------------------------------

  async listTemplates(organizationId: string, facilityId: string) {
    return this.prisma.vmsOrderTemplate.findMany({
      where: { organizationId, facilityId },
      orderBy: { name: 'asc' },
    });
  }

  async createTemplate(params: {
    organizationId: string;
    facilityId: string;
    createdById: string;
    name: string;
    roleRequired: string;
    quantityRequested: number;
    startTime?: string;
    endTime?: string;
    durationHours?: number;
    budgetCents?: number;
    specialRequirements?: string;
  }) {
    const existing = await this.prisma.vmsOrderTemplate.findUnique({
      where: {
        organizationId_facilityId_name: {
          organizationId: params.organizationId,
          facilityId: params.facilityId,
          name: params.name,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(`A template named '${params.name}' already exists at this facility.`);
    }

    return this.prisma.vmsOrderTemplate.create({
      data: {
        organizationId: params.organizationId,
        facilityId: params.facilityId,
        createdById: params.createdById,
        name: params.name,
        roleRequired: params.roleRequired,
        quantityRequested: params.quantityRequested,
        startTime: params.startTime ?? '16:00',
        endTime: params.endTime ?? '22:00',
        durationHours: params.durationHours ?? 4.0,
        budgetCents: params.budgetCents ?? 0,
        specialRequirements: params.specialRequirements,
      },
    });
  }

  async deleteTemplate(organizationId: string, facilityId: string, id: string) {
    const template = await this.prisma.vmsOrderTemplate.findFirst({
      where: { id, organizationId, facilityId },
    });
    if (!template) throw new NotFoundException('Template not found');
    await this.prisma.vmsOrderTemplate.delete({ where: { id } });
    return { success: true };
  }

  async getTemplate(organizationId: string, facilityId: string, id: string) {
    const template = await this.prisma.vmsOrderTemplate.findFirst({
      where: { id, organizationId, facilityId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  // ---------------------------------------------------------------------------
  // BULK CSV IMPORT / EXPORT  (checklist 1.1, 1.2)
  // ---------------------------------------------------------------------------

  /**
   * Import vendors from CSV. Header row required; recognised columns are
   * name, code, vendorType, contactName, contactEmail, contactPhone.
   * Existing codes are skipped rather than overwritten, so a re-run of the same
   * file is safe.
   */
  async importVendorsCsv(
    organizationId: string,
    facilityId: string,
    csv: string,
  ): Promise<CsvImportResult> {
    const rows = parseCsv(csv);
    const result: CsvImportResult = { parsed: 0, imported: 0, skipped: 0, errors: [] };
    if (rows.length < 2) {
      throw new BadRequestException('CSV must contain a header row and at least one data row.');
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const nameIdx = col('name');
    const codeIdx = col('code');
    if (nameIdx < 0 || codeIdx < 0) {
      throw new BadRequestException("CSV header must include at least 'name' and 'code' columns.");
    }

    const typeIdx = col('vendorType');
    const contactNameIdx = col('contactName');
    const emailIdx = col('contactEmail');
    const phoneIdx = col('contactPhone');

    for (let i = 1; i < rows.length; i++) {
      result.parsed += 1;
      const row = rows[i];
      const name = (row[nameIdx] ?? '').trim();
      const code = (row[codeIdx] ?? '').trim().toUpperCase();

      if (!name || !code) {
        result.skipped += 1;
        result.errors.push({ row: i + 1, reason: 'Missing required name or code.' });
        continue;
      }

      const rawType = typeIdx >= 0 ? (row[typeIdx] ?? '').trim() : '';
      const vendorType = (Object.values(VmsVendorType) as string[]).includes(rawType)
        ? (rawType as VmsVendorType)
        : VmsVendorType.staffing_agency;

      try {
        const existing = await this.prisma.vmsVendor.findUnique({
          where: { organizationId_facilityId_code: { organizationId, facilityId, code } },
          select: { id: true },
        });
        if (existing) {
          result.skipped += 1;
          result.errors.push({ row: i + 1, reason: `Vendor code ${code} already exists.` });
          continue;
        }

        await this.prisma.vmsVendor.create({
          data: {
            organizationId,
            facilityId,
            name,
            code,
            vendorType,
            contactName: contactNameIdx >= 0 ? row[contactNameIdx]?.trim() || undefined : undefined,
            contactEmail: emailIdx >= 0 ? row[emailIdx]?.trim() || undefined : undefined,
            contactPhone: phoneIdx >= 0 ? row[phoneIdx]?.trim() || undefined : undefined,
          },
        });
        result.imported += 1;
      } catch (err) {
        result.skipped += 1;
        result.errors.push({
          row: i + 1,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  /**
   * Import staff from CSV. Recognised columns: firstName, lastName, email,
   * phone, skills (semicolon-separated), hourlyRateCents, vendorCode,
   * badgeNumber. Duplicate detection is on (firstName, lastName, email) so a
   * re-run does not double the roster.
   */
  async importStaffCsv(
    organizationId: string,
    facilityId: string,
    csv: string,
  ): Promise<CsvImportResult> {
    const rows = parseCsv(csv);
    const result: CsvImportResult = { parsed: 0, imported: 0, skipped: 0, errors: [] };
    if (rows.length < 2) {
      throw new BadRequestException('CSV must contain a header row and at least one data row.');
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name.toLowerCase());
    const firstIdx = col('firstName');
    const lastIdx = col('lastName');
    if (firstIdx < 0 || lastIdx < 0) {
      throw new BadRequestException("CSV header must include 'firstName' and 'lastName' columns.");
    }

    const emailIdx = col('email');
    const phoneIdx = col('phone');
    const skillsIdx = col('skills');
    const rateIdx = col('hourlyRateCents');
    const vendorCodeIdx = col('vendorCode');
    const badgeIdx = col('badgeNumber');

    const vendorCache = new Map<string, string | null>();

    for (let i = 1; i < rows.length; i++) {
      result.parsed += 1;
      const row = rows[i];
      const firstName = (row[firstIdx] ?? '').trim();
      const lastName = (row[lastIdx] ?? '').trim();

      if (!firstName || !lastName) {
        result.skipped += 1;
        result.errors.push({ row: i + 1, reason: 'Missing required firstName or lastName.' });
        continue;
      }

      const email = emailIdx >= 0 ? row[emailIdx]?.trim() || undefined : undefined;

      try {
        // Only dedupe on something that actually identifies a person. Matching
        // on `email ?? null` collapsed every unnamed-email row together, so a
        // second genuine "John Smith" — routine for bulk agency temps — was
        // silently dropped as a duplicate. With no email and no badge there is
        // nothing to match on, so the row is imported and the caller decides.
        const badgeNumber = badgeIdx >= 0 ? row[badgeIdx]?.trim() || undefined : undefined;
        const identity = email
          ? { email }
          : badgeNumber
          ? { badgeNumber }
          : null;

        if (identity) {
          const duplicate = await this.prisma.vmsStaffMember.findFirst({
            where: { organizationId, facilityId, firstName, lastName, ...identity },
            select: { id: true },
          });
          if (duplicate) {
            result.skipped += 1;
            result.errors.push({ row: i + 1, reason: `${firstName} ${lastName} already on the roster.` });
            continue;
          }
        }

        let vendorId: string | undefined;
        if (vendorCodeIdx >= 0) {
          const code = (row[vendorCodeIdx] ?? '').trim().toUpperCase();
          if (code) {
            if (!vendorCache.has(code)) {
              const vendor = await this.prisma.vmsVendor.findUnique({
                where: { organizationId_facilityId_code: { organizationId, facilityId, code } },
                select: { id: true },
              });
              vendorCache.set(code, vendor?.id ?? null);
            }
            const resolved = vendorCache.get(code);
            if (!resolved) {
              result.skipped += 1;
              result.errors.push({ row: i + 1, reason: `Unknown vendor code ${code}.` });
              continue;
            }
            vendorId = resolved;
          }
        }

        const rawRate = rateIdx >= 0 ? parseInt((row[rateIdx] ?? '').trim(), 10) : NaN;
        const skills =
          skillsIdx >= 0
            ? (row[skillsIdx] ?? '')
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

        await this.prisma.vmsStaffMember.create({
          data: {
            organizationId,
            facilityId,
            vendorId,
            firstName,
            lastName,
            email,
            phone: phoneIdx >= 0 ? row[phoneIdx]?.trim() || undefined : undefined,
            skills,
            hourlyRateCents: Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 2500,
            badgeNumber,
          },
        });
        result.imported += 1;
      } catch (err) {
        result.skipped += 1;
        result.errors.push({
          row: i + 1,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  /** Vendor directory export (checklist 1.1). */
  async exportVendorsCsv(organizationId: string, facilityId: string): Promise<string> {
    const vendors = await this.prisma.vmsVendor.findMany({
      where: { organizationId, facilityId },
      include: { services: true, _count: { select: { staffMembers: true, orderFulfillments: true } } },
      orderBy: { name: 'asc' },
    });

    const header = [
      'Name', 'Code', 'Type', 'Status', 'Contact Name', 'Contact Email', 'Contact Phone',
      'Rating', 'Billing Multiplier', 'Tax ID', 'Insurance Expiry', 'Service Types',
      'Staff Count', 'Fulfillment Count',
    ];

    const lines = [header.map(csvCell).join(',')];
    for (const v of vendors) {
      lines.push(
        [
          v.name, v.code, v.vendorType, v.status, v.contactName, v.contactEmail, v.contactPhone,
          v.rating.toFixed(1), v.billingRateMultiplier.toFixed(2), v.taxId,
          v.insuranceExpiry ? v.insuranceExpiry.toISOString().split('T')[0] : '',
          v.services.map((s) => s.serviceType).join('; '),
          v._count.staffMembers, v._count.orderFulfillments,
        ].map(csvCell).join(','),
      );
    }

    return lines.join('\n');
  }

  /** Staff roster export (checklist 1.2). Credential columns are never included. */
  async exportStaffCsv(organizationId: string, facilityId: string): Promise<string> {
    const staff = await this.prisma.vmsStaffMember.findMany({
      where: { organizationId, facilityId },
      include: { vendor: { select: { name: true, code: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const header = [
      'First Name', 'Last Name', 'Email', 'Phone', 'Workforce Type', 'Status',
      'Skills', 'Hourly Rate (cents)', 'Vendor', 'Vendor Code', 'Badge Number',
    ];

    const lines = [header.map(csvCell).join(',')];
    for (const s of staff) {
      lines.push(
        [
          s.firstName, s.lastName, s.email, s.phone, s.workforceType, s.status,
          s.skills.join('; '), s.hourlyRateCents,
          s.vendor?.name ?? '', s.vendor?.code ?? '', s.badgeNumber ?? '',
        ].map(csvCell).join(','),
      );
    }

    return lines.join('\n');
  }
}
