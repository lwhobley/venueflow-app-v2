import { describe, expect, it } from 'vitest';
import { canManageAssignedScope, canManageVenue } from './roles';

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
