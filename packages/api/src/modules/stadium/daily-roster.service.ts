import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCanManageDepartment } from '../../auth/access-control.helper';
import { isOwnerOrAdminRole, canManageVenue, isAdminRole } from '../../auth/roles';
import type {
  AdjustRosterDto,
  AssignRosterWorkerDto,
  CreateDailyRosterDto,
  UpdateRosterWorkerDto,
} from './daily-roster.dto';

function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

@Injectable()
export class DailyRosterService {
  private readonly logger = new Logger(DailyRosterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to check if actor has permission to see financial/payroll rates.
   */
  private canViewPayrollRates(role?: string | null, allAccess = false): boolean {
    return allAccess || isOwnerOrAdminRole(role) || role === 'finance_viewer';
  }

  /**
   * Asserts actor has permission to access the department's roster.
   */
  private async assertCanAccessDepartmentRoster(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    departmentId: string;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess = false, departmentId } = params;
    if (actorAllAccess || isAdminRole(actorRole)) {
      return;
    }

    const membership = await this.prisma.departmentMembership.findFirst({
      where: {
        facilityId,
        userId: actorUserId,
        departmentId,
        isActive: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('Access to requested department roster is unauthorized');
    }
  }

  /**
   * Creates a new daily temporary staffing roster for an operational date.
   */
  async createRoster(params: {
    organizationId: string;
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    dto: CreateDailyRosterDto;
  }) {
    const { organizationId, facilityId, actorUserId, actorRole, actorAllAccess, dto } = params;

    // Verify manager-of-department authority
    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: dto.departmentId,
      prisma: this.prisma,
    });

    // Check duplicate roster name for same date
    const existing = await this.prisma.dailyTemporaryRoster.findFirst({
      where: {
        facilityId,
        operationalDate: dto.operationalDate,
        name: dto.name.trim(),
      },
    });

    if (existing) {
      throw new ConflictException(
        `A roster named '${dto.name}' already exists for operational date ${dto.operationalDate}`,
      );
    }

    const roster = await this.prisma.dailyTemporaryRoster.create({
      data: {
        organizationId,
        facilityId,
        operationalDate: dto.operationalDate,
        name: dto.name.trim(),
        rosterType: dto.rosterType ?? 'temporary',
        staffingSource: dto.staffingSource.trim(),
        agencyId: dto.agencyId,
        departmentId: dto.departmentId,
        serviceAreaId: dto.serviceAreaId,
        status: 'draft',
        version: 1,
        notes: dto.notes?.trim(),
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: {
        department: { select: { id: true, code: true, name: true } },
        agency: { select: { id: true, code: true, name: true } },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        venueId: facilityId,
        actorProfileId: actorUserId,
        actorRole: actorRole ?? 'unknown',
        entityType: 'DailyTemporaryRoster',
        entityId: roster.id,
        action: 'CREATE_ROSTER',
        summary: `Created ${roster.rosterType} roster '${roster.name}' for ${roster.operationalDate}`,
      },
    }).catch((err) => this.logger.warn(`Failed to record audit log for CREATE_ROSTER: ${err instanceof Error ? err.message : String(err)}`));

    return roster;
  }

  /**
   * Lists rosters filtered by date, department, status, and actor access.
   */
  async listRosters(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    operationalDate?: string;
    departmentId?: string;
    status?: string;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess, operationalDate, departmentId, status } = params;

    const isBroadAdmin = actorAllAccess || isAdminRole(actorRole);

    // If not broad admin, restrict to departments the user belongs to
    let departmentFilter: string[] | undefined;
    if (!isBroadAdmin) {
      const userDepts = await this.prisma.departmentMembership.findMany({
        where: { facilityId, userId: actorUserId, isActive: true },
        select: { departmentId: true },
      });
      departmentFilter = userDepts.map((d) => d.departmentId);
      if (departmentFilter.length === 0) {
        return [];
      }
    }

    const where: Record<string, unknown> = { facilityId };
    if (operationalDate) where.operationalDate = operationalDate;
    if (status) where.status = status;
    if (departmentId) {
      if (departmentFilter && !departmentFilter.includes(departmentId)) {
        throw new ForbiddenException('Access to requested department roster is unauthorized');
      }
      where.departmentId = departmentId;
    } else if (departmentFilter) {
      where.departmentId = { in: departmentFilter };
    }

    return this.prisma.dailyTemporaryRoster.findMany({
      where,
      include: {
        department: { select: { id: true, code: true, name: true } },
        agency: { select: { id: true, code: true, name: true } },
        _count: { select: { workers: true } },
      },
      orderBy: [{ operationalDate: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Fetches roster details with workers, applying department-membership authorization and rate redaction.
   */
  async getRoster(params: {
    facilityId: string;
    actorUserId: string;
    rosterId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
  }) {
    const { facilityId, actorUserId, rosterId, actorRole, actorAllAccess = false } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
      include: {
        department: { select: { id: true, code: true, name: true } },
        agency: { select: { id: true, code: true, name: true } },
        workers: {
          orderBy: { workerName: 'asc' },
        },
        history: {
          orderBy: { timestamp: 'desc' },
          take: 20,
        },
      },
    });

    if (!roster) {
      throw new NotFoundException('Roster not found');
    }

    // F-03: Enforce department-membership or admin authorization
    await this.assertCanAccessDepartmentRoster({
      facilityId,
      actorUserId,
      actorRole,
      actorAllAccess,
      departmentId: roster.departmentId,
    });

    const canViewRates = this.canViewPayrollRates(actorRole, actorAllAccess);
    const workers = canViewRates
      ? roster.workers
      : roster.workers.map((w) => ({
          ...w,
          hourlyRateCents: 0,
        }));

    return {
      ...roster,
      workers,
    };
  }

  /**
   * Adds or assigns a worker to a roster. Fails if roster is approved or closed.
   */
  async addWorker(params: {
    organizationId: string;
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    rosterId: string;
    dto: AssignRosterWorkerDto;
  }) {
    const { organizationId, facilityId, actorUserId, actorRole, actorAllAccess, rosterId, dto } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
    });

    if (!roster) throw new NotFoundException('Roster not found');

    if (roster.status === 'approved' || roster.status === 'closed') {
      throw new ForbiddenException('Approved or closed rosters cannot accept new worker additions directly');
    }

    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: roster.departmentId,
      prisma: this.prisma,
    });

    return this.prisma.dailyTemporaryRosterWorker.create({
      data: {
        organizationId,
        facilityId,
        rosterId,
        workerProfileId: dto.workerProfileId,
        workerName: dto.workerName.trim(),
        workerRole: dto.workerRole.trim(),
        assignedOutletId: dto.assignedOutletId,
        shiftStartTime: dto.shiftStartTime ? new Date(dto.shiftStartTime) : null,
        shiftEndTime: dto.shiftEndTime ? new Date(dto.shiftEndTime) : null,
        hourlyRateCents: dto.hourlyRateCents ?? 0,
        attendanceStatus: dto.attendanceStatus ?? 'scheduled',
        notes: dto.notes?.trim(),
      },
    });
  }

  /**
   * Updates an individual worker shift or attendance entry before approval/close.
   */
  async updateWorker(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    rosterId: string;
    workerId: string;
    dto: UpdateRosterWorkerDto;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess, rosterId, workerId, dto } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
    });

    if (!roster) throw new NotFoundException('Roster not found');

    if (roster.status === 'approved' || roster.status === 'closed') {
      throw new ForbiddenException('Approved or closed rosters are immutable; use correction workflow');
    }

    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: roster.departmentId,
      prisma: this.prisma,
    });

    // F-06: Verify worker belongs to this roster
    const worker = await this.prisma.dailyTemporaryRosterWorker.findFirst({
      where: { id: workerId, rosterId: roster.id },
    });
    if (!worker) {
      throw new NotFoundException('Worker not found on the specified roster');
    }

    return this.prisma.dailyTemporaryRosterWorker.update({
      where: { id: worker.id },
      data: {
        ...(dto.checkedInAt !== undefined ? { checkedInAt: dto.checkedInAt ? new Date(dto.checkedInAt) : null } : {}),
        ...(dto.checkedOutAt !== undefined ? { checkedOutAt: dto.checkedOutAt ? new Date(dto.checkedOutAt) : null } : {}),
        ...(dto.hoursWorked !== undefined ? { hoursWorked: dto.hoursWorked } : {}),
        ...(dto.breakMinutes !== undefined ? { breakMinutes: dto.breakMinutes } : {}),
        ...(dto.attendanceStatus !== undefined ? { attendanceStatus: dto.attendanceStatus } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() } : {}),
      },
    });
  }

  /**
   * Submits a roster for supervisor/manager approval.
   */
  async submitRoster(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    rosterId: string;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess, rosterId } = params;
    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
    });
    if (!roster) throw new NotFoundException('Roster not found');
    if (roster.status !== 'draft') {
      throw new BadRequestException('Only draft rosters can be submitted');
    }

    // F-04: Verify actor belongs to the roster's department or is broad admin
    await this.assertCanAccessDepartmentRoster({
      facilityId,
      actorUserId,
      actorRole,
      actorAllAccess,
      departmentId: roster.departmentId,
    });

    return this.prisma.dailyTemporaryRoster.update({
      where: { id: rosterId },
      data: { status: 'submitted', updatedById: actorUserId },
    });
  }

  /**
   * Approves a roster, locking worker records into immutable baseline version 1.
   */
  async approveRoster(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    rosterId: string;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess, rosterId } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
    });
    if (!roster) throw new NotFoundException('Roster not found');

    // F-05: Precondition check - only submitted rosters can be approved
    if (roster.status !== 'submitted') {
      throw new BadRequestException('Only submitted rosters can be approved');
    }

    if (!canManageVenue(actorRole, actorAllAccess)) {
      throw new ForbiddenException('Operational manager authority required to approve rosters');
    }

    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: roster.departmentId,
      prisma: this.prisma,
    });

    const approved = await this.prisma.dailyTemporaryRoster.update({
      where: { id: rosterId },
      data: {
        status: 'approved',
        approvedByUserId: actorUserId,
        approvedAt: new Date(),
        updatedById: actorUserId,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        venueId: facilityId,
        actorProfileId: actorUserId,
        actorRole: actorRole ?? 'unknown',
        entityType: 'DailyTemporaryRoster',
        entityId: rosterId,
        action: 'APPROVE_ROSTER',
        summary: `Approved roster '${roster.name}' for operational date ${roster.operationalDate}`,
      },
    }).catch((err) => this.logger.warn(`Failed to record audit log for APPROVE_ROSTER: ${err instanceof Error ? err.message : String(err)}`));

    return approved;
  }

  /**
   * Closes an operational day roster permanently.
   */
  async closeRoster(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    rosterId: string;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess, rosterId } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
    });
    if (!roster) throw new NotFoundException('Roster not found');

    // F-05: Precondition check - only approved rosters can be closed
    if (roster.status !== 'approved') {
      throw new BadRequestException('Only approved rosters can be closed');
    }

    if (!canManageVenue(actorRole, actorAllAccess)) {
      throw new ForbiddenException('Manager authority required to close operational rosters');
    }

    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: roster.departmentId,
      prisma: this.prisma,
    });

    return this.prisma.dailyTemporaryRoster.update({
      where: { id: rosterId },
      data: {
        status: 'closed',
        closedByUserId: actorUserId,
        closedAt: new Date(),
        updatedById: actorUserId,
      },
    });
  }

  /**
   * Post-close/post-approval correction workflow with version increment, IDOR prevention, CAS, and audit history.
   */
  async adjustClosedRoster(params: {
    organizationId: string;
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    rosterId: string;
    dto: AdjustRosterDto;
  }) {
    const { organizationId, facilityId, actorUserId, actorRole, actorAllAccess, rosterId, dto } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
      include: { workers: true },
    });

    if (!roster) throw new NotFoundException('Roster not found');

    if (!canManageVenue(actorRole, actorAllAccess)) {
      throw new ForbiddenException('Manager authority is required to apply post-approval corrections');
    }

    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: roster.departmentId,
      prisma: this.prisma,
    });

    return this.prisma.$transaction(async (tx) => {
      // F-06 / R2-03: verify every worker belongs to this roster INSIDE the
      // transaction, so the relationship cannot change between the check and
      // the write. The writes below additionally repeat `rosterId` in their
      // own predicate, so ownership is enforced by the update itself rather
      // than only by this pre-check.
      if (dto.workerUpdates && dto.workerUpdates.length > 0) {
        for (const update of dto.workerUpdates) {
          const worker = await tx.dailyTemporaryRosterWorker.findFirst({
            where: { id: update.workerId, rosterId: roster.id },
          });
          if (!worker) {
            throw new NotFoundException(`Worker ${update.workerId} does not belong to this roster`);
          }
        }
      }

      // F-08: CAS version update
      const updateResult = await tx.dailyTemporaryRoster.updateMany({
        where: { id: rosterId, version: roster.version },
        data: {
          version: { increment: 1 },
          updatedById: actorUserId,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Roster was concurrently modified; please re-fetch and retry');
      }

      const newVersion = roster.version + 1;

      // Record history snapshot
      await tx.dailyTemporaryRosterHistory.create({
        data: {
          organizationId,
          facilityId,
          rosterId,
          version: newVersion,
          changedByUserId: actorUserId,
          changeType: 'POST_APPROVAL_ADJUSTMENT',
          summary: dto.reason.trim(),
          details: { updates: JSON.parse(JSON.stringify(dto.workerUpdates ?? [])) },
        },
      });

      // Apply worker updates if provided
      if (dto.workerUpdates && dto.workerUpdates.length > 0) {
        for (const update of dto.workerUpdates) {
          // R2-03: `updateMany` (not `update`) so `rosterId` can be part of the
          // write predicate. A worker that does not belong to this roster
          // matches nothing and is rejected, closing the check-to-use window.
          const workerResult = await tx.dailyTemporaryRosterWorker.updateMany({
            where: { id: update.workerId, rosterId: roster.id },
            data: {
              ...(update.hoursWorked !== undefined ? { hoursWorked: update.hoursWorked } : {}),
              ...(update.breakMinutes !== undefined ? { breakMinutes: update.breakMinutes } : {}),
              ...(update.attendanceStatus !== undefined ? { attendanceStatus: update.attendanceStatus } : {}),
              ...(update.notes !== undefined ? { notes: update.notes } : {}),
            },
          });

          if (workerResult.count === 0) {
            throw new NotFoundException(`Worker ${update.workerId} does not belong to this roster`);
          }
        }
      }

      return tx.dailyTemporaryRoster.findUniqueOrThrow({
        where: { id: rosterId },
      });
    });
  }

  /**
   * Generates CSV export of a roster with sensitive payroll fields redacted and formula-injection sanitized.
   */
  async exportRosterCsv(params: {
    facilityId: string;
    actorUserId: string;
    rosterId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
  }): Promise<string> {
    const { facilityId, actorUserId, rosterId, actorRole, actorAllAccess = false } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
      include: {
        department: true,
        workers: { orderBy: { workerName: 'asc' } },
      },
    });

    if (!roster) throw new NotFoundException('Roster not found');

    // F-03: Assert department membership or admin authorization
    await this.assertCanAccessDepartmentRoster({
      facilityId,
      actorUserId,
      actorRole,
      actorAllAccess,
      departmentId: roster.departmentId,
    });

    const canViewRates = this.canViewPayrollRates(actorRole, actorAllAccess);

    const headers = [
      'Roster ID',
      'Operational Date',
      'Roster Name',
      'Staffing Source',
      'Department',
      'Status',
      'Worker Name',
      'Role',
      'Shift Start',
      'Shift End',
      'Hours Worked',
      'Break Mins',
      'Hourly Rate Cents',
      'Attendance',
      'Notes',
    ];

    // F-10: Neutralize CSV formula injection on every cell
    const rows = roster.workers.map((w) => [
      sanitizeCsvCell(roster.id),
      sanitizeCsvCell(roster.operationalDate),
      sanitizeCsvCell(roster.name),
      sanitizeCsvCell(roster.staffingSource),
      sanitizeCsvCell(roster.department.name),
      sanitizeCsvCell(roster.status),
      sanitizeCsvCell(w.workerName),
      sanitizeCsvCell(w.workerRole),
      sanitizeCsvCell(w.shiftStartTime ? w.shiftStartTime.toISOString() : ''),
      sanitizeCsvCell(w.shiftEndTime ? w.shiftEndTime.toISOString() : ''),
      sanitizeCsvCell(w.hoursWorked),
      sanitizeCsvCell(w.breakMinutes),
      sanitizeCsvCell(canViewRates ? w.hourlyRateCents : '[REDACTED]'),
      sanitizeCsvCell(w.attendanceStatus),
      sanitizeCsvCell(w.notes ?? ''),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
