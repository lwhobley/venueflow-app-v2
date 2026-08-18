import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyTenantSessionSettings } from '../../prisma/tenant-transaction';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { EnterpriseWebhookService } from '../integrations/enterprise-webhook.service';
import { SuiteBeoStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class CateringLineItemDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsInt() @Min(0) unitPriceCents!: number;
  @IsString() category!: string;
}

export class CreateSuiteBeoDto {
  @IsOptional() @IsString() organizationId!: string;
  @IsOptional() @IsString() facilityId!: string;
  @IsString()
  zoneId!: string;
  @IsString()
  subVenueId!: string;
  @IsOptional() @IsString()
  eventId?: string;
  @IsString()
  beoNumber!: string;
  @IsString()
  hostName!: string;
  @IsOptional() @IsString()
  hostPhone?: string;
  @IsOptional() @IsEmail()
  hostEmail?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500)
  guestCount?: number;
  @IsDateString()
  deliveryWindowStart!: string;
  @IsDateString()
  deliveryWindowEnd!: string;
  @IsOptional() @IsString()
  specialInstructions?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CateringLineItemDto)
  cateringLineItems!: CateringLineItemDto[];
  @IsOptional() @IsObject()
  parReplenishmentTriggers?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0)
  totalCents?: number;
}

export class CompleteDeliveryDto {
  @IsOptional() @IsString()
  deliveredBy!: string;
  @IsOptional() @IsString()
  deliverySignatureUrl?: string;
  @IsOptional() @IsString()
  deliveryPhotoUrl?: string;
  @IsOptional() @IsString()
  notes?: string;
}

export class CreateReplenishmentDto {
  @IsOptional() @IsString() subVenueId!: string;
  @IsOptional() @IsString() zoneId!: string;
  @IsString()
  itemSummary!: string;
  @IsOptional() @IsIn(['normal', 'high', 'urgent'])
  priority?: 'normal' | 'high' | 'urgent';
  @IsOptional() @IsString()
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
    const deliveryStart = new Date(dto.deliveryWindowStart);
    const deliveryEnd = new Date(dto.deliveryWindowEnd);
    if (!Number.isFinite(deliveryStart.getTime()) || !Number.isFinite(deliveryEnd.getTime()) || deliveryEnd <= deliveryStart) {
      throw new BadRequestException('Delivery window must contain valid dates with the end after the start.');
    }
    const totalCents = dto.totalCents ?? dto.cateringLineItems.reduce((acc, item) => acc + item.quantity * item.unitPriceCents, 0);
    const order = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: dto.organizationId,
        facilityId: dto.facilityId,
        venueId: dto.facilityId,
      });
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
          deliveryWindowStart: deliveryStart,
          deliveryWindowEnd: deliveryEnd,
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
    await this.wsGateway.broadcastBeoUpdate(order.facilityId, order.zoneId, order as any);

    // Emit Outbound Enterprise Webhook for Confirmed BEO
    await this.webhooks.emitSuiteBeoWebhook({
      eventId: order.eventId ?? 'evt_stadium_live',
      eventType: 'suite.beo.confirmed',
      organizationId: order.organizationId,
      facilityId: order.facilityId,
      beoNumber: order.beoNumber,
      subVenueId: order.subVenueId,
      totalCents: order.totalCents,
      lineItems: dto.cateringLineItems.map((item) => ({ ...item })),
      timestamp: new Date().toISOString(),
    });

    return order;
  }

  async updateOrderStatus(facilityId: string, beoOrderId: string, toStatus: SuiteBeoStatus, actorId?: string, actorName?: string, notes?: string) {
    const existing = await this.prisma.suiteBeoOrder.findFirst({ where: { id: beoOrderId, facilityId } });
    if (!existing) throw new NotFoundException('Suite BEO order not found.');
    const allowed: Record<SuiteBeoStatus, SuiteBeoStatus[]> = {
      draft: ['confirmed_beo'],
      confirmed_beo: ['prep_initiated'],
      prep_initiated: ['en_route'],
      en_route: ['delivered'],
      delivered: ['closed_invoiced'],
      closed_invoiced: [],
    };
    if (!allowed[existing.status].includes(toStatus)) {
      throw new BadRequestException(`Cannot transition a BEO from ${existing.status} to ${toStatus}.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: existing.organizationId,
        facilityId,
        venueId: facilityId,
      });
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

    await this.wsGateway.broadcastBeoUpdate(updated.facilityId, updated.zoneId, updated as any);

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

  async markDelivered(facilityId: string, beoOrderId: string, dto: CompleteDeliveryDto) {
    const existing = await this.prisma.suiteBeoOrder.findFirst({ where: { id: beoOrderId, facilityId } });
    if (!existing) throw new NotFoundException('Suite BEO order not found.');
    if (existing.status !== 'en_route') throw new BadRequestException('Only an en-route BEO can be marked delivered.');

    const updated = await this.prisma.$transaction(async (tx) => {
      await applyTenantSessionSettings(tx, {
        organizationId: existing.organizationId,
        facilityId,
        venueId: facilityId,
      });
      const order = await tx.suiteBeoOrder.update({
        where: { id: beoOrderId },
        data: {
          status: 'delivered',
          deliveredAt: new Date(),
          deliveredBy: dto.deliveredBy,
          deliverySignatureUrl: dto.deliverySignatureUrl ?? null,
          deliveryPhotoUrl: dto.deliveryPhotoUrl ?? null,
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

    await this.wsGateway.broadcastBeoUpdate(updated.facilityId, updated.zoneId, updated as any);
    return updated;
  }

  async createReplenishment(facilityId: string, beoOrderId: string, dto: CreateReplenishmentDto) {
    const beo = await this.prisma.suiteBeoOrder.findFirst({ where: { id: beoOrderId, facilityId } });
    if (!beo) throw new NotFoundException('Suite BEO order not found.');

    const req = await this.prisma.suiteBeoReplenishmentRequest.create({
      data: {
        beoOrderId,
        subVenueId: beo.subVenueId,
        zoneId: beo.zoneId,
        itemSummary: dto.itemSummary,
        priority: dto.priority ?? 'high',
        status: 'pending',
        requestedBy: dto.requestedBy ?? 'Suite Attendant',
      },
    });

    await this.wsGateway.broadcastReplenishment(beo.facilityId, beo.zoneId, req as any);
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
      const suite = suites[i];
      if (!suite) break;
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

      const existing = await this.prisma.suiteBeoOrder.findFirst({ where: { facilityId, beoNumber } });
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
