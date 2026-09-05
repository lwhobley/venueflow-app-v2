import { describe, expect, it, vi } from 'vitest';
import { EnterpriseSsoAdminController } from './enterprise-sso-admin.controller';

function makeController() {
  const prisma: any = {
    enterpriseSsoGroupRoleMapping: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    organizationMembership: {
      findUniqueOrThrow: vi.fn(),
    },
  };
  const sso: any = {
    assertOrganizationAdministrator: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new EnterpriseSsoAdminController(prisma, sso);
  return { controller, prisma, sso };
}

const user = { sub: 'user-1' } as any;

it('rejects linking an administrator-controlled IdP subject to any existing global account', async () => {
  const { controller, prisma } = makeController();
  prisma.enterpriseSsoProvider = { findUniqueOrThrow: vi.fn().mockResolvedValue({ organizationId: 'attacker-org' }) };
  prisma.user = { findUnique: vi.fn() };
  prisma.enterpriseSsoIdentity = { upsert: vi.fn() };
  await expect(controller.provisionIdentity(user, 'provider-a', { email: 'victim@example.org', subject: 'controlled-subject' })).rejects.toThrow('linking is disabled');
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
  expect(prisma.enterpriseSsoIdentity.upsert).not.toHaveBeenCalled();
});

describe('EnterpriseSsoAdminController.updateGroupRoleMapping', () => {
  it('rejects an update that leaves a platform_admin mapping live when the actor cannot assign that role', async () => {
    const { controller, prisma } = makeController();
    prisma.enterpriseSsoGroupRoleMapping.findUniqueOrThrow.mockResolvedValue({
      id: 'mapping-1',
      organizationId: 'org-1',
      role: 'platform_admin',
    });
    // An organization_admin may not assign or leave live a platform_admin mapping.
    prisma.organizationMembership.findUniqueOrThrow.mockResolvedValue({ role: 'organization_admin' });

    await expect(
      controller.updateGroupRoleMapping(user, 'mapping-1', { externalGroup: 'new-group' } as any),
    ).rejects.toThrow('This administrator may not map an enterprise group to that role.');
    expect(prisma.enterpriseSsoGroupRoleMapping.update).not.toHaveBeenCalled();
  });

  it('allows updating fields on a mapping whose role the actor is permitted to assign', async () => {
    const { controller, prisma } = makeController();
    prisma.enterpriseSsoGroupRoleMapping.findUniqueOrThrow.mockResolvedValue({
      id: 'mapping-1',
      organizationId: 'org-1',
      role: 'manager',
    });
    prisma.organizationMembership.findUniqueOrThrow.mockResolvedValue({ role: 'organization_admin' });
    prisma.enterpriseSsoGroupRoleMapping.update.mockResolvedValue({ id: 'mapping-1' });

    await controller.updateGroupRoleMapping(user, 'mapping-1', { externalGroup: 'new-group' } as any);
    expect(prisma.enterpriseSsoGroupRoleMapping.update).toHaveBeenCalledWith({
      where: { id: 'mapping-1' },
      data: { externalGroup: 'new-group' },
    });
  });

  it('checks the ceiling against a newly supplied role, not the stored one', async () => {
    const { controller, prisma } = makeController();
    prisma.enterpriseSsoGroupRoleMapping.findUniqueOrThrow.mockResolvedValue({
      id: 'mapping-1',
      organizationId: 'org-1',
      role: 'manager',
    });
    prisma.organizationMembership.findUniqueOrThrow.mockResolvedValue({ role: 'organization_admin' });

    await expect(
      controller.updateGroupRoleMapping(user, 'mapping-1', { role: 'platform_admin' } as any),
    ).rejects.toThrow('This administrator may not map an enterprise group to that role.');
    expect(prisma.enterpriseSsoGroupRoleMapping.update).not.toHaveBeenCalled();
  });

  it('rejects postLoginRedirectUri targeting an untrusted external domain', async () => {
    const { controller, prisma } = makeController();
    prisma.enterpriseSsoProvider = { create: vi.fn() };
    await expect(
      controller.createProvider(user, {
        organizationId: 'org-1',
        slug: 'okta-test',
        displayName: 'Okta',
        protocol: 'oidc' as any,
        allowedEmailDomains: ['example.com'],
        postLoginRedirectUri: 'https://attacker.com/steal-token',
      } as any),
    ).rejects.toThrow('SSO post-login redirect origin must match an approved application domain or a registered organization email domain.');
    expect(prisma.enterpriseSsoProvider.create).not.toHaveBeenCalled();
  });

  it('allows postLoginRedirectUri targeting an approved app origin', async () => {
    const { controller, prisma } = makeController();
    prisma.enterpriseSsoProvider = { create: vi.fn().mockResolvedValue({ id: 'p-1' }) };
    await controller.createProvider(user, {
      organizationId: 'org-1',
      slug: 'okta-test',
      displayName: 'Okta',
      protocol: 'oidc' as any,
      allowedEmailDomains: ['example.com'],
      postLoginRedirectUri: 'https://stadiumwrangler.com/auth/callback',
    } as any);
    expect(prisma.enterpriseSsoProvider.create).toHaveBeenCalled();
  });

  it('allows postLoginRedirectUri targeting the organization allowed domain', async () => {
    const { controller, prisma } = makeController();
    prisma.enterpriseSsoProvider = { create: vi.fn().mockResolvedValue({ id: 'p-2' }) };
    await controller.createProvider(user, {
      organizationId: 'org-1',
      slug: 'saml-test',
      displayName: 'SAML',
      protocol: 'saml' as any,
      allowedEmailDomains: ['acmestadium.org'],
      postLoginRedirectUri: 'https://portal.acmestadium.org/sso/callback',
    } as any);
    expect(prisma.enterpriseSsoProvider.create).toHaveBeenCalled();
  });
});
