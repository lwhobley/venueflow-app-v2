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
});
