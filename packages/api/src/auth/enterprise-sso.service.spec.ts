import { describe, expect, it, vi } from 'vitest';
import { EnterpriseSsoService } from './enterprise-sso.service';

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    organizationId: 'org-1',
    slug: 'azure-ad',
    protocol: 'oidc',
    status: 'active',
    defaultFacilityId: 'facility-1',
    jitProvisioningEnabled: false,
    allowedEmailDomains: ['stadium.example'],
    groupClaim: 'groups',
    groupRoleMappings: [
      { id: 'map-supervisor', externalGroup: 'Concourse Supervisors', role: 'concourse_supervisor', facilityId: 'facility-1', zoneId: 'zone-north', priority: 20, active: true },
      { id: 'map-auditor', externalGroup: 'Auditors', role: 'auditor', facilityId: 'facility-1', zoneId: null, priority: 10, active: true },
    ],
    organization: { code: 'stadium-org' },
    ...overrides,
  } as any;
}

function service(prisma: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  return new EnterpriseSsoService(prisma as any, { get: vi.fn((key: string) => config[key]) } as any);
}

describe('EnterpriseSsoService group mapping', () => {
  it('maps an Azure/Okta group to the highest-priority granular role and scope', () => {
    const result = (service() as any).resolveMapping(provider(), ['auditors', 'CONCOURSE SUPERVISORS']);
    expect(result).toMatchObject({ id: 'map-supervisor', role: 'concourse_supervisor', facilityId: 'facility-1', zoneId: 'zone-north' });
  });

  it('rejects ambiguous top-priority group assignments instead of silently escalating access', () => {
    const sso = service() as any;
    const configured = provider({
      groupRoleMappings: [
        { id: 'one', externalGroup: 'one', role: 'suite_manager', facilityId: 'facility-1', zoneId: null, priority: 10 },
        { id: 'two', externalGroup: 'two', role: 'auditor', facilityId: 'facility-1', zoneId: null, priority: 10 },
      ],
    });
    expect(() => sso.resolveMapping(configured, ['one', 'two'])).toThrow('ambiguous');
  });

  it('requires an explicitly allowed enterprise email domain', () => {
    const sso = service() as any;
    expect(sso.isAllowedEmail(provider(), 'user@stadium.example')).toBe(true);
    expect(sso.isAllowedEmail(provider(), 'user@other.example')).toBe(false);
  });
});

describe('EnterpriseSsoService login tickets', () => {
  it('consumes a ticket once and returns the bound user/profile', async () => {
    const prisma = {
      enterpriseSsoLoginTicket: {
        findUnique: vi.fn().mockResolvedValue({ id: 'ticket-1', userId: 'user-1', profileId: 'profile-1', expiresAt: new Date(Date.now() + 60_000), consumedAt: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      profile: { findFirst: vi.fn().mockResolvedValue({ id: 'profile-1', userId: 'user-1', membershipStatus: 'active', venue: { id: 'facility-1', name: 'Main Stadium' } }) },
    };
    const result = await service(prisma).consumeLoginTicket('a'.repeat(43));
    expect(result.userId).toBe('user-1');
    expect(prisma.enterpriseSsoLoginTicket.updateMany).toHaveBeenCalledOnce();
  });

  it('rejects a previously consumed ticket', async () => {
    const prisma = { enterpriseSsoLoginTicket: { findUnique: vi.fn().mockResolvedValue({ id: 'ticket-1', consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }) } };
    await expect(service(prisma).consumeLoginTicket('a'.repeat(43))).rejects.toThrow('invalid or expired');
  });
});
