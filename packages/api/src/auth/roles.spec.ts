import { describe, expect, it } from 'vitest';
import { canManageVenue } from './roles';

describe('stadium role authorization', () => {
  it.each(['platform_admin', 'organization_admin', 'fnb_director', 'event_manager', 'outlet_manager', 'executive_chef', 'warehouse_manager', 'premium_manager'])('%s can perform venue operations', (role) => {
    expect(canManageVenue(role)).toBe(true);
  });

  it('does not give a finance viewer venue mutation access', () => {
    expect(canManageVenue('finance_viewer')).toBe(false);
  });
});
