import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCanManageDepartment } from '../../auth/access-control.helper';
import { canManageVenue, isAdminRole } from '../../auth/roles';
import type { CreateUserAreaOverrideDto } from './departments.dto';

export const STANDARD_VENUE_DEPARTMENTS = [
  { code: 'suites', name: 'Suites & Premium Hospitality', defaultRoute: '/stadium/suite-attendant', visibilityScope: 'isolated' as const },
  { code: 'clubs', name: 'Clubs & Premium Lounges', defaultRoute: '/stadium/suite-attendant', visibilityScope: 'isolated' as const },
  { code: 'catering', name: 'Catering & Banquets', defaultRoute: '/stadium/commissary', visibilityScope: 'isolated' as const },
  { code: 'concessions', name: 'Concessions & Hawkers', defaultRoute: '/stadium/stand-sheet', visibilityScope: 'isolated' as const },
  { code: 'culinary', name: 'Culinary Production & Kitchen', defaultRoute: '/stadium/kds', visibilityScope: 'operational' as const },
  { code: 'maintenance', name: 'Maintenance & Facilities', defaultRoute: '/stadium/labor-dashboard', visibilityScope: 'operational' as const },
  { code: 'engineering', name: 'Engineering & Utilities', defaultRoute: '/stadium/labor-dashboard', visibilityScope: 'operational' as const },
  { code: 'security', name: 'Security & Safety', defaultRoute: '/event-command-center', visibilityScope: 'operational' as const },
  { code: 'custodial', name: 'Custodial & Housekeeping', defaultRoute: '/stadium/labor-dashboard', visibilityScope: 'operational' as const },
  { code: 'it', name: 'IT & POS Systems', defaultRoute: '/stadium/pos-aggregator', visibilityScope: 'operational' as const },
  { code: 'operations', name: 'Executive & Operations', defaultRoute: '/(tabs)/home', visibilityScope: 'broad' as const },
];

export interface WorkspaceResolution {
  assigned: boolean;
  primaryDepartment?: { id: string; code: string; name: string; defaultRoute: string };
  departments: Array<{ id: string; code: string; name: string; defaultRoute: string; isPrimary: boolean }>;
  allowedOperationalAreas: string[];
  defaultRoute: string;
  effectiveRole: string;
}

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Automatically initializes standard venue departments if not present.
   */
  async ensureDefaultDepartments(organizationId: string, facilityId: string): Promise<void> {
    const existing = await this.prisma.department.findMany({
      where: { facilityId },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((d) => d.code.toLowerCase()));

    const missing = STANDARD_VENUE_DEPARTMENTS.filter((d) => !existingCodes.has(d.code));
    if (missing.length === 0) return;

    await Promise.all(
      missing.map((dept) =>
        this.prisma.department.create({
          data: {
            organizationId,
            facilityId,
            code: dept.code,
            name: dept.name,
            defaultRoute: dept.defaultRoute,
            visibilityScope: dept.visibilityScope,
            active: true,
          },
        }),
      ),
    );
  }

  /**
   * Resolves the active user's workspace, primary department, allowed areas, and landing route.
   */
  async resolveUserWorkspace(facilityId: string, userId: string): Promise<WorkspaceResolution> {
    const profile = await this.prisma.profile.findFirst({
      where: {
        userId,
        venueId: facilityId,
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
      select: { id: true, role: true, allAccess: true },
    });

    if (!profile) {
      throw new NotFoundException('Active profile membership not found at this venue');
    }

    const memberships = await this.prisma.departmentMembership.findMany({
      where: {
        facilityId,
        userId,
        isActive: true,
        department: { active: true },
      },
      include: {
        department: {
          select: { id: true, code: true, name: true, defaultRoute: true },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    const isBroadAdmin = profile.allAccess || isAdminRole(profile.role);

    if (memberships.length === 0) {
      if (isBroadAdmin) {
        return {
          assigned: true,
          primaryDepartment: { id: 'admin-ops', code: 'operations', name: 'Operations', defaultRoute: '/(tabs)/home' },
          departments: [{ id: 'admin-ops', code: 'operations', name: 'Operations', defaultRoute: '/(tabs)/home', isPrimary: true }],
          allowedOperationalAreas: ['suite', 'club', 'catering', 'concession', 'culinary', 'kitchen', 'distro', 'maintenance', 'engineering', 'security', 'custodial', 'administrative', 'shared', 'other'],
          defaultRoute: '/(tabs)/home',
          effectiveRole: profile.role,
        };
      }
      return {
        assigned: false,
        departments: [],
        allowedOperationalAreas: [],
        defaultRoute: '/department-required',
        effectiveRole: profile.role,
      };
    }

    const primary = memberships.find((m) => m.isPrimary) ?? memberships[0];
    const departments = memberships.map((m) => ({
      id: m.department.id,
      code: m.department.code,
      name: m.department.name,
      defaultRoute: m.department.defaultRoute,
      isPrimary: m.isPrimary,
    }));

    // Collect baseline areas
    const allowedAreas = new Set<string>(['shared']);
    for (const m of memberships) {
      const code = m.department.code.toLowerCase();
      if (code === 'suites') allowedAreas.add('suite');
      if (code === 'clubs') allowedAreas.add('club');
      if (code === 'catering') { allowedAreas.add('catering'); allowedAreas.add('kitchen'); allowedAreas.add('distro'); }
      if (code === 'concessions') allowedAreas.add('concession');
      if (code === 'culinary') {
        allowedAreas.add('culinary');
        allowedAreas.add('kitchen');
        allowedAreas.add('distro');
        allowedAreas.add('suite');
        allowedAreas.add('club');
        allowedAreas.add('catering');
      }
      if (code === 'operations') {
        ['suite', 'club', 'catering', 'concession', 'culinary', 'kitchen', 'distro', 'maintenance', 'engineering', 'security', 'custodial', 'administrative', 'other'].forEach((a) => allowedAreas.add(a));
      }
    }

    return {
      assigned: true,
      primaryDepartment: {
        id: primary.department.id,
        code: primary.department.code,
        name: primary.department.name,
        defaultRoute: primary.department.defaultRoute,
      },
      departments,
      allowedOperationalAreas: Array.from(allowedAreas),
      defaultRoute: primary.department.defaultRoute,
      effectiveRole: profile.role,
    };
  }

  /**
   * Switches the user's primary department workspace preference.
   */
  async switchPrimaryDepartment(facilityId: string, userId: string, targetDepartmentId: string): Promise<void> {
    const membership = await this.prisma.departmentMembership.findFirst({
      where: {
        facilityId,
        userId,
        departmentId: targetDepartmentId,
        isActive: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('Cannot switch to unassigned department');
    }

    await this.prisma.$transaction([
      this.prisma.departmentMembership.updateMany({
        where: { facilityId, userId },
        data: { isPrimary: false },
      }),
      this.prisma.departmentMembership.update({
        where: { id: membership.id },
        data: { isPrimary: true },
      }),
    ]);
  }

  /**
   * Lists active departments for a venue.
   */
  async listDepartments(facilityId: string) {
    return this.prisma.department.findMany({
      where: { facilityId, active: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Assigns a user to a department, ensuring manager-of-department boundaries.
   */
  async assignMember(params: {
    organizationId: string;
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    departmentId: string;
    targetUserId: string;
    isPrimary?: boolean;
  }) {
    const { organizationId, facilityId, actorUserId, actorRole, actorAllAccess, departmentId, targetUserId, isPrimary = false } = params;

    // Prevent self-assignment or self-elevation
    if (actorUserId === targetUserId && !actorAllAccess && actorRole !== 'platform_admin' && actorRole !== 'owner') {
      throw new ForbiddenException('Self-assignment to departments is prohibited');
    }

    // Verify manager-of-department authority
    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: departmentId,
      prisma: this.prisma,
    });

    const targetProfile = await this.prisma.profile.findFirst({
      where: { userId: targetUserId, venueId: facilityId },
      select: { id: true, fullName: true, role: true },
    });

    if (!targetProfile) {
      throw new NotFoundException('Target user does not have a profile at this venue');
    }

    const existing = await this.prisma.departmentMembership.findFirst({
      where: { facilityId, departmentId, userId: targetUserId },
    });

    if (existing) {
      return this.prisma.departmentMembership.update({
        where: { id: existing.id },
        data: { isActive: true, isPrimary: isPrimary || existing.isPrimary },
      });
    }

    const created = await this.prisma.departmentMembership.create({
      data: {
        organizationId,
        facilityId,
        departmentId,
        userId: targetUserId,
        profileId: targetProfile.id,
        isPrimary,
        isActive: true,
        assignedByUserId: actorUserId,
      },
    });

    // Audit log entry
    await this.prisma.auditLog.create({
      data: {
        venueId: facilityId,
        actorProfileId: actorUserId,
        actorRole: actorRole ?? 'unknown',
        targetProfileId: targetProfile.id,
        targetName: targetProfile.fullName,
        targetRole: targetProfile.role,
        entityType: 'DepartmentMembership',
        entityId: created.id,
        action: 'ASSIGN_DEPARTMENT',
        summary: `Assigned target to department ${departmentId}`,
      },
    }).catch((err) => this.logger.warn(`Failed to record audit log for ASSIGN_DEPARTMENT: ${err instanceof Error ? err.message : String(err)}`));

    return created;
  }

  /**
   * Removes or deactivates a user's department membership.
   */
  async removeMember(params: {
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    departmentId: string;
    targetUserId: string;
  }) {
    const { facilityId, actorUserId, actorRole, actorAllAccess, departmentId, targetUserId } = params;

    // Prevent self-removal
    if (actorUserId === targetUserId && !actorAllAccess && actorRole !== 'platform_admin' && actorRole !== 'owner') {
      throw new ForbiddenException('Self-removal is prohibited');
    }

    await assertCanManageDepartment({
      actorUserId,
      actorRole,
      actorAllAccess,
      facilityId,
      targetDepartmentId: departmentId,
      prisma: this.prisma,
    });

    const membership = await this.prisma.departmentMembership.findFirst({
      where: { facilityId, departmentId, userId: targetUserId, isActive: true },
    });

    if (!membership) {
      throw new NotFoundException('Active membership not found');
    }

    await this.prisma.departmentMembership.update({
      where: { id: membership.id },
      data: { isActive: false, isPrimary: false },
    });

    // Audit log entry
    await this.prisma.auditLog.create({
      data: {
        venueId: facilityId,
        actorProfileId: actorUserId,
        actorRole: actorRole ?? 'unknown',
        entityType: 'DepartmentMembership',
        entityId: membership.id,
        action: 'REMOVE_DEPARTMENT',
        summary: `Deactivated department membership for user ${targetUserId}`,
      },
    }).catch((err) => this.logger.warn(`Failed to record audit log for REMOVE_DEPARTMENT: ${err instanceof Error ? err.message : String(err)}`));
  }

  /**
   * Issues a temporary user area override with explicit reason and expiry.
   */
  async createOverride(params: {
    organizationId: string;
    facilityId: string;
    actorUserId: string;
    actorRole?: string | null;
    actorAllAccess?: boolean;
    dto: CreateUserAreaOverrideDto;
  }) {
    const { organizationId, facilityId, actorUserId, actorRole, actorAllAccess, dto } = params;

    if (!canManageVenue(actorRole, actorAllAccess)) {
      throw new ForbiddenException('Manager authority is required to grant overrides');
    }

    if (actorUserId === dto.userId && !actorAllAccess && actorRole !== 'platform_admin' && actorRole !== 'owner') {
      throw new ForbiddenException('Self-elevation and self-overrides are prohibited');
    }

    const targetProfile = await this.prisma.profile.findFirst({
      where: { userId: dto.userId, venueId: facilityId },
      select: { id: true, fullName: true, role: true },
    });

    if (!targetProfile) {
      throw new NotFoundException('Target profile not found at this venue');
    }

    const now = new Date();
    const expiresAt = new Date(dto.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt <= now) {
      throw new BadRequestException('Expiration must be a valid future timestamp');
    }

    // F-12: Cap duration to 30 days unless platform_admin or owner
    const maxDurationMs = 30 * 24 * 60 * 60 * 1000;
    if (expiresAt.getTime() - now.getTime() > maxDurationMs && !actorAllAccess && actorRole !== 'platform_admin' && actorRole !== 'owner') {
      throw new BadRequestException('Temporary override duration cannot exceed 30 days');
    }

    // F-12: Validate target operational area IDs if provided
    if (dto.zoneId) {
      const zone = await this.prisma.facilityZone.findFirst({
        where: { id: dto.zoneId, facilityId },
      });
      if (!zone) throw new NotFoundException('Specified facility zone does not exist at this venue');
    }
    if (dto.outletId) {
      const outlet = await this.prisma.outlet.findFirst({
        where: { id: dto.outletId, facilityId },
      });
      if (!outlet) throw new NotFoundException('Specified outlet does not exist at this venue');
    }
    if (dto.subVenueId) {
      const subVenue = await this.prisma.subVenue.findFirst({
        where: { id: dto.subVenueId, facilityId },
      });
      if (!subVenue) throw new NotFoundException('Specified sub-venue does not exist at this venue');
    }

    const override = await this.prisma.userAreaOverride.create({
      data: {
        organizationId,
        facilityId,
        userId: dto.userId,
        profileId: targetProfile.id,
        areaType: dto.areaType,
        zoneId: dto.zoneId,
        subVenueId: dto.subVenueId,
        outletId: dto.outletId,
        eventId: dto.eventId,
        reason: dto.reason.trim(),
        grantedByUserId: actorUserId,
        expiresAt,
        active: true,
      },
    });

    // Audit log entry
    await this.prisma.auditLog.create({
      data: {
        venueId: facilityId,
        actorProfileId: actorUserId,
        actorRole: actorRole ?? 'unknown',
        targetProfileId: targetProfile.id,
        targetName: targetProfile.fullName,
        targetRole: targetProfile.role,
        entityType: 'UserAreaOverride',
        entityId: override.id,
        action: 'GRANT_AREA_OVERRIDE',
        summary: `Granted ${dto.areaType} override to user ${dto.userId}: ${dto.reason}`,
      },
    }).catch((err) => this.logger.warn(`Failed to record audit log for GRANT_AREA_OVERRIDE: ${err instanceof Error ? err.message : String(err)}`));

    return override;
  }
}
