import { describe, expect, it } from 'vitest';
import { hasAllAccess, canManageVenue, canManageBilling } from './permissions';

describe('hasAllAccess', () => {
  it('returns true when allAccess is true', () => {
    expect(hasAllAccess(true)).toBe(true);
  });

  it('returns false when allAccess is false', () => {
    expect(hasAllAccess(false)).toBe(false);
  });

  it('returns false when allAccess is null', () => {
    expect(hasAllAccess(null)).toBe(false);
  });

  it('returns false when allAccess is undefined', () => {
    expect(hasAllAccess(undefined)).toBe(false);
  });
});

describe('canManageVenue', () => {
  it('returns true for admin role', () => {
    expect(canManageVenue('admin')).toBe(true);
  });

  it('returns true for owner role', () => {
    expect(canManageVenue('owner')).toBe(true);
  });

  it('returns true for manager role', () => {
    expect(canManageVenue('manager')).toBe(true);
  });

  it('returns false for staff role', () => {
    expect(canManageVenue('staff')).toBe(false);
  });

  it('returns false for null role', () => {
    expect(canManageVenue(null)).toBe(false);
  });

  it('returns false for undefined role', () => {
    expect(canManageVenue(undefined)).toBe(false);
  });

  it('returns true for any role when allAccess is true', () => {
    expect(canManageVenue('staff', true)).toBe(true);
  });

  it('returns false for staff role when allAccess is false', () => {
    expect(canManageVenue('staff', false)).toBe(false);
  });

  it('returns false for staff role when allAccess is null', () => {
    expect(canManageVenue('staff', null)).toBe(false);
  });

  // The stadium/enterprise roles the API already treats as managers. Before the
  // client Role union was widened these all fell through as plain staff and were
  // locked out of the manager UI their server-side role grants them.
  it.each([
    'platform_admin',
    'organization_admin',
    'fnb_director',
    'event_manager',
    'outlet_manager',
    'executive_chef',
    'warehouse_manager',
    'premium_manager',
  ])('grants manager access to %s', (role) => {
    expect(canManageVenue(role)).toBe(true);
  });

  it.each(['server', 'finance_viewer', 'auditor', 'concourse_supervisor', 'suite_manager'])(
    'does not grant venue-wide manager access to %s',
    (role) => {
      expect(canManageVenue(role)).toBe(false);
    },
  );
});

describe('canManageBilling', () => {
  it('returns true for admin role', () => {
    expect(canManageBilling('admin')).toBe(true);
  });

  it('returns true for owner role', () => {
    expect(canManageBilling('owner')).toBe(true);
  });

  it('returns false for manager role', () => {
    expect(canManageBilling('manager')).toBe(false);
  });

  it('returns false for staff role', () => {
    expect(canManageBilling('staff')).toBe(false);
  });

  it('returns false for null role', () => {
    expect(canManageBilling(null)).toBe(false);
  });

  it('returns false for undefined role', () => {
    expect(canManageBilling(undefined)).toBe(false);
  });

  it('returns true for any role when allAccess is true', () => {
    expect(canManageBilling('staff', true)).toBe(true);
  });

  it('returns false for manager when allAccess is false', () => {
    expect(canManageBilling('manager', false)).toBe(false);
  });
});

describe('client and API role tables agree', () => {
  // canManageBilling stays an ownership-tier action: an operational manager may
  // run the venue without being able to change its licence.
  it.each(['platform_admin', 'organization_admin'])('grants billing access to %s', (role) => {
    expect(canManageBilling(role)).toBe(true);
  });

  it.each(['fnb_director', 'event_manager', 'outlet_manager'])(
    'withholds billing access from %s',
    (role) => {
      expect(canManageBilling(role)).toBe(false);
    },
  );
});
