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

const ROLE_RANK: Record<string, number> = {
  staff: 0,
  server: 1,
  manager: 2,
  owner: 3,
  admin: 3,
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
