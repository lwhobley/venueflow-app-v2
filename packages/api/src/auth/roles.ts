/**
 * Roles that may manage venue-level configuration.
 */
export function isAdminRole(role?: string | null): boolean {
  return ['admin', 'owner', 'manager', 'platform_admin', 'organization_admin', 'fnb_director'].includes(role ?? '');
}

/** Venue-level manager access, including internal/support profiles. */
export function canManageVenue(role?: string | null, allAccess = false): boolean {
  return allAccess || isAdminRole(role) || ['event_manager', 'outlet_manager', 'executive_chef', 'warehouse_manager', 'premium_manager'].includes(role ?? '');
}

/**
 * Roles that may run operational actions, but only through endpoints that
 * enforce their persisted facility/zone assignment. Do not use this for
 * venue-wide legacy routes.
 */
export function canManageAssignedScope(role?: string | null): boolean {
  return ['concourse_supervisor', 'suite_manager'].includes(role ?? '');
}

/** Enterprise identity-provider configuration is not a general venue-manager action. */
export function canManageEnterpriseSso(role?: string | null): boolean {
  return ['platform_admin', 'organization_admin', 'owner', 'admin'].includes(role ?? '');
}

export function canAssignEnterpriseRole(actorRole: string | null | undefined, targetRole: string): boolean {
  if (actorRole === 'platform_admin') return true;
  if (!canManageEnterpriseSso(actorRole)) return false;
  return !['platform_admin', 'organization_admin'].includes(targetRole);
}

export function canViewPilotHealth(role?: string | null, allAccess = false): boolean {
  return allAccess || ['platform_admin', 'organization_admin', 'owner', 'admin', 'fnb_director', 'event_manager', 'finance_viewer', 'auditor'].includes(role ?? '');
}

/**
 * Viewing a facility other than your own is a platform-wide capability, not a
 * venue-manager one — being an owner/admin/auditor of venue A must not grant
 * visibility into venue B's live operational stream.
 */
export function canAccessCrossFacilityRealtime(role?: string | null, allAccess = false): boolean {
  return allAccess || ['platform_admin', 'organization_admin'].includes(role ?? '');
}

/** Only leadership may use a reason-required recovery transition after approval. */
export function canOverrideEventState(role?: string | null, allAccess = false): boolean {
  return allAccess || ['platform_admin', 'organization_admin', 'owner', 'admin', 'fnb_director', 'event_manager'].includes(role ?? '');
}

/** Finance viewers may read closeout; finalization and adjustment require leadership. */
export function canFinalizeCloseout(role?: string | null, allAccess = false): boolean {
  return allAccess || ['platform_admin', 'organization_admin', 'owner', 'admin', 'fnb_director'].includes(role ?? '');
}

/**
 * Ranks every role in the Prisma Role enum. A role missing here makes
 * canManageRole() fail closed for it (actorRank/targetRank both undefined),
 * which previously left platform_admin, organization_admin, and the other
 * enterprise/stadium roles silently unable to re-role or remove staff.
 *
 * Tiers mirror the groupings this file already draws elsewhere:
 *  - Tier 3 matches isAdminRole (admin, owner, manager's superiors, plus the
 *    enterprise/org roles isAdminRole already treats identically).
 *  - Tier 2 is the remaining canManageVenue roles — operational managers
 *    scoped to a department rather than full venue configuration.
 *  - Tier 1 is non-manager staff with elevated read visibility.
 */
export const ROLE_RANK: Record<string, number> = {
  staff: 0,
  server: 1,
  auditor: 1,
  finance_viewer: 1,
  manager: 2,
  concourse_supervisor: 2,
  suite_manager: 2,
  event_manager: 2,
  outlet_manager: 2,
  executive_chef: 2,
  warehouse_manager: 2,
  premium_manager: 2,
  owner: 3,
  admin: 3,
  platform_admin: 3,
  organization_admin: 3,
  fnb_director: 3,
};

/**
 * Whether an actor may modify (re-role, remove) a target profile.
 *
 *  - allAccess (internal/support) may manage anyone.
 *  - You can never manage someone ranked higher than you.
 *  - Equal-rank management is allowed only at the owner/admin tier, so owners
 *    and admins can manage each other, but a manager cannot touch another
 *    manager or an owner.
 *
 * Self-edits are handled by callers, not here.
 */
export function canManageRole(actorRole: string | null | undefined, targetRole: string | null | undefined, actorAllAccess = false): boolean {
  if (actorAllAccess) return true;
  const actorRank = actorRole ? ROLE_RANK[actorRole] : undefined;
  const targetRank = targetRole ? ROLE_RANK[targetRole] : undefined;
  if (actorRank === undefined || targetRank === undefined) return false;
  if (actorRank < targetRank) return false;
  if (actorRank === targetRank) return actorRank >= 3;
  return true;
}

export function isOwnerOrAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'owner';
}
