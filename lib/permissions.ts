type RoleName = string | null | undefined;

export function hasAllAccess(allAccess: boolean | null | undefined) {
  return allAccess === true;
}

const VENUE_ADMIN_ROLES = new Set([
  'admin',
  'owner',
  'manager',
  'platform_admin',
  'organization_admin',
  'fnb_director',
]);

const VENUE_MANAGER_ROLES = new Set([
  ...VENUE_ADMIN_ROLES,
  'event_manager',
  'outlet_manager',
  'executive_chef',
  'warehouse_manager',
  'premium_manager',
]);

const BILLING_ROLES = new Set(['admin', 'owner', 'platform_admin', 'organization_admin']);

export function canManageVenue(role: RoleName, allAccess?: boolean | null) {
  return hasAllAccess(allAccess) || VENUE_MANAGER_ROLES.has(role ?? '');
}

export function canManageBilling(role: RoleName, allAccess?: boolean | null) {
  return hasAllAccess(allAccess) || BILLING_ROLES.has(role ?? '');
}
