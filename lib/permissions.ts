type RoleName = string | null | undefined;

/**
 * Client mirror of `packages/api/src/auth/roles.ts`. These two lists must stay
 * in step: when the client under-counts a role the user is served the staff UI
 * while the API happily accepts their manager writes, which reads as the app
 * being broken for exactly the enterprise/stadium roles it was built for.
 */

/** Roles that may manage venue-level configuration. */
const ADMIN_ROLES = [
  'admin',
  'owner',
  'manager',
  'platform_admin',
  'organization_admin',
  'fnb_director',
] as const;

/** Operational managers scoped to a department rather than full venue configuration. */
const OPERATIONAL_MANAGER_ROLES = [
  'event_manager',
  'outlet_manager',
  'executive_chef',
  'warehouse_manager',
  'premium_manager',
] as const;

/** Billing is an ownership-tier action, not something an operational manager does. */
const BILLING_ROLES = ['admin', 'owner', 'platform_admin', 'organization_admin'] as const;

export function hasAllAccess(allAccess: boolean | null | undefined) {
  return allAccess === true;
}

export function canManageVenue(role: RoleName, allAccess?: boolean | null) {
  if (hasAllAccess(allAccess)) return true;
  return (
    ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]) ||
    OPERATIONAL_MANAGER_ROLES.includes(role as (typeof OPERATIONAL_MANAGER_ROLES)[number])
  );
}

export function canManageBilling(role: RoleName, allAccess?: boolean | null) {
  if (hasAllAccess(allAccess)) return true;
  return BILLING_ROLES.includes(role as (typeof BILLING_ROLES)[number]);
}
