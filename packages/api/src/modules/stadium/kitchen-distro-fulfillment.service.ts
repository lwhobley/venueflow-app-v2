import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KitchenTicketPriority, KitchenTicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyTenantSessionSettings } from '../../prisma/tenant-transaction';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { NotificationsService } from '../../notifications/notifications.service';

export const DISTRO_OVERDUE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface DistroActor {
  userId?: string;
  userName?: string;
  role?: string;
}

export interface CreateKitchenTicketDto {
  organizationId?: string;
  facilityId?: string;
  eventId?: string;
  beoId?: string;
  zoneId?: string;
  serviceAreaId?: string;
  serviceAreaName: string;
  kitchenId: string;
  kitchenName: string;
  distroLocationId?: string;
  distroLocationName?: string;
  itemName: string;
  itemDescription?: string;
  quantity?: number;
  unitOfMeasure?: string;
  priority?: KitchenTicketPriority;
  notes?: string;
}

export interface CreateTicketsFromBeoDto {
  kitchenId: string;
  kitchenName: string;
  distroLocationId?: string;
  distroLocationName?: string;
  lineItemCodes?: string[];
  notes?: string;
}

export interface MarkReadyDto {
  distroLocationId?: string;
  distroLocationName?: string;
  notes?: string;
}

export interface RewindFireDto {
  reason: string;
  notes?: string;
}

export interface MarkPickedUpDto {
  runnerName?: string;
  notes?: string;
}

export interface CancelTicketDto {
  reason: string;
  notes?: string;
}

export interface ListDistroTicketsQuery {
  kitchenId?: string;
  serviceAreaId?: string;
  zoneId?: string;
  beoId?: string;
  eventId?: string;
  status?: KitchenTicketStatus | 'active'; // 'active' = waiting, firing, ready, overdue_pickup
}

@Injectable()
export class KitchenDistroFulfillmentService {
  private readonly logger = new Logger(KitchenDistroFulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: SuiteHospitalityGateway,
    private readonly notifications?: NotificationsService,
  ) {}

  private async organizationIdFor(facilityId: string): Promise<string> {
    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: facilityId },
      select: { organizationId: true },
    });
    return venue.organizationId;
  }

  /**
   * Evaluates server-side timestamp for any tickets in `ready` status that exceeded 10 minutes.
   * Reconciles them to `overdue_pickup`, marks `wasOverdue = true`, writes audit logs,
   * and broadcasts urgent notification events.
   */
  async reconcileOverdueTickets(facilityId?: string): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - DISTRO_OVERDUE_THRESHOLD_MS);

    const candidates = await this.prisma.kitchenFulfillmentTicket.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        status: KitchenTicketStatus.ready,
        readyAt: { lte: cutoff },
      },
      include: {
        history: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });

    if (candidates.length === 0) return 0;

    let transitionedCount = 0;
    for (const ticket of candidates) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await applyTenantSessionSettings(tx, {
            organizationId: ticket.organizationId,
            facilityId: ticket.facilityId,
            venueId: ticket.facilityId,
          });

          await tx.kitchenFulfillmentTicket.update({
            where: { id: ticket.id },
            data: {
              status: KitchenTicketStatus.overdue_pickup,
              overdueAt: now,
              wasOverdue: true,
            },
          });

          await tx.kitchenFulfillmentStatusHistory.create({
            data: {
              organizationId: ticket.organizationId,
              facilityId: ticket.facilityId,
              ticketId: ticket.id,
              fromStatus: KitchenTicketStatus.ready,
              toStatus: KitchenTicketStatus.overdue_pickup,
              reason: 'Exceeded 10-minute distro pickup window',
              notes: `Ready at ${ticket.readyAt?.toISOString()}, marked overdue at ${now.toISOString()}`,
              timestamp: now,
            },
          });
        });

        transitionedCount++;

        // Broadcast urgent overdue alert to service area and kitchen
        await this.gateway.broadcastDistroPickupUpdate(
          ticket.facilityId,
          ticket.zoneId || '',
          {
            id: ticket.id,
            itemName: ticket.itemName,
            quantity: ticket.quantity,
            serviceAreaName: ticket.serviceAreaName,
            kitchenName: ticket.kitchenName,
            status: KitchenTicketStatus.overdue_pickup,
            wasOverdue: true,
            overdueAt: now.toISOString(),
          },
          'distro_pickup_overdue',
        );

        this.logger.warn(
          `Ticket ${ticket.id} (${ticket.itemName} for ${ticket.serviceAreaName}) transitioned to overdue_pickup. Ready for >10m.`,
        );
      } catch (err) {
        this.logger.error(`Failed reconciling overdue ticket ${ticket.id}: ${(err as Error).message}`);
      }
    }

    return transitionedCount;
  }

  /**
   * Cron job running every minute to catch overdue tickets venue-wide.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handlePeriodicOverdueSweep(): Promise<void> {
    try {
      const count = await this.reconcileOverdueTickets();
      if (count > 0) {
        this.logger.log(`Periodic overdue sweep transitioned ${count} tickets to overdue_pickup.`);
      }
    } catch (err) {
      this.logger.error(`Periodic overdue sweep error: ${(err as Error).message}`);
    }
  }

  /**
   * List fulfillment tickets for a facility, automatically reconciling any expired ready items.
   */
  async listTickets(facilityId: string, query: ListDistroTicketsQuery = {}) {
    // Reconcile any in-flight ready tickets > 10m for this facility first
    await this.reconcileOverdueTickets(facilityId);

    const whereClause: any = { facilityId };
    if (query.kitchenId) whereClause.kitchenId = query.kitchenId;
    if (query.serviceAreaId) whereClause.serviceAreaId = query.serviceAreaId;
    if (query.zoneId) whereClause.zoneId = query.zoneId;
    if (query.beoId) whereClause.beoId = query.beoId;
    if (query.eventId) whereClause.eventId = query.eventId;

    if (query.status === 'active') {
      whereClause.status = {
        in: [
          KitchenTicketStatus.waiting,
          KitchenTicketStatus.firing,
          KitchenTicketStatus.ready,
          KitchenTicketStatus.overdue_pickup,
        ],
      };
    } else if (query.status) {
      whereClause.status = query.status;
    }

    const tickets = await this.prisma.kitchenFulfillmentTicket.findMany({
      where: whereClause,
      include: {
        history: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
      orderBy: [
        { priority: 'desc' },
        { requestedAt: 'asc' },
      ],
    });

    const now = Date.now();
    return tickets.map((ticket) => {
      let elapsedReadySeconds = 0;
      let overdueSeconds = 0;
      let isOverdue = ticket.status === KitchenTicketStatus.overdue_pickup;

      if (ticket.readyAt) {
        const readyTime = new Date(ticket.readyAt).getTime();
        const endTime = ticket.pickedUpAt ? new Date(ticket.pickedUpAt).getTime() : now;
        elapsedReadySeconds = Math.max(0, Math.floor((endTime - readyTime) / 1000));

        if (elapsedReadySeconds > 600) {
          isOverdue = true;
          overdueSeconds = elapsedReadySeconds - 600;
        }
      }

      return {
        ...ticket,
        elapsedReadySeconds,
        overdueSeconds,
        isOverdue,
      };
    });
  }

  /**
   * Fetch single ticket by ID
   */
  async getTicketById(facilityId: string, ticketId: string) {
    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
      include: {
        history: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    const now = Date.now();
    let elapsedReadySeconds = 0;
    let overdueSeconds = 0;
    let isOverdue = ticket.status === KitchenTicketStatus.overdue_pickup;

    if (ticket.readyAt) {
      const readyTime = new Date(ticket.readyAt).getTime();
      const endTime = ticket.pickedUpAt ? new Date(ticket.pickedUpAt).getTime() : now;
      elapsedReadySeconds = Math.max(0, Math.floor((endTime - readyTime) / 1000));

      if (elapsedReadySeconds > 600) {
        isOverdue = true;
        overdueSeconds = elapsedReadySeconds - 600;
      }
    }

    return {
      ...ticket,
      elapsedReadySeconds,
      overdueSeconds,
      isOverdue,
    };
  }

  /**
   * Create a single fulfillment ticket.
   */
  async createTicket(facilityId: string, dto: CreateKitchenTicketDto, actor: DistroActor = {}) {
    const organizationId = dto.organizationId ?? (await this.organizationIdFor(facilityId));

    const ticket = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, { organizationId, facilityId, venueId: facilityId });

      const created = await tx.kitchenFulfillmentTicket.create({
        data: {
          organizationId,
          facilityId,
          eventId: dto.eventId ?? null,
          beoId: dto.beoId ?? null,
          zoneId: dto.zoneId ?? null,
          serviceAreaId: dto.serviceAreaId ?? null,
          serviceAreaName: dto.serviceAreaName,
          kitchenId: dto.kitchenId,
          kitchenName: dto.kitchenName,
          distroLocationId: dto.distroLocationId ?? null,
          distroLocationName: dto.distroLocationName ?? null,
          requestedByUserId: actor.userId ?? null,
          status: KitchenTicketStatus.waiting,
          priority: dto.priority ?? KitchenTicketPriority.normal,
          itemName: dto.itemName,
          itemDescription: dto.itemDescription ?? null,
          quantity: dto.quantity ?? 1,
          unitOfMeasure: dto.unitOfMeasure ?? null,
          notes: dto.notes ?? null,
        },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId,
          facilityId,
          ticketId: created.id,
          fromStatus: null,
          toStatus: KitchenTicketStatus.waiting,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: 'Initial ticket creation',
          notes: dto.notes ?? null,
        },
      });

      return created;
    });

    await this.gateway.broadcastDistroPickupUpdate(
      facilityId,
      ticket.zoneId || '',
      ticket,
      'distro_pickup_updated',
    );

    return ticket;
  }

  /**
   * Generate fulfillment tickets directly from a BEO order's catering line items.
   */
  async createTicketsFromBeo(
    facilityId: string,
    beoId: string,
    dto: CreateTicketsFromBeoDto,
    actor: DistroActor = {},
  ) {
    const organizationId = await this.organizationIdFor(facilityId);

    const beo = await this.prisma.suiteBeoOrder.findFirst({
      where: { id: beoId, facilityId },
      include: {
        subVenue: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
      },
    });

    if (!beo) throw new NotFoundException('Suite BEO order not found.');

    const lineItems = (beo.cateringLineItems as Array<{ code: string; name: string; quantity: number; category?: string }>) || [];
    const itemsToCreate = dto.lineItemCodes && dto.lineItemCodes.length > 0
      ? lineItems.filter((i) => dto.lineItemCodes?.includes(i.code))
      : lineItems;

    if (itemsToCreate.length === 0) {
      throw new BadRequestException('No eligible catering line items found to create tickets.');
    }

    const createdTickets = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, { organizationId, facilityId, venueId: facilityId });

      const results = [];
      for (const item of itemsToCreate) {
        const ticket = await tx.kitchenFulfillmentTicket.create({
          data: {
            organizationId,
            facilityId,
            eventId: beo.eventId,
            beoId: beo.id,
            zoneId: beo.zoneId,
            serviceAreaId: beo.subVenueId,
            serviceAreaName: beo.subVenue?.name || `Suite ${beo.beoNumber}`,
            kitchenId: dto.kitchenId,
            kitchenName: dto.kitchenName,
            distroLocationId: dto.distroLocationId ?? null,
            distroLocationName: dto.distroLocationName ?? null,
            requestedByUserId: actor.userId ?? null,
            status: KitchenTicketStatus.waiting,
            priority: KitchenTicketPriority.normal,
            itemName: item.name,
            itemDescription: `Category: ${item.category || 'Food'} | BEO #${beo.beoNumber}`,
            quantity: item.quantity,
            notes: dto.notes ?? beo.specialInstructions ?? null,
          },
        });

        await tx.kitchenFulfillmentStatusHistory.create({
          data: {
            organizationId,
            facilityId,
            ticketId: ticket.id,
            fromStatus: null,
            toStatus: KitchenTicketStatus.waiting,
            actorId: actor.userId ?? null,
            actorName: actor.userName ?? null,
            reason: `Created from BEO #${beo.beoNumber}`,
          },
        });

        results.push(ticket);
      }
      return results;
    });

    for (const ticket of createdTickets) {
      await this.gateway.broadcastDistroPickupUpdate(
        facilityId,
        ticket.zoneId || '',
        ticket,
        'distro_pickup_updated',
      );
    }

    return createdTickets;
  }

  /**
   * Kitchen action: transition waiting -> firing
   */
  async fireTicket(facilityId: string, ticketId: string, actor: DistroActor = {}) {
    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    if (ticket.status === KitchenTicketStatus.firing) {
      return ticket; // Idempotent
    }
    if (ticket.status === KitchenTicketStatus.picked_up || ticket.status === KitchenTicketStatus.cancelled) {
      throw new BadRequestException(`Cannot fire a ticket that is already ${ticket.status}.`);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: ticket.organizationId,
        facilityId,
        venueId: facilityId,
      });

      const res = await tx.kitchenFulfillmentTicket.update({
        where: { id: ticket.id },
        data: {
          status: KitchenTicketStatus.firing,
          firedAt: now,
        },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId: ticket.organizationId,
          facilityId,
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: KitchenTicketStatus.firing,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: 'Kitchen started preparation',
          timestamp: now,
        },
      });

      return res;
    });

    await this.gateway.broadcastDistroPickupUpdate(
      facilityId,
      updated.zoneId || '',
      updated,
      'distro_pickup_updated',
    );

    return updated;
  }

  /**
   * Kitchen action: transition firing/waiting -> ready at Distro
   */
  async markReady(
    facilityId: string,
    ticketId: string,
    dto: MarkReadyDto = {},
    actor: DistroActor = {},
  ) {
    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    if (ticket.status === KitchenTicketStatus.picked_up || ticket.status === KitchenTicketStatus.cancelled) {
      throw new BadRequestException(`Cannot mark ready a ticket that is already ${ticket.status}.`);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: ticket.organizationId,
        facilityId,
        venueId: facilityId,
      });

      const res = await tx.kitchenFulfillmentTicket.update({
        where: { id: ticket.id },
        data: {
          status: KitchenTicketStatus.ready,
          readyAt: now,
          distroLocationId: dto.distroLocationId ?? ticket.distroLocationId,
          distroLocationName: dto.distroLocationName ?? ticket.distroLocationName,
        },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId: ticket.organizationId,
          facilityId,
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: KitchenTicketStatus.ready,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: 'Kitchen completed item, staged at Distro for pickup',
          notes: dto.notes ?? null,
          timestamp: now,
        },
      });

      return res;
    });

    // Broadcast both ready event and generic updated event
    await this.gateway.broadcastDistroPickupUpdate(
      facilityId,
      updated.zoneId || '',
      updated,
      'distro_pickup_ready',
    );

    // Also trigger mobile push notification to managers / attendants
    if (this.notifications) {
      this.notifications
        .notifyStaff({
          venueId: facilityId,
          kind: 'distro_pickup_ready',
          title: `Item Ready at Distro: ${updated.itemName}`,
          body: `${updated.quantity}x ${updated.itemName} ready for ${updated.serviceAreaName} at ${updated.distroLocationName || 'Distro Station'}.`,
        })
        .catch((e) => this.logger.warn(`Push notification failed: ${e.message}`));
    }

    return updated;
  }

  /**
   * Kitchen action: rewind from ready/overdue back to firing if culinary correction is required.
   */
  async rewindToFiring(
    facilityId: string,
    ticketId: string,
    dto: RewindFireDto,
    actor: DistroActor = {},
  ) {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('A reason must be provided when rewinding an item back to firing.');
    }

    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    if (ticket.status !== KitchenTicketStatus.ready && ticket.status !== KitchenTicketStatus.overdue_pickup) {
      throw new BadRequestException(`Only ready or overdue items can be rewound to firing (current: ${ticket.status}).`);
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: ticket.organizationId,
        facilityId,
        venueId: facilityId,
      });

      const res = await tx.kitchenFulfillmentTicket.update({
        where: { id: ticket.id },
        data: {
          status: KitchenTicketStatus.firing,
          readyAt: null,
          overdueAt: null,
          firedAt: now,
        },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId: ticket.organizationId,
          facilityId,
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: KitchenTicketStatus.firing,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: `Rewound to firing: ${dto.reason}`,
          notes: dto.notes ?? null,
          timestamp: now,
        },
      });

      return res;
    });

    await this.gateway.broadcastDistroPickupUpdate(
      facilityId,
      updated.zoneId || '',
      updated,
      'distro_pickup_updated',
    );

    return updated;
  }

  /**
   * Distro / Runner action: mark picked up at Distro.
   * Accurately checks and preserves if the item was overdue.
   */
  async markPickedUp(
    facilityId: string,
    ticketId: string,
    dto: MarkPickedUpDto = {},
    actor: DistroActor = {},
  ) {
    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    if (ticket.status === KitchenTicketStatus.picked_up) {
      return ticket; // Idempotent
    }
    if (ticket.status === KitchenTicketStatus.cancelled) {
      throw new BadRequestException('Cannot pick up a cancelled ticket.');
    }

    const now = new Date();
    const wasOverdue =
      ticket.wasOverdue ||
      ticket.status === KitchenTicketStatus.overdue_pickup ||
      (ticket.readyAt ? now.getTime() - new Date(ticket.readyAt).getTime() > DISTRO_OVERDUE_THRESHOLD_MS : false);

    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: ticket.organizationId,
        facilityId,
        venueId: facilityId,
      });

      const res = await tx.kitchenFulfillmentTicket.update({
        where: { id: ticket.id },
        data: {
          status: KitchenTicketStatus.picked_up,
          pickedUpAt: now,
          pickedUpByUserId: actor.userId ?? null,
          pickedUpByName: dto.runnerName || actor.userName || 'Service Area Runner',
          wasOverdue,
        },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId: ticket.organizationId,
          facilityId,
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: KitchenTicketStatus.picked_up,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: wasOverdue
            ? 'Picked up from Distro (Was Overdue)'
            : 'Picked up from Distro within target window',
          notes: dto.notes ?? (dto.runnerName ? `Runner: ${dto.runnerName}` : null),
          timestamp: now,
        },
      });

      return res;
    });

    await this.gateway.broadcastDistroPickupUpdate(
      facilityId,
      updated.zoneId || '',
      updated,
      'distro_pickup_updated',
    );

    return updated;
  }

  /**
   * Cancel ticket before pickup.
   */
  async cancelTicket(
    facilityId: string,
    ticketId: string,
    dto: CancelTicketDto,
    actor: DistroActor = {},
  ) {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('A reason must be provided when cancelling a fulfillment ticket.');
    }

    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    if (ticket.status === KitchenTicketStatus.picked_up) {
      throw new BadRequestException('Cannot cancel a ticket that has already been picked up.');
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: ticket.organizationId,
        facilityId,
        venueId: facilityId,
      });

      const res = await tx.kitchenFulfillmentTicket.update({
        where: { id: ticket.id },
        data: {
          status: KitchenTicketStatus.cancelled,
          cancelledAt: now,
          cancelReason: dto.reason,
        },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId: ticket.organizationId,
          facilityId,
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: KitchenTicketStatus.cancelled,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: `Cancelled: ${dto.reason}`,
          notes: dto.notes ?? null,
          timestamp: now,
        },
      });

      return res;
    });

    await this.gateway.broadcastDistroPickupUpdate(
      facilityId,
      updated.zoneId || '',
      updated,
      'distro_pickup_updated',
    );

    return updated;
  }
}
