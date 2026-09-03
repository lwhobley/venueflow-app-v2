import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KitchenDistroFulfillmentService } from './kitchen-distro-fulfillment.service';
import { KitchenTicketPriority, KitchenTicketStatus } from '@prisma/client';

describe('KitchenDistroFulfillmentService', () => {
  let service: KitchenDistroFulfillmentService;
  let prisma: any;
  let wsGateway: any;
  let notifications: any;

  beforeEach(() => {
    prisma = {
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ organizationId: 'org-1' }),
      },
      kitchenFulfillmentTicket: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      kitchenFulfillmentStatusHistory: {
        create: vi.fn(),
      },
      suiteBeoOrder: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };

    wsGateway = {
      broadcastDistroPickupUpdate: vi.fn().mockResolvedValue(undefined),
    };

    notifications = {
      notifyStaff: vi.fn().mockResolvedValue(undefined),
    };

    service = new KitchenDistroFulfillmentService(prisma, wsGateway, notifications);
  });

  it('creates a new ticket in waiting status and broadcasts update', async () => {
    const mockTicket = {
      id: 'ticket-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      serviceAreaName: 'Suite 204',
      kitchenId: 'kitchen-main',
      kitchenName: 'Main Galley',
      itemName: 'Braised Short Ribs',
      quantity: 4,
      status: KitchenTicketStatus.waiting,
      priority: KitchenTicketPriority.normal,
      createdAt: new Date(),
    };

    prisma.kitchenFulfillmentTicket.create.mockResolvedValue(mockTicket);
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-1' });

    const result = await service.createTicket(
      'facility-1',
      {
        serviceAreaName: 'Suite 204',
        kitchenId: 'kitchen-main',
        kitchenName: 'Main Galley',
        itemName: 'Braised Short Ribs',
        quantity: 4,
      },
      { userId: 'user-1', userName: 'Chef Mario' },
    );

    expect(result.id).toBe('ticket-1');
    expect(result.status).toBe(KitchenTicketStatus.waiting);
    expect(prisma.kitchenFulfillmentTicket.create).toHaveBeenCalled();
    expect(prisma.kitchenFulfillmentStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toStatus: KitchenTicketStatus.waiting,
          reason: 'Initial ticket creation',
        }),
      }),
    );
    expect(wsGateway.broadcastDistroPickupUpdate).toHaveBeenCalledWith(
      'facility-1',
      '',
      mockTicket,
      'distro_pickup_updated',
    );
  });

  it('fires a ticket transitioning waiting -> firing', async () => {
    const initialTicket = {
      id: 'ticket-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.waiting,
      itemName: 'Sliders',
      zoneId: 'zone-east',
    };
    const updatedTicket = {
      ...initialTicket,
      status: KitchenTicketStatus.firing,
      firedAt: new Date(),
    };

    prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(initialTicket);
    prisma.kitchenFulfillmentTicket.update.mockResolvedValue(updatedTicket);
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-2' });

    const result = await service.fireTicket('facility-1', 'ticket-1', {
      userId: 'chef-1',
      userName: 'Chef Luigi',
    });

    expect(result.status).toBe(KitchenTicketStatus.firing);
    expect(prisma.kitchenFulfillmentTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1' },
        data: expect.objectContaining({ status: KitchenTicketStatus.firing }),
      }),
    );
    expect(wsGateway.broadcastDistroPickupUpdate).toHaveBeenCalledWith(
      'facility-1',
      'zone-east',
      updatedTicket,
      'distro_pickup_updated',
    );
  });

  it('marks a ticket ready at Distro station and broadcasts distro_pickup_ready', async () => {
    const initialTicket = {
      id: 'ticket-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.firing,
      itemName: 'Artisan Flatbread',
      zoneId: 'zone-suites',
      serviceAreaName: 'Suite 101',
      kitchenName: 'Gourmet Kitchen',
      quantity: 2,
    };
    const updatedTicket = {
      ...initialTicket,
      status: KitchenTicketStatus.ready,
      readyAt: new Date(),
      distroLocationId: 'distro-station-b',
      distroLocationName: 'Distro Station B',
    };

    prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(initialTicket);
    prisma.kitchenFulfillmentTicket.update.mockResolvedValue(updatedTicket);
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-3' });

    const result = await service.markReady(
      'facility-1',
      'ticket-1',
      { distroLocationId: 'distro-station-b', distroLocationName: 'Distro Station B' },
      { userId: 'chef-1', userName: 'Chef Luigi' },
    );

    expect(result.status).toBe(KitchenTicketStatus.ready);
    expect(result.distroLocationName).toBe('Distro Station B');
    expect(wsGateway.broadcastDistroPickupUpdate).toHaveBeenCalledWith(
      'facility-1',
      'zone-suites',
      updatedTicket,
      'distro_pickup_ready',
    );
    expect(notifications.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: 'facility-1',
        kind: 'distro_pickup_ready',
      }),
    );
  });

  it('rewinds a ready ticket back to firing for culinary corrections', async () => {
    const readyTicket = {
      id: 'ticket-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.ready,
      readyAt: new Date(),
      itemName: 'Steak Tartare',
      zoneId: 'zone-suites',
    };
    const rewoundTicket = {
      ...readyTicket,
      status: KitchenTicketStatus.firing,
      readyAt: null,
      firedAt: new Date(),
    };

    prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(readyTicket);
    prisma.kitchenFulfillmentTicket.update.mockResolvedValue(rewoundTicket);
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-4' });

    const result = await service.rewindToFiring(
      'facility-1',
      'ticket-1',
      { reason: 'Plate garnish correction requested by chef' },
      { userId: 'chef-1', userName: 'Sous Chef Peach' },
    );

    expect(result.status).toBe(KitchenTicketStatus.firing);
    expect(result.readyAt).toBeNull();
    expect(prisma.kitchenFulfillmentStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: KitchenTicketStatus.ready,
          toStatus: KitchenTicketStatus.firing,
          reason: expect.stringContaining('garnish correction'),
        }),
      }),
    );
  });

  it('reconciles tickets in ready status > 10 minutes to overdue_pickup with wasOverdue=true', async () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    const overdueCandidate = {
      id: 'ticket-overdue-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.ready,
      readyAt: elevenMinutesAgo,
      itemName: 'Truffle Fries',
      quantity: 3,
      serviceAreaName: 'Concession 108',
      kitchenName: 'Fry Station 1',
      zoneId: 'zone-concourse',
    };

    prisma.kitchenFulfillmentTicket.findMany.mockResolvedValue([overdueCandidate]);
    prisma.kitchenFulfillmentTicket.update.mockResolvedValue({
      ...overdueCandidate,
      status: KitchenTicketStatus.overdue_pickup,
      wasOverdue: true,
      overdueAt: new Date(),
    });
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-5' });

    const transitionedCount = await service.reconcileOverdueTickets('facility-1');

    expect(transitionedCount).toBe(1);
    expect(prisma.kitchenFulfillmentTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-overdue-1' },
        data: expect.objectContaining({
          status: KitchenTicketStatus.overdue_pickup,
          wasOverdue: true,
        }),
      }),
    );
    expect(wsGateway.broadcastDistroPickupUpdate).toHaveBeenCalledWith(
      'facility-1',
      'zone-concourse',
      expect.objectContaining({
        id: 'ticket-overdue-1',
        status: KitchenTicketStatus.overdue_pickup,
        wasOverdue: true,
      }),
      'distro_pickup_overdue',
    );
  });

  it('marks a ticket picked up, records runner name, and preserves wasOverdue audit flag', async () => {
    const overdueTicket = {
      id: 'ticket-2',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.overdue_pickup,
      wasOverdue: true,
      readyAt: new Date(Date.now() - 15 * 60 * 1000),
      zoneId: 'zone-1',
    };
    const pickedUpTicket = {
      ...overdueTicket,
      status: KitchenTicketStatus.picked_up,
      pickedUpAt: new Date(),
      pickedUpByName: 'Runner Dave',
      wasOverdue: true,
    };

    prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(overdueTicket);
    prisma.kitchenFulfillmentTicket.update.mockResolvedValue(pickedUpTicket);
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-6' });

    const result = await service.markPickedUp(
      'facility-1',
      'ticket-2',
      { runnerName: 'Runner Dave' },
      { userId: 'runner-1', userName: 'Dave R.' },
    );

    expect(result.status).toBe(KitchenTicketStatus.picked_up);
    expect(result.wasOverdue).toBe(true);
    expect(result.pickedUpByName).toBe('Runner Dave');
    expect(prisma.kitchenFulfillmentTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-2' },
        data: expect.objectContaining({
          status: KitchenTicketStatus.picked_up,
          wasOverdue: true,
          pickedUpByName: 'Runner Dave',
        }),
      }),
    );
  });
});
