import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canManageAssignedScope, canManageRole, canManageVenue, isOwnerOrAdminRole, ROLE_RANK } from './roles';

describe('stadium role authorization', () => {
  it.each(['platform_admin', 'organization_admin', 'fnb_director', 'event_manager', 'outlet_manager', 'executive_chef', 'warehouse_manager', 'premium_manager'])('%s can perform venue operations', (role) => {
    expect(canManageVenue(role)).toBe(true);
  });

  it.each(['concourse_supervisor', 'suite_manager'])('%s can manage only its assigned operational scope', (role) => {
    expect(canManageAssignedScope(role)).toBe(true);
    expect(canManageVenue(role)).toBe(false);
  });

  it('keeps the auditor role read-only', () => {
    expect(canManageVenue('auditor')).toBe(false);
  });

  it('does not give a finance viewer venue mutation access', () => {
    expect(canManageVenue('finance_viewer')).toBe(false);
  });
});

describe('ROLE_RANK drift guard', () => {
  it('ranks every role in the Prisma Role enum', () => {
    // Regression check: platform_admin, organization_admin, and every other
    // enterprise/stadium role shipped without a rank here, so canManageRole
    // silently failed closed for them — a platform_admin could not re-role or
    // remove staff. Fails loudly if a new Role enum member ships without a
    // rank, instead of relying on someone remembering to add one.
    const schemaPath = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
    const schema = readFileSync(schemaPath, 'utf8');
    const enumBlock = /^enum Role \{([\s\S]*?)^\}/m.exec(schema);
    expect(enumBlock).not.toBeNull();
    const roles = enumBlock![1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(roles.length).toBeGreaterThan(10); // sanity: the parser actually found roles
    expect([...roles].sort()).toEqual([...Object.keys(ROLE_RANK)].sort());
  });
});

describe('canManageRole', () => {
  it('lets a platform_admin re-role or remove staff, unlike before this rank existed', () => {
    expect(canManageRole('platform_admin', 'manager')).toBe(true);
    expect(canManageRole('platform_admin', 'platform_admin')).toBe(true);
  });

  it('lets an organization_admin manage venue managers and other organization_admins', () => {
    expect(canManageRole('organization_admin', 'suite_manager')).toBe(true);
    expect(canManageRole('organization_admin', 'organization_admin')).toBe(true);
  });

  it('does not let a department manager manage another department manager', () => {
    expect(canManageRole('event_manager', 'outlet_manager')).toBe(false);
    expect(canManageRole('event_manager', 'staff')).toBe(true);
  });

  it('never lets an actor manage a higher-ranked role', () => {
    expect(canManageRole('manager', 'admin')).toBe(false);
    expect(canManageRole('finance_viewer', 'manager')).toBe(false);
  });

  it('allAccess overrides rank entirely', () => {
    expect(canManageRole('staff', 'admin', true)).toBe(true);
  });
});

describe('isOwnerOrAdminRole', () => {
  it.each(['owner', 'admin', 'platform_admin', 'organization_admin'])('%s is recognized as owner or admin', (role) => {
    expect(isOwnerOrAdminRole(role)).toBe(true);
  });

  it.each(['manager', 'server', 'staff', 'fnb_director', 'concourse_supervisor'])('%s is not recognized as owner or admin', (role) => {
    expect(isOwnerOrAdminRole(role)).toBe(false);
  });
});
