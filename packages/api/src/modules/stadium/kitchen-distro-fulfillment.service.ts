import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KitchenTicketPriority, KitchenTicketStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyTenantSessionSettings } from '../../prisma/tenant-transaction';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import type { OperationalAreaType } from '../../auth/access-control.helper';

export const DISTRO_OVERDUE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface DistroActor {
  userId?: string;
  userName?: string;
  role?: string;
}

/**
 * Server-owned constraint: which operational areas a ticket may legitimately
 * claim, given the F&B department of the outlet / operation unit it is
 * attached to. Derived from data the client cannot set (Outlet.department,
 * FnbOperationUnit.department), so it cannot be spoofed by request text.
 *
 * Sets with more than one member are genuinely ambiguous at the data layer
 * (an outlet classed `premium_hospitality` may serve either suites or clubs);
 * the caller must disambiguate explicitly, and may only pick from this set.
 */
const FNB_DEPARTMENT_AREA_CONSTRAINTS: Record<string, ReadonlyArray<OperationalAreaType>> = {
  concessions: ['concession'],
  retail_fnb: ['concession'],
  culinary_production: ['culinary', 'kitchen'],
  premium_hospitality: ['suite', 'club'],
  catering_banquets: ['catering'],
  beverage_operations: ['concession', 'club', 'suite', 'catering'],
  vendor_partners: ['concession', 'other'],
};

/**
 * LEGACY — backfill only. Do NOT use for authorization.
 *
 * Infers an operational area by substring-matching free text that the client
 * controls (`serviceAreaName`, `notes`). It is retained solely so migration
 * 20260903190000 can classify rows created before
 * `KitchenFulfillmentTicket.operationalAreaType` existed. Using it as a live
 * authorization input is unsafe in both directions and was the subject of
 * review finding R2-01: an unlabelled ticket fell through to `distro` (which
 * Culinary is entitled to, leaking Concessions work), `'Standard Prep Line'`
 * matched `stand` -> `concession`, and any BEO-linked suite ticket was forced
 * to `catering`, locking Suites out of its own tickets.
 *
 * Live classification goes through
 * KitchenDistroFulfillmentService.resolveOperationalArea(), which is
 * deny-by-default and anchored to server-owned records.
 */
export function deriveTicketOperationalArea(ticket: {
  serviceAreaName?: string | null;
  notes?: string | null;
  beoId?: string | null;
}): OperationalAreaType {
  const name = (ticket.serviceAreaName || '').toLowerCase();
  const notes = (ticket.notes || '').toLowerCase();

  if (ticket.beoId || name.includes('catering') || name.includes('banquet') || notes.includes('catering')) {
    return 'catering';
  }
  if (
    name.includes('concession') ||
    name.includes('stand') ||
    name.includes('hawker') ||
    name.includes('cart') ||
    notes.includes('concession')
  ) {
    return 'concession';
  }
  if (name.includes('suite') || notes.includes('suite')) {
    return 'suite';
  }
  if (name.includes('club') || name.includes('lounge') || notes.includes('club')) {
    return 'club';
  }
  if (name.includes('kitchen') || name.includes('culinary')) {
    return 'culinary';
  }
  return 'distro';
}

export interface CreateKitchenTicketDto {
  eventId?: string;
  beoId?: string;
  zoneId?: string;
  serviceAreaId?: string;
  /**
   * Explicit, enum-validated operational area. Required unless `serviceAreaId`
   * resolves to a service area whose department maps to exactly one area.
   * The caller is authorized against the resolved value, so declaring an area
   * cannot grant access to one they do not already hold.
   */
  operationalAreaType?: OperationalAreaType;
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
  /** Defaults to `suite` (BEO orders are raised against a suite sub-venue). */
  operationalAreaType?: OperationalAreaType;
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

export interface ReopenTicketDto {
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
   * Resolves the authoritative operational area for a new ticket (R2-01).
   *
   * Deny-by-default. The returned area is what every later authorization
   * decision is made against, so it must never be inferred from text the
   * client controls:
   *
   *   - `serviceAreaId`, when supplied, must resolve to a real Outlet or
   *     FnbOperationUnit inside this org/facility. Its server-owned
   *     `department` yields the set of areas the ticket may legitimately
   *     claim. An id that resolves to nothing is rejected rather than
   *     ignored, so a bogus id cannot be used to reach the looser path below.
   *   - `declaredArea` (an enum, never free text) picks within that set, and
   *     is rejected if it falls outside it — a concessions outlet cannot be
   *     labelled `suite`.
   *   - With no resolvable service area, `declaredArea` stands alone. That is
   *     safe because the caller is separately checked against it by
   *     canAccessResource, so they can only ever declare an area they already
   *     hold — declaring one is not a way to gain access.
   *   - With neither, we reject. There is deliberately no fallback area:
   *     the previous `distro` default is exactly what leaked Concessions work
   *     to Culinary.
   */
  async resolveOperationalArea(params: {
    organizationId: string;
    facilityId: string;
    serviceAreaId?: string | null;
    declaredArea?: OperationalAreaType | null;
  }): Promise<OperationalAreaType> {
    const { organizationId, facilityId, serviceAreaId, declaredArea } = params;

    if (serviceAreaId) {
      const outlet = await this.prisma.outlet.findFirst({
        where: { id: serviceAreaId, organizationId, facilityId },
        select: { department: true },
      });
      const unit = outlet
        ? null
        : await this.prisma.fnbOperationUnit.findFirst({
            where: { id: serviceAreaId, venueId: facilityId },
            select: { department: true },
          });

      if (!outlet && !unit) {
        throw new BadRequestException(
          'serviceAreaId does not resolve to a service area in this facility.',
        );
      }

      const fnbDepartment = (outlet?.department ?? unit!.department) as string;
      const permitted = FNB_DEPARTMENT_AREA_CONSTRAINTS[fnbDepartment];

      if (!permitted || permitted.length === 0) {
        throw new BadRequestException(
          `Service area is classified '${fnbDepartment}', which has no operational-area mapping. Assign a supported department before raising tickets against it.`,
        );
      }

      if (declaredArea) {
        if (!permitted.includes(declaredArea)) {
          throw new BadRequestException(
            `Operational area '${declaredArea}' is not valid for this service area (permitted: ${permitted.join(', ')}).`,
          );
        }
        return declaredArea;
      }

      if (permitted.length === 1) return permitted[0];

      throw new BadRequestException(
        `This service area serves multiple operational areas (${permitted.join(', ')}); specify operationalAreaType explicitly.`,
      );
    }

    if (declaredArea) return declaredArea;

    throw new BadRequestException(
      'operationalAreaType is required when no serviceAreaId is supplied, so the ticket can be routed to the correct department.',
    );
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

    const whereClause: Prisma.KitchenFulfillmentTicketWhereInput = { facilityId };
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
   * Fetches ticket details with full history by ID.
   */
  async getTicketById(facilityId: string, ticketId: string) {
    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { facilityId, id: ticketId },
      include: {
        history: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Fulfillment ticket not found.');
    }

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
  async createTicket(
    facilityId: string,
    dto: CreateKitchenTicketDto,
    actor: DistroActor = {},
    resolvedArea?: OperationalAreaType,
  ) {
    // F-16: Always derive organizationId securely from venue scope, never from caller-supplied DTO
    const organizationId = await this.organizationIdFor(facilityId);

    // R2-01: the persisted area is authoritative for every later authorization
    // decision. The controller resolves it before authorizing the caller, and
    // passes it through; resolving again here would be wasted work but must
    // still happen if some other entry point calls the service directly.
    const operationalAreaType =
      resolvedArea ??
      (await this.resolveOperationalArea({
        organizationId,
        facilityId,
        serviceAreaId: dto.serviceAreaId,
        declaredArea: dto.operationalAreaType,
      }));

    const ticket = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, { organizationId, facilityId, venueId: facilityId });

      const created = await tx.kitchenFulfillmentTicket.create({
        data: {
          organizationId,
          facilityId,
          operationalAreaType,
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

    // R2-01: these tickets originate from a SuiteBeoOrder against a specific
    // sub-venue (the suite), so the area is `suite` — NOT `catering`. The old
    // text-derivation forced every BEO-linked ticket to `catering`, which both
    // leaked suite work to Catering and locked the owning Suites department
    // out of its own tickets. An explicit override is still honoured for
    // genuinely non-suite BEO flows.
    const operationalAreaType: OperationalAreaType = dto.operationalAreaType ?? 'suite';

    const createdTickets = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, { organizationId, facilityId, venueId: facilityId });

      const results = [];
      for (const item of itemsToCreate) {
        const ticket = await tx.kitchenFulfillmentTicket.create({
          data: {
            organizationId,
            facilityId,
            operationalAreaType,
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
   * Kitchen action: transition waiting -> firing with CAS optimistic lock (F-07).
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

      // F-07: CAS update on status
      const updateResult = await tx.kitchenFulfillmentTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: KitchenTicketStatus.firing,
          firedAt: now,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent status update detected; please retry.');
      }

      const res = await tx.kitchenFulfillmentTicket.findUniqueOrThrow({
        where: { id: ticket.id },
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
   * Kitchen action: transition firing/waiting -> ready at Distro with CAS optimistic lock (F-07).
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

    if (ticket.status === KitchenTicketStatus.ready) {
      return ticket; // Idempotent
    }

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

      // F-07: CAS update on status
      const updateResult = await tx.kitchenFulfillmentTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: KitchenTicketStatus.ready,
          readyAt: now,
          distroLocationId: dto.distroLocationId ?? ticket.distroLocationId,
          distroLocationName: dto.distroLocationName ?? ticket.distroLocationName,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent status update detected; please retry.');
      }

      const res = await tx.kitchenFulfillmentTicket.findUniqueOrThrow({
        where: { id: ticket.id },
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
   * Enforces CAS optimistic lock (F-07).
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

      // F-07: CAS update on status
      const updateResult = await tx.kitchenFulfillmentTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: KitchenTicketStatus.firing,
          readyAt: null,
          overdueAt: null,
          firedAt: now,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent status update detected; please retry.');
      }

      const res = await tx.kitchenFulfillmentTicket.findUniqueOrThrow({
        where: { id: ticket.id },
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
   * Accurately checks and preserves if the item was overdue, with CAS optimistic lock (F-07).
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

      // F-07: CAS update on status
      const updateResult = await tx.kitchenFulfillmentTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: KitchenTicketStatus.picked_up,
          pickedUpAt: now,
          pickedUpByUserId: actor.userId ?? null,
          pickedUpByName: dto.runnerName || actor.userName || 'Service Area Runner',
          wasOverdue,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent status update detected; please retry.');
      }

      const res = await tx.kitchenFulfillmentTicket.findUniqueOrThrow({
        where: { id: ticket.id },
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
   * Idempotent if already cancelled (F-17), CAS-guarded against races (F-07).
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

    // F-17: Idempotent cancellation
    if (ticket.status === KitchenTicketStatus.cancelled) {
      return ticket;
    }

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

      // F-07: CAS update on status
      const updateResult = await tx.kitchenFulfillmentTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: KitchenTicketStatus.cancelled,
          cancelledAt: now,
          cancelReason: dto.reason,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent status update detected; please retry.');
      }

      const res = await tx.kitchenFulfillmentTicket.findUniqueOrThrow({
        where: { id: ticket.id },
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

  /**
   * Manager action: reopen a cancelled or picked_up ticket (F-09).
   * Restores ticket to waiting (or ready), recording the reason and full audit trail.
   */
  async reopenTicket(
    facilityId: string,
    ticketId: string,
    dto: ReopenTicketDto,
    actor: DistroActor = {},
  ) {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('A reason must be provided when reopening a fulfillment ticket.');
    }

    const ticket = await this.prisma.kitchenFulfillmentTicket.findFirst({
      where: { id: ticketId, facilityId },
    });
    if (!ticket) throw new NotFoundException('Fulfillment ticket not found.');

    if (ticket.status !== KitchenTicketStatus.cancelled && ticket.status !== KitchenTicketStatus.picked_up) {
      throw new BadRequestException(
        `Only cancelled or picked up tickets can be reopened (current status: ${ticket.status}).`,
      );
    }

    const targetStatus = ticket.status === KitchenTicketStatus.picked_up
      ? KitchenTicketStatus.ready
      : KitchenTicketStatus.waiting;

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: ticket.organizationId,
        facilityId,
        venueId: facilityId,
      });

      // F-07: CAS update
      const updateResult = await tx.kitchenFulfillmentTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: targetStatus,
          cancelledAt: null,
          cancelReason: null,
          ...(targetStatus === KitchenTicketStatus.ready
            ? { pickedUpAt: null, pickedUpByUserId: null, pickedUpByName: null }
            : { readyAt: null, pickedUpAt: null, pickedUpByUserId: null, pickedUpByName: null }),
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Concurrent status update detected; please retry.');
      }

      const res = await tx.kitchenFulfillmentTicket.findUniqueOrThrow({
        where: { id: ticket.id },
      });

      await tx.kitchenFulfillmentStatusHistory.create({
        data: {
          organizationId: ticket.organizationId,
          facilityId,
          ticketId: ticket.id,
          fromStatus: ticket.status,
          toStatus: targetStatus,
          actorId: actor.userId ?? null,
          actorName: actor.userName ?? null,
          reason: `Reopened ticket: ${dto.reason.trim()}`,
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
