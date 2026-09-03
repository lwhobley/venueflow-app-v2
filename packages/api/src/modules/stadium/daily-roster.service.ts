import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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

@Injectable()
export class DailyRosterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper to check if actor has permission to see financial/payroll rates.
   */
  private canViewPayrollRates(role?: string | null, allAccess = false): boolean {
    return allAccess || isOwnerOrAdminRole(role) || role === 'finance_viewer';
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
    }).catch(() => undefined);

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
   * Fetches roster details with workers, applying financial redaction where required.
   */
  async getRoster(params: {
    facilityId: string;
    rosterId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
  }) {
    const { facilityId, rosterId, actorRole, actorAllAccess = false } = params;

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
        attendanceStatus: 'scheduled',
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

    return this.prisma.dailyTemporaryRosterWorker.update({
      where: { id: workerId },
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
  async submitRoster(facilityId: string, actorUserId: string, rosterId: string) {
    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
    });
    if (!roster) throw new NotFoundException('Roster not found');
    if (roster.status !== 'draft') {
      throw new BadRequestException('Only draft rosters can be submitted');
    }

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
    }).catch(() => undefined);

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
   * Post-close/post-approval correction workflow with version increment and audit history.
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

    const newVersion = roster.version + 1;

    return this.prisma.$transaction(async (tx) => {
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
          details: { updates: dto.workerUpdates ?? [] },
        },
      });

      // Apply worker updates if provided
      if (dto.workerUpdates && dto.workerUpdates.length > 0) {
        for (const update of dto.workerUpdates) {
          await tx.dailyTemporaryRosterWorker.update({
            where: { id: update.workerId },
            data: {
              ...(update.hoursWorked !== undefined ? { hoursWorked: update.hoursWorked } : {}),
              ...(update.breakMinutes !== undefined ? { breakMinutes: update.breakMinutes } : {}),
              ...(update.attendanceStatus !== undefined ? { attendanceStatus: update.attendanceStatus } : {}),
              ...(update.notes !== undefined ? { notes: update.notes } : {}),
            },
          });
        }
      }

      return tx.dailyTemporaryRoster.update({
        where: { id: rosterId },
        data: {
          version: newVersion,
          updatedById: actorUserId,
        },
      });
    });
  }

  /**
   * Generates CSV export of a roster with sensitive payroll fields redacted when unauthorized.
   */
  async exportRosterCsv(params: {
    facilityId: string;
    rosterId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
  }): Promise<string> {
    const { facilityId, rosterId, actorRole, actorAllAccess = false } = params;

    const roster = await this.prisma.dailyTemporaryRoster.findFirst({
      where: { facilityId, id: rosterId },
      include: {
        department: true,
        workers: { orderBy: { workerName: 'asc' } },
      },
    });

    if (!roster) throw new NotFoundException('Roster not found');

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

    const rows = roster.workers.map((w) => [
      roster.id,
      roster.operationalDate,
      `"${roster.name.replace(/"/g, '""')}"`,
      `"${roster.staffingSource.replace(/"/g, '""')}"`,
      `"${roster.department.name.replace(/"/g, '""')}"`,
      roster.status,
      `"${w.workerName.replace(/"/g, '""')}"`,
      `"${w.workerRole.replace(/"/g, '""')}"`,
      w.shiftStartTime ? w.shiftStartTime.toISOString() : '',
      w.shiftEndTime ? w.shiftEndTime.toISOString() : '',
      w.hoursWorked,
      w.breakMinutes,
      canViewRates ? w.hourlyRateCents : '[REDACTED]',
      w.attendanceStatus,
      `"${(w.notes ?? '').replace(/"/g, '""')}"`,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
