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

  it('returns true for stadium operational manager roles', () => {
    expect(canManageVenue('event_manager')).toBe(true);
    expect(canManageVenue('outlet_manager')).toBe(true);
    expect(canManageVenue('platform_admin')).toBe(true);
  });

  it('returns false for staff role', () => {
    expect(canManageVenue('staff')).toBe(false);
  });

  it('returns false for viewer-only enterprise roles', () => {
    expect(canManageVenue('finance_viewer')).toBe(false);
    expect(canManageVenue('auditor')).toBe(false);
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
});

describe('canManageBilling', () => {
  it('returns true for admin role', () => {
    expect(canManageBilling('admin')).toBe(true);
  });

  it('returns true for owner role', () => {
    expect(canManageBilling('owner')).toBe(true);
  });

  it('returns true for organization admins', () => {
    expect(canManageBilling('platform_admin')).toBe(true);
    expect(canManageBilling('organization_admin')).toBe(true);
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
