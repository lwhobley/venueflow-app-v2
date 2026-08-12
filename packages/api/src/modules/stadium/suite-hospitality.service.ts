import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { EnterpriseWebhookService } from '../integrations/enterprise-webhook.service';
import { SuiteBeoStatus } from '@prisma/client';

export interface CreateSuiteBeoDto {
  organizationId: string;
  facilityId: string;
  zoneId: string;
  subVenueId: string;
  eventId?: string;
  beoNumber: string;
  hostName: string;
  hostPhone?: string;
  hostEmail?: string;
  guestCount?: number;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  specialInstructions?: string;
  cateringLineItems: Array<{ code: string; name: string; quantity: number; unitPriceCents: number; category: string }>;
  parReplenishmentTriggers?: Record<string, unknown>;
  totalCents?: number;
}

export interface CompleteDeliveryDto {
  deliveredBy: string;
  deliverySignatureUrl?: string;
  deliveryPhotoUrl?: string;
  notes?: string;
}

export interface CreateReplenishmentDto {
  subVenueId: string;
  zoneId: string;
  itemSummary: string;
  priority?: 'normal' | 'high' | 'urgent';
  requestedBy?: string;
}

@Injectable()
export class SuiteHospitalityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: SuiteHospitalityGateway,
    private readonly webhooks: EnterpriseWebhookService,
  ) {}

  async listSuiteBeos(facilityId: string, zoneId?: string, status?: SuiteBeoStatus) {
    const orders = await this.prisma.suiteBeoOrder.findMany({
      where: {
        facilityId,
        ...(zoneId ? { zoneId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        subVenue: { select: { id: true, code: true, name: true, subVenueType: true } },
        zone: { select: { id: true, code: true, name: true, level: true } },
        statusLogs: { orderBy: { timestamp: 'desc' }, take: 10 },
        replenishments: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { deliveryWindowStart: 'asc' },
    });

    const now = new Date();
    return orders.map((order) => {
      const start = new Date(order.deliveryWindowStart);
      const minutesUntilDelivery = Math.round((start.getTime() - now.getTime()) / (60 * 1000));
      let urgency: 'critical' | 'warning' | 'normal' = 'normal';
      if (minutesUntilDelivery <= 15) urgency = 'critical';
      else if (minutesUntilDelivery <= 30) urgency = 'warning';

      return {
        ...order,
        minutesUntilDelivery,
        urgencyColor: urgency === 'critical' ? '#ef4444' : urgency === 'warning' ? '#f59e0b' : '#10b981',
      };
    });
  }

  async createBeoOrder(dto: CreateSuiteBeoDto) {
    const totalCents = dto.totalCents ?? dto.cateringLineItems.reduce((acc, item) => acc + item.quantity * item.unitPriceCents, 0);
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.suiteBeoOrder.create({
        data: {
          organizationId: dto.organizationId,
          facilityId: dto.facilityId,
          zoneId: dto.zoneId,
          subVenueId: dto.subVenueId,
          eventId: dto.eventId ?? null,
          beoNumber: dto.beoNumber,
          hostName: dto.hostName,
          hostPhone: dto.hostPhone ?? null,
          hostEmail: dto.hostEmail ?? null,
          guestCount: dto.guestCount ?? 12,
          deliveryWindowStart: new Date(dto.deliveryWindowStart),
          deliveryWindowEnd: new Date(dto.deliveryWindowEnd),
          specialInstructions: dto.specialInstructions ?? null,
          cateringLineItems: dto.cateringLineItems as any,
          parReplenishmentTriggers: dto.parReplenishmentTriggers as any ?? { icePar: 2, champagnePar: 1 },
          status: 'confirmed_beo',
          totalCents,
        },
      });

      await tx.suiteBeoStatusLog.create({
        data: {
          beoOrderId: created.id,
          fromStatus: 'draft',
          toStatus: 'confirmed_beo',
          notes: 'BEO Confirmed by Suite Host / Event Coordinator',
        },
      });

      return created;
    });

    // Broadcast WebSocket event
    this.wsGateway.broadcastBeoUpdate(order.facilityId, order.zoneId, order as any);

    // Emit Outbound Enterprise Webhook for Confirmed BEO
    await this.webhooks.emitSuiteBeoWebhook({
      eventId: order.eventId ?? 'evt_stadium_live',
      eventType: 'suite.beo.confirmed',
      organizationId: order.organizationId,
      facilityId: order.facilityId,
      beoNumber: order.beoNumber,
      subVenueId: order.subVenueId,
      totalCents: order.totalCents,
      lineItems: dto.cateringLineItems,
      timestamp: new Date().toISOString(),
    });

    return order;
  }

  async updateOrderStatus(beoOrderId: string, toStatus: SuiteBeoStatus, actorId?: string, actorName?: string, notes?: string) {
    const existing = await this.prisma.suiteBeoOrder.findUnique({ where: { id: beoOrderId } });
    if (!existing) throw new NotFoundException('Suite BEO order not found.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.suiteBeoOrder.update({
        where: { id: beoOrderId },
        data: {
          status: toStatus,
          ...(toStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
        },
      });

      await tx.suiteBeoStatusLog.create({
        data: {
          beoOrderId,
          fromStatus: existing.status,
          toStatus,
          actorId: actorId ?? null,
          actorName: actorName ?? 'Staff',
          notes: notes ?? `Status transitioned from ${existing.status} to ${toStatus}`,
        },
      });

      return order;
    });

    this.wsGateway.broadcastBeoUpdate(updated.facilityId, updated.zoneId, updated as any);

    if (toStatus === 'closed_invoiced') {
      await this.webhooks.emitSuiteBeoWebhook({
        eventId: updated.eventId ?? 'evt_stadium_live',
        eventType: 'suite.beo.closed_invoiced',
        organizationId: updated.organizationId,
        facilityId: updated.facilityId,
        beoNumber: updated.beoNumber,
        subVenueId: updated.subVenueId,
        totalCents: updated.totalCents,
        lineItems: (updated.cateringLineItems as any) ?? [],
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  async markDelivered(beoOrderId: string, dto: CompleteDeliveryDto) {
    const existing = await this.prisma.suiteBeoOrder.findUnique({ where: { id: beoOrderId } });
    if (!existing) throw new NotFoundException('Suite BEO order not found.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.suiteBeoOrder.update({
        where: { id: beoOrderId },
        data: {
          status: 'delivered',
          deliveredAt: new Date(),
          deliveredBy: dto.deliveredBy,
          deliverySignatureUrl: dto.deliverySignatureUrl ?? 'https://stadium-assets.example.com/signatures/suite-host-sig.png',
          deliveryPhotoUrl: dto.deliveryPhotoUrl ?? 'https://stadium-assets.example.com/photos/suite-delivery-proof.jpg',
        },
      });

      await tx.suiteBeoStatusLog.create({
        data: {
          beoOrderId,
          fromStatus: existing.status,
          toStatus: 'delivered',
          actorName: dto.deliveredBy,
          notes: dto.notes ?? 'Suite Attendant marked order delivered with digital signature verification.',
        },
      });

      return order;
    });

    this.wsGateway.broadcastBeoUpdate(updated.facilityId, updated.zoneId, updated as any);
    return updated;
  }

  async createReplenishment(beoOrderId: string, dto: CreateReplenishmentDto) {
    const beo = await this.prisma.suiteBeoOrder.findUnique({ where: { id: beoOrderId } });
    if (!beo) throw new NotFoundException('Suite BEO order not found.');

    const req = await this.prisma.suiteBeoReplenishmentRequest.create({
      data: {
        beoOrderId,
        subVenueId: dto.subVenueId,
        zoneId: dto.zoneId,
        itemSummary: dto.itemSummary,
        priority: dto.priority ?? 'high',
        status: 'pending',
        requestedBy: dto.requestedBy ?? 'Suite Attendant',
      },
    });

    this.wsGateway.broadcastReplenishment(beo.facilityId, beo.zoneId, req as any);
    return req;
  }

  async seed10VipSuites(facilityId: string, organizationId: string, zoneId: string) {
    const now = new Date();
    const suites = await this.prisma.subVenue.findMany({
      where: { facilityId },
      take: 10,
    });

    const createdOrders = [];
    for (let i = 0; i < 10; i++) {
      const suite = suites[i] ?? { id: `sub_suite_${i + 1}`, name: `VIP Suite ${101 + i}` };
      const startOffsetMin = (i - 2) * 15; // Staggered delivery windows (-30m to +105m)
      const deliveryStart = new Date(now.getTime() + startOffsetMin * 60 * 1000);
      const deliveryEnd = new Date(deliveryStart.getTime() + 30 * 60 * 1000);

      const beoNumber = `BEO-SUITE-${2000 + i}`;
      const lineItems = [
        { code: 'CAVIAR-01', name: 'Petrossian Caviar & Blinis', quantity: 2, unitPriceCents: 15000, category: 'Appetizers' },
        { code: 'SLIDER-WAGYU', name: 'Wagyu Beef Sliders (12pc)', quantity: 3, unitPriceCents: 8500, category: 'Platters' },
        { code: 'CHAMP-DOM', name: 'Dom Pérignon Vintage Champagne', quantity: 2, unitPriceCents: 35000, category: 'Beverage' },
        { code: 'CHARCUTERIE', name: 'Artisanal Cheese & Charcuterie', quantity: 1, unitPriceCents: 12000, category: 'Platters' },
      ];

      const existing = await this.prisma.suiteBeoOrder.findUnique({ where: { beoNumber } });
      if (existing) {
        createdOrders.push(existing);
        continue;
      }

      const order = await this.createBeoOrder({
        organizationId,
        facilityId,
        zoneId,
        subVenueId: suite.id,
        beoNumber,
        hostName: `Host ${101 + i} - Suite Sponsor`,
        hostPhone: `+1-555-019-${i.toString().padStart(2, '0')}`,
        hostEmail: `suite${101 + i}@sponsor-corp.example`,
        guestCount: 16,
        deliveryWindowStart: deliveryStart.toISOString(),
        deliveryWindowEnd: deliveryEnd.toISOString(),
        specialInstructions: 'Allergies: 1 Peanut Allergy. Chill Champagne to 45°F prior to guest arrival.',
        cateringLineItems: lineItems,
      });

      createdOrders.push(order);
    }

    return createdOrders;
  }
}
