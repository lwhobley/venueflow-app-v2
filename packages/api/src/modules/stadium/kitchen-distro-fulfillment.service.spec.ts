import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveTicketOperationalArea,
  KitchenDistroFulfillmentService,
} from './kitchen-distro-fulfillment.service';
import { KitchenTicketPriority, KitchenTicketStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

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
        findUniqueOrThrow: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

  describe('deriveTicketOperationalArea helper (F-01)', () => {
    it('correctly maps various ticket names and BEO contexts to operational areas', () => {
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Stand 104 Hot Dogs' })).toBe('concession');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'East Hawker Station' })).toBe('concession');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Concession Cart B' })).toBe('concession');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Suite 204' })).toBe('suite');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Champions Club Lounge' })).toBe('club');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'VIP Banquet Hall', beoId: 'beo-1' })).toBe('catering');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Executive Catering' })).toBe('catering');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Main Kitchen' })).toBe('culinary');
      expect(deriveTicketOperationalArea({ serviceAreaName: 'Central Distribution Point' })).toBe('distro');
    });
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
        operationalAreaType: 'suite',
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

  it('fires a ticket transitioning waiting -> firing with CAS optimistic lock (F-07)', async () => {
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
    prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.kitchenFulfillmentTicket.findUniqueOrThrow.mockResolvedValue(updatedTicket);
    prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-2' });

    const result = await service.fireTicket('facility-1', 'ticket-1', {
      userId: 'chef-1',
      userName: 'Chef Luigi',
    });

    expect(result.status).toBe(KitchenTicketStatus.firing);
    expect(prisma.kitchenFulfillmentTicket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1', status: KitchenTicketStatus.waiting },
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

  it('throws ConflictException on concurrent status race during fireTicket (F-07)', async () => {
    const initialTicket = {
      id: 'ticket-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.waiting,
      itemName: 'Sliders',
    };

    prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(initialTicket);
    // Simulate concurrent modification where status was changed by another actor
    prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.fireTicket('facility-1', 'ticket-1', {
        userId: 'chef-1',
        userName: 'Chef Luigi',
      }),
    ).rejects.toThrow(ConflictException);
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
    prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.kitchenFulfillmentTicket.findUniqueOrThrow.mockResolvedValue(updatedTicket);
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
    prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.kitchenFulfillmentTicket.findUniqueOrThrow.mockResolvedValue(rewoundTicket);
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
    prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.kitchenFulfillmentTicket.findUniqueOrThrow.mockResolvedValue(pickedUpTicket);
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
  });

  // F-17: Idempotent cancellation
  it('F-17: returns ticket idempotently without creating duplicate history on re-cancel', async () => {
    const cancelledTicket = {
      id: 'ticket-cancelled',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      status: KitchenTicketStatus.cancelled,
      cancelledAt: new Date(),
      cancelReason: 'Order cancelled by guest',
    };

    prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(cancelledTicket);

    const result = await service.cancelTicket(
      'facility-1',
      'ticket-cancelled',
      { reason: 'Duplicate cancel request' },
      { userId: 'mgr-1' },
    );

    expect(result.status).toBe(KitchenTicketStatus.cancelled);
    expect(prisma.kitchenFulfillmentTicket.updateMany).not.toHaveBeenCalled();
    expect(prisma.kitchenFulfillmentStatusHistory.create).not.toHaveBeenCalled();
  });

  // F-09: Reopen ticket workflow
  describe('reopenTicket (F-09)', () => {
    it('reopens a cancelled ticket back to waiting status with audit history and reason', async () => {
      const cancelledTicket = {
        id: 'ticket-cancelled',
        organizationId: 'org-1',
        facilityId: 'facility-1',
        status: KitchenTicketStatus.cancelled,
        zoneId: 'zone-1',
      };
      const reopenedTicket = {
        ...cancelledTicket,
        status: KitchenTicketStatus.waiting,
        cancelledAt: null,
        cancelReason: null,
      };

      prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(cancelledTicket);
      prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 1 });
      prisma.kitchenFulfillmentTicket.findUniqueOrThrow.mockResolvedValue(reopenedTicket);
      prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-reopen' });

      const result = await service.reopenTicket(
        'facility-1',
        'ticket-cancelled',
        { reason: 'Customer changed mind, ticket reinstated' },
        { userId: 'mgr-1', userName: 'Manager Bob' },
      );

      expect(result.status).toBe(KitchenTicketStatus.waiting);
      expect(prisma.kitchenFulfillmentStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: KitchenTicketStatus.cancelled,
            toStatus: KitchenTicketStatus.waiting,
            reason: expect.stringContaining('reinstated'),
          }),
        }),
      );
      expect(wsGateway.broadcastDistroPickupUpdate).toHaveBeenCalledWith(
        'facility-1',
        'zone-1',
        reopenedTicket,
        'distro_pickup_updated',
      );
    });

    it('reopens a picked_up ticket back to ready status', async () => {
      const pickedUpTicket = {
        id: 'ticket-pickedup',
        organizationId: 'org-1',
        facilityId: 'facility-1',
        status: KitchenTicketStatus.picked_up,
        zoneId: 'zone-1',
      };
      const reopenedTicket = {
        ...pickedUpTicket,
        status: KitchenTicketStatus.ready,
        pickedUpAt: null,
        pickedUpByUserId: null,
        pickedUpByName: null,
      };

      prisma.kitchenFulfillmentTicket.findFirst.mockResolvedValue(pickedUpTicket);
      prisma.kitchenFulfillmentTicket.updateMany.mockResolvedValue({ count: 1 });
      prisma.kitchenFulfillmentTicket.findUniqueOrThrow.mockResolvedValue(reopenedTicket);
      prisma.kitchenFulfillmentStatusHistory.create.mockResolvedValue({ id: 'hist-reopen-2' });

      const result = await service.reopenTicket(
        'facility-1',
        'ticket-pickedup',
        { reason: 'Runner dropped item at wrong suite, returned to distro' },
        { userId: 'mgr-1', userName: 'Manager Bob' },
      );

      expect(result.status).toBe(KitchenTicketStatus.ready);
      expect(prisma.kitchenFulfillmentStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromStatus: KitchenTicketStatus.picked_up,
            toStatus: KitchenTicketStatus.ready,
          }),
        }),
      );
    });
  });
});
