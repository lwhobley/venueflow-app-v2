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
        operationalAreaType: 'concession',
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
        operationalAreaType: 'concession',
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
      operationalAreaType: 'concession',
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
      {
        id: 't-suite',
        serviceAreaName: 'Suite 101',
        operationalAreaType: 'suite',
        status: KitchenTicketStatus.waiting,
      },
      {
        id: 't-concession',
        serviceAreaName: 'Concession Stand 104',
        operationalAreaType: 'concession',
        status: KitchenTicketStatus.waiting,
      },
      {
        id: 't-kitchen',
        serviceAreaName: 'Main Galley',
        operationalAreaType: 'kitchen',
        status: KitchenTicketStatus.waiting,
      },
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
      operationalAreaType: 'suite',
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
      operationalAreaType: 'suite',
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

  /**
   * R2-01 regression suite.
   *
   * Authorization used to be derived at read time from free-text fields
   * (serviceAreaName / notes) via deriveTicketOperationalArea(). That is a
   * client-influenced trust boundary: a ticket whose name contains no keyword
   * fell through to a permissive default, and text an operator typed into
   * `notes` could change who was allowed to see the ticket.
   *
   * Authorization now reads the persisted, server-resolved
   * `operationalAreaType` column. These cases all fail under name derivation
   * and pass under column-based authorization.
   */
  describe('R2-01: authorization uses the persisted area, not free text', () => {
    it('hides a neutrally-named concession ticket from Culinary-only staff', async () => {
      const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
      const service = {
        // No keyword anywhere in the name — name derivation would have
        // defaulted this to a permissive area and leaked it.
        listTickets: vi.fn().mockResolvedValue([
          {
            id: 't-neutral',
            serviceAreaName: 'Section 112',
            operationalAreaType: 'concession',
            status: KitchenTicketStatus.waiting,
          },
        ]),
      } as any;

      const controller = new KitchenDistroFulfillmentController(service, prisma);
      const scope = {
        venueId,
        userId: 'u-culinary',
        role: 'concourse_supervisor',
        allAccess: false,
      } as any;

      const visible = await controller.listTickets(scope);
      expect(visible.map((t: any) => t.id)).not.toContain('t-neutral');
    });

    it('shows a BEO-created suite ticket to Suites staff despite a catering-sounding name', async () => {
      const prisma = buildPrismaMock(['suites'], 'concourse_supervisor');
      const service = {
        listTickets: vi.fn().mockResolvedValue([
          {
            id: 't-beo',
            serviceAreaName: 'Catering Order 4471',
            operationalAreaType: 'suite',
            status: KitchenTicketStatus.waiting,
          },
        ]),
      } as any;

      const controller = new KitchenDistroFulfillmentController(service, prisma);
      const scope = {
        venueId,
        userId: 'u-suites',
        role: 'concourse_supervisor',
        allAccess: false,
      } as any;

      const visible = await controller.listTickets(scope);
      expect(visible.map((t: any) => t.id)).toContain('t-beo');
    });

    it('does not let operator-supplied notes change who can see a ticket', async () => {
      const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
      const service = {
        listTickets: vi.fn().mockResolvedValue([
          {
            id: 't-notes',
            serviceAreaName: 'Stand 104',
            // Free text naming another area must be inert for authorization.
            notes: 'Deliver to suite level — culinary kitchen prep',
            operationalAreaType: 'concession',
            status: KitchenTicketStatus.waiting,
          },
        ]),
      } as any;

      const controller = new KitchenDistroFulfillmentController(service, prisma);
      const scope = {
        venueId,
        userId: 'u-culinary',
        role: 'concourse_supervisor',
        allAccess: false,
      } as any;

      const visible = await controller.listTickets(scope);
      expect(visible.map((t: any) => t.id)).not.toContain('t-notes');
    });

    it('forbids mutating a neutrally-named ticket outside the actor department', async () => {
      const prisma = buildPrismaMock(['culinary'], 'concourse_supervisor');
      const service = {
        getTicketById: vi.fn().mockResolvedValue({
          id: 't-neutral',
          serviceAreaName: 'Section 112',
          operationalAreaType: 'concession',
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

      await expect(controller.fireTicket(scope, 't-neutral')).rejects.toThrow(ForbiddenException);
      expect(service.fireTicket).not.toHaveBeenCalled();
    });
  });
});
