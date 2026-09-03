import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { canManageVenue, isAdminRole, ROLE_RANK, canManageRole } from './roles';
import type { OperationalAreaType } from '@prisma/client';

export type ResourceAction =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'assign'
  | 'export'
  | 'close';

export type SensitiveResourceCategory =
  | 'payroll'
  | 'compensation'
  | 'hr_disciplinary'
  | 'employee_pii'
  | 'guest_sensitive_pii'
  | 'payment_data'
  | 'billing'
  | 'secrets'
  | 'platform_admin'
  | 'sensitive_audit';

export interface CanAccessResourceParams {
  userId: string;
  organizationId: string;
  venueId: string;
  departmentId?: string;
  departmentCode?: string;
  operationalAreaId?: string;
  operationalAreaType?: OperationalAreaType | string;
  resourceType: string;
  action: ResourceAction;
  sensitiveCategory?: SensitiveResourceCategory;
  resourceContext?: Record<string, unknown>;
  prisma: PrismaService;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
  effectiveRole?: string;
  primaryDepartmentCode?: string;
  activeDepartmentCodes: string[];
}

/** Normalized operational areas permitted by department code without overrides */
const BASELINE_DEPARTMENT_AREAS: Record<string, Set<string>> = {
  suites: new Set(['suite', 'shared']),
  clubs: new Set(['club', 'shared']),
  catering: new Set(['catering', 'kitchen', 'distro', 'shared']),
  concessions: new Set(['concession', 'shared']),
  culinary: new Set(['culinary', 'kitchen', 'distro', 'suite', 'club', 'catering', 'shared']),
  maintenance: new Set(['maintenance', 'shared', 'other']),
  engineering: new Set(['engineering', 'shared', 'other']),
  security: new Set(['security', 'shared', 'other']),
  custodial: new Set(['custodial', 'shared', 'other']),
  it: new Set(['maintenance', 'engineering', 'shared', 'other']),
  operations: new Set([
    'suite', 'club', 'catering', 'concession', 'culinary', 'kitchen',
    'distro', 'maintenance', 'engineering', 'security', 'custodial',
    'administrative', 'shared', 'other'
  ]),
};

/**
 * Pure evaluation function for in-memory and testable access verification.
 */
export function evaluateAccessRules(params: {
  role?: string | null;
  allAccess?: boolean;
  activeDepartmentCodes: string[];
  operationalAreaType?: string;
  action: ResourceAction;
  sensitiveCategory?: SensitiveResourceCategory;
  hasActiveOverride?: boolean;
}): { allowed: boolean; reason?: string } {
  const {
    role,
    allAccess = false,
    activeDepartmentCodes,
    operationalAreaType,
    action,
    sensitiveCategory,
    hasActiveOverride = false,
  } = params;

  // 1. Sensitive Resource Guard
  if (sensitiveCategory) {
    if (sensitiveCategory === 'secrets' || sensitiveCategory === 'platform_admin') {
      if (role !== 'platform_admin' && !allAccess) {
        return { allowed: false, reason: 'Platform administration privilege required' };
      }
    } else if (sensitiveCategory === 'payroll' || sensitiveCategory === 'compensation' || sensitiveCategory === 'billing') {
      const allowedBillingRoles = ['owner', 'admin', 'platform_admin', 'organization_admin'];
      if (!allAccess && !allowedBillingRoles.includes(role ?? '')) {
        // finance_viewer is read-only for billing/payroll
        if (role === 'finance_viewer' && action === 'view') {
          // allowed for view
        } else {
          return { allowed: false, reason: 'Payroll, financial, and billing data require explicit management authorization' };
        }
      }
    } else if (sensitiveCategory === 'hr_disciplinary' || sensitiveCategory === 'employee_pii') {
      const allowedHrRoles = ['owner', 'admin', 'platform_admin', 'organization_admin'];
      if (!allAccess && !allowedHrRoles.includes(role ?? '')) {
        return { allowed: false, reason: 'Confidential personnel data is restricted' };
      }
    }
  }

  // 2. Department Requirement
  // Broad administrative roles may operate if explicitly configured
  const isBroadAdmin = allAccess || role === 'platform_admin' || role === 'organization_admin' || role === 'owner' || role === 'admin';
  if (!isBroadAdmin && activeDepartmentCodes.length === 0 && !hasActiveOverride) {
    return { allowed: false, reason: 'Department assignment required' };
  }

  // 3. Operational Area Boundaries & Department Isolation
  if (operationalAreaType) {
    const areaLower = operationalAreaType.toLowerCase();

    // STRICT INVARIANT: Culinary NEVER receives Concessions data absent an explicit exception
    if (areaLower === 'concession') {
      const isConcessionsMember = activeDepartmentCodes.includes('concessions');
      const isOpsOrAdmin = isBroadAdmin || activeDepartmentCodes.includes('operations');
      if (!isConcessionsMember && !isOpsOrAdmin && !hasActiveOverride) {
        return { allowed: false, reason: 'Culinary and non-concessions departments are excluded from Concessions operations' };
      }
    }

    // Check baseline department areas
    if (!isBroadAdmin && !hasActiveOverride) {
      let areaPermitted = false;
      for (const dept of activeDepartmentCodes) {
        const allowedAreas = BASELINE_DEPARTMENT_AREAS[dept.toLowerCase()];
        if (allowedAreas && allowedAreas.has(areaLower)) {
          areaPermitted = true;
          break;
        }
      }
      if (!areaPermitted) {
        return { allowed: false, reason: `Department access restricted: operational area '${operationalAreaType}' not authorized` };
      }
    }
  }

  // 4. Role Action Permissions
  const rank = role ? (ROLE_RANK[role] ?? 0) : 0;
  if (action === 'delete') {
    if (!allAccess && rank < 2) {
      return { allowed: false, reason: 'Manager or administrator role required for deletion' };
    }
  } else if (action === 'approve' || action === 'close') {
    if (!allAccess && rank < 2) {
      return { allowed: false, reason: 'Approval and closeout actions require operational manager authority' };
    }
  } else if (action === 'export') {
    // Auditors, finance viewers, and managers may export non-sensitive operational data
    if (!allAccess && rank < 1 && role !== 'auditor' && role !== 'finance_viewer') {
      return { allowed: false, reason: 'Export permission required' };
    }
  } else if (action === 'create' || action === 'update') {
    // Read-only roles cannot mutate
    if (role === 'finance_viewer' || role === 'auditor') {
      return { allowed: false, reason: 'Auditor and finance roles have read-only access' };
    }
  }

  return { allowed: true };
}

/**
 * Trusted server-side authorization helper that evaluates identity, organization/venue
 * membership, active department membership, area policy, temporary overrides, role
 * permissions, and resource sensitivity context.
 */
export async function canAccessResource(params: CanAccessResourceParams): Promise<AccessDecision> {
  const {
    userId,
    venueId,
    departmentId,
    departmentCode,
    operationalAreaId,
    operationalAreaType,
    resourceType,
    action,
    sensitiveCategory,
    prisma,
  } = params;

  // 1. Verify Active Venue Membership (Profile)
  const profile = await prisma.profile.findFirst({
    where: {
      userId,
      venueId,
      OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
    },
    select: { id: true, role: true, allAccess: true },
  });

  if (!profile) {
    return {
      allowed: false,
      reason: 'User does not hold an active membership at the requested venue',
      activeDepartmentCodes: [],
    };
  }

  // 2. Fetch Active Department Memberships
  const memberships = await prisma.departmentMembership.findMany({
    where: {
      facilityId: venueId,
      userId,
      isActive: true,
      department: { active: true },
    },
    include: {
      department: { select: { id: true, code: true, name: true, defaultRoute: true } },
    },
  });

  const activeDepartmentCodes = memberships.map((m) => m.department.code.toLowerCase());
  const primaryMembership = memberships.find((m) => m.isPrimary) ?? memberships[0];
  const primaryDepartmentCode = primaryMembership?.department.code;

  // If a specific departmentId or departmentCode was requested, assert membership
  if (departmentId || departmentCode) {
    const hasRequestedDept = memberships.some((m) =>
      (departmentId && m.departmentId === departmentId) ||
      (departmentCode && m.department.code.toLowerCase() === departmentCode.toLowerCase())
    );
    const isBroadAdmin = profile.allAccess || isAdminRole(profile.role);
    if (!hasRequestedDept && !isBroadAdmin) {
      return {
        allowed: false,
        reason: 'User is not an active member of the requested department',
        effectiveRole: profile.role,
        primaryDepartmentCode,
        activeDepartmentCodes,
      };
    }
  }

  // 3. Check Active User Area Overrides
  const now = new Date();
  const activeOverride = await prisma.userAreaOverride.findFirst({
    where: {
      facilityId: venueId,
      userId,
      active: true,
      startsAt: { lte: now },
      expiresAt: { gte: now },
      ...(operationalAreaType ? { areaType: operationalAreaType as OperationalAreaType } : {}),
    },
  });

  // 4. Evaluate access rules
  const decision = evaluateAccessRules({
    role: profile.role,
    allAccess: profile.allAccess,
    activeDepartmentCodes,
    operationalAreaType: operationalAreaType ? String(operationalAreaType) : undefined,
    action,
    sensitiveCategory,
    hasActiveOverride: Boolean(activeOverride),
  });

  return {
    allowed: decision.allowed,
    reason: decision.reason,
    effectiveRole: profile.role,
    primaryDepartmentCode,
    activeDepartmentCodes,
  };
}

/**
 * Asserts manager-of-department authority: an actor can only manage users or
 * rosters within department(s) they are explicitly assigned to and authorized to manage.
 */
export async function assertCanManageDepartment(params: {
  actorUserId: string;
  actorRole?: string | null;
  actorAllAccess?: boolean;
  facilityId: string;
  targetDepartmentId: string;
  prisma: PrismaService;
}): Promise<void> {
  const { actorUserId, actorRole, actorAllAccess = false, facilityId, targetDepartmentId, prisma } = params;

  // Platform and organization admins have venue-wide authority
  if (actorAllAccess || actorRole === 'platform_admin' || actorRole === 'organization_admin' || actorRole === 'owner' || actorRole === 'admin') {
    return;
  }

  // Manager must have manager/director role
  if (!canManageVenue(actorRole, actorAllAccess)) {
    throw new ForbiddenException('Management authority is required');
  }

  // Must hold an active membership in the target department
  const membership = await prisma.departmentMembership.findFirst({
    where: {
      facilityId,
      userId: actorUserId,
      departmentId: targetDepartmentId,
      isActive: true,
    },
  });

  if (!membership) {
    throw new ForbiddenException('Manager authority is restricted to assigned department(s)');
  }
}
