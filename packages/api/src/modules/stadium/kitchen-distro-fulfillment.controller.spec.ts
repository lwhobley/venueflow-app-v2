import { describe, expect, it, vi } from 'vitest';
import { KitchenDistroFulfillmentController } from './kitchen-distro-fulfillment.controller';
import { ForbiddenException } from '@nestjs/common';
import { KitchenTicketStatus } from '@prisma/client';

describe('KitchenDistroFulfillmentController (Unit & Security)', () => {
  const venueId = 'venue-1';
  const orgId = 'org-1';

  function buildPrismaMock(userDepartmentCodes: string[], userRole = 'concourse_supervisor') {
    return {
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: venueId, organizationId: orgId }),
      },
      profile: {
        findFirst: vi.fn().mockResolvedValue({ id: 'prof-1', role: userRole, isActive: true }),
      },
      departmentMembership: {
        findMany: vi.fn().mockResolvedValue(
          userDepartmentCodes.map((code) => ({
            department: { code },
          })),
        ),
      },
      userAreaOverride: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      scopeAssignment: {
        findFirst: vi.fn().mockResolvedValue({ id: 'scope-1' }),
      },
    } as any;
  }

  it('F-01: forbids Culinary-only supervisor from viewing a Concession ticket', async () => {
    const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
    const service = {
      getTicketById: vi.fn().mockResolvedValue({
        id: 'ticket-concession-1',
        serviceAreaName: 'Concession Stand 104',
        status: KitchenTicketStatus.waiting,
      }),
    } as any;

    const controller = new KitchenDistroFulfillmentController(service, prisma);
    const scope = {
      venueId,
      userId: 'u-culinary',
      role: 'concourse_supervisor',
      allAccess: false,
    } as any;

    await expect(controller.getTicket(scope, 'ticket-concession-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('F-01: forbids Culinary-only supervisor from firing a Concession ticket', async () => {
    const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
    const service = {
      getTicketById: vi.fn().mockResolvedValue({
        id: 'ticket-concession-1',
        serviceAreaName: 'Hawker Station 12',
        status: KitchenTicketStatus.waiting,
      }),
      fireTicket: vi.fn(),
    } as any;

    const controller = new KitchenDistroFulfillmentController(service, prisma);
    const scope = {
      venueId,
      userId: 'u-culinary',
      role: 'concourse_supervisor',
      allAccess: false,
    } as any;

    await expect(controller.fireTicket(scope, 'ticket-concession-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(service.fireTicket).not.toHaveBeenCalled();
  });

  it('F-01: allows Concessions supervisor to view and fire Concessions tickets', async () => {
    const prisma = buildPrismaMock(['concessions'], 'concourse_supervisor');
    const concessionTicket = {
      id: 'ticket-concession-1',
      serviceAreaName: 'Stand 104',
      status: KitchenTicketStatus.waiting,
    };
    const service = {
      getTicketById: vi.fn().mockResolvedValue(concessionTicket),
      fireTicket: vi.fn().mockResolvedValue({ ...concessionTicket, status: KitchenTicketStatus.firing }),
    } as any;

    const controller = new KitchenDistroFulfillmentController(service, prisma);
    const scope = {
      venueId,
      userId: 'u-concessions',
      role: 'concourse_supervisor',
      allAccess: false,
    } as any;

    const result = await controller.fireTicket(scope, 'ticket-concession-1');
    expect(result.status).toBe(KitchenTicketStatus.firing);
    expect(service.fireTicket).toHaveBeenCalled();
  });

  it('F-01: listTickets filters out Concessions tickets for Culinary-only staff', async () => {
    const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
    const tickets = [
      { id: 't-suite', serviceAreaName: 'Suite 101', status: KitchenTicketStatus.waiting },
      { id: 't-concession', serviceAreaName: 'Concession Stand 104', status: KitchenTicketStatus.waiting },
      { id: 't-kitchen', serviceAreaName: 'Main Galley', status: KitchenTicketStatus.waiting },
    ];
    const service = {
      listTickets: vi.fn().mockResolvedValue(tickets),
    } as any;

    const controller = new KitchenDistroFulfillmentController(service, prisma);
    const scope = {
      venueId,
      userId: 'u-culinary',
      role: 'concourse_supervisor',
      allAccess: false,
    } as any;

    const visible = await controller.listTickets(scope);
    const ids = visible.map((t: any) => t.id);

    expect(ids).toContain('t-suite');
    expect(ids).toContain('t-kitchen');
    expect(ids).not.toContain('t-concession'); // Concession filtered out!
  });

  it('F-11: rejects cancel and reopen when attempted by concourse_supervisor (requires manager rank >= 2)', async () => {
    const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
    const ticket = {
      id: 'ticket-1',
      serviceAreaName: 'Suite 200',
      status: KitchenTicketStatus.waiting,
    };
    const service = {
      getTicketById: vi.fn().mockResolvedValue(ticket),
      cancelTicket: vi.fn(),
      reopenTicket: vi.fn(),
    } as any;

    const controller = new KitchenDistroFulfillmentController(service, prisma);
    const scope = {
      venueId,
      userId: 'u-staff',
      role: 'concourse_supervisor',
      allAccess: false,
    } as any;

    // Concourse supervisor (rank 1) cannot cancel
    await expect(
      controller.cancelTicket(scope, 'ticket-1', { reason: 'Mistake' }),
    ).rejects.toThrow(ForbiddenException);

    // Concourse supervisor cannot reopen
    await expect(
      controller.reopenTicket(scope, 'ticket-1', { reason: 'Customer return' }),
    ).rejects.toThrow(ForbiddenException);

    expect(service.cancelTicket).not.toHaveBeenCalled();
    expect(service.reopenTicket).not.toHaveBeenCalled();
  });

  it('F-11: permits cancel and reopen when actor is an outlet_manager (rank >= 2)', async () => {
    const prisma = buildPrismaMock(['culinary'], 'outlet_manager');
    const ticket = {
      id: 'ticket-1',
      serviceAreaName: 'Suite 200',
      status: KitchenTicketStatus.waiting,
    };
    const service = {
      getTicketById: vi.fn().mockResolvedValue(ticket),
      cancelTicket: vi.fn().mockResolvedValue({ ...ticket, status: KitchenTicketStatus.cancelled }),
      reopenTicket: vi.fn().mockResolvedValue({ ...ticket, status: KitchenTicketStatus.waiting }),
    } as any;

    const controller = new KitchenDistroFulfillmentController(service, prisma);
    const scope = {
      venueId,
      userId: 'u-manager',
      role: 'outlet_manager',
      allAccess: false,
    } as any;

    const cancelled = await controller.cancelTicket(scope, 'ticket-1', { reason: 'Duplicate order' });
    expect(cancelled.status).toBe(KitchenTicketStatus.cancelled);

    const reopened = await controller.reopenTicket(scope, 'ticket-1', { reason: 'Restored order' });
    expect(reopened.status).toBe(KitchenTicketStatus.waiting);
  });
});
