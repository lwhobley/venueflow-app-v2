import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class StandItemCount {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsNumber() @Min(0) count!: number;
  @IsInt() @Min(0) unitPriceCents!: number;
}

export class CreateStandSheetDto {
  @IsOptional() @IsString() organizationId!: string;
  @IsOptional() @IsString() facilityId!: string;
  @IsString() zoneId!: string;
  @IsString() outletId!: string;
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() supervisorId?: string;
  @IsOptional() @IsString() supervisorName?: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StandItemCount)
  countInItems!: StandItemCount[];
}

export class RecordCountOutDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StandItemCount) countOutItems!: StandItemCount[];
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StandItemCount) wasteItems!: StandItemCount[];
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StandItemCount) posItemsSold!: StandItemCount[];
  @IsInt() @Min(0) actualPosRevenueCents!: number;
}

export class TransferItemDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsNumber() @Min(0.001) quantity!: number;
}

export class CreateTransferDto {
  @IsOptional() @IsString() organizationId!: string;
  @IsOptional() @IsString() facilityId!: string;
  @IsString() fromOutletId!: string;
  @IsString() toOutletId!: string;
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() requestedBy?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TransferItemDto)
  items!: TransferItemDto[];
}

export class HawkerCheckoutItemDto extends TransferItemDto {
  @IsInt() @Min(0) unitPriceCents!: number;
}

export class HawkerCheckoutDto {
  @IsOptional() @IsString() organizationId!: string;
  @IsOptional() @IsString() facilityId!: string;
  @IsString() hawkerId!: string;
  @IsString() hawkerName!: string;
  @IsOptional() @IsString() eventId?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => HawkerCheckoutItemDto)
  itemsCheckedOut!: HawkerCheckoutItemDto[];
  @IsOptional() @IsInt() @Min(0) @Max(10000) commissionRateBps?: number;
}

export class HawkerSettleDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TransferItemDto) itemsCheckedIn!: TransferItemDto[];
  @IsInt() @Min(0) cashCollectedCents!: number;
  @IsInt() @Min(0) cardCollectedCents!: number;
}

@Injectable()
export class ConcourseInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: SuiteHospitalityGateway,
  ) {}

  async listStandSheets(facilityId: string, zoneId?: string, outletId?: string) {
    return this.prisma.standSheet.findMany({
      where: {
        facilityId,
        ...(zoneId ? { zoneId } : {}),
        ...(outletId ? { outletId } : {}),
      },
      include: {
        outlet: { select: { id: true, code: true, name: true, outletType: true } },
        zone: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createStandSheet(dto: CreateStandSheetDto) {
    const standSheet = await this.prisma.standSheet.create({
      data: {
        organizationId: dto.organizationId,
        facilityId: dto.facilityId,
        zoneId: dto.zoneId,
        outletId: dto.outletId,
        eventId: dto.eventId ?? null,
        supervisorId: dto.supervisorId ?? null,
        supervisorName: dto.supervisorName ?? 'Supervisor',
        status: 'count_in_recorded',
        countIn: dto.countInItems as any,
        restocks: [] as any,
        countOut: [] as any,
        wasteCount: [] as any,
        posItemsSold: [] as any,
      },
    });

    return standSheet;
  }

  async reconcileStandSheet(facilityId: string, standSheetId: string, dto: RecordCountOutDto) {
    const existing = await this.prisma.standSheet.findFirst({ where: { id: standSheetId, facilityId } });
    if (!existing) throw new NotFoundException('Stand sheet not found.');

    const countInMap = new Map<string, StandItemCount>((existing.countIn as any[]).map(i => [i.code, i]));
    const restockMap = new Map<string, number>();
    ((existing.restocks as any[]) || []).forEach(r => {
      (r.items || []).forEach((item: any) => {
        restockMap.set(item.code, (restockMap.get(item.code) || 0) + item.quantity);
      });
    });

    const countOutMap = new Map<string, number>(dto.countOutItems.map(i => [i.code, i.count]));
    const wasteMap = new Map<string, number>(dto.wasteItems.map(i => [i.code, i.count]));
    const posSoldMap = new Map<string, number>(dto.posItemsSold.map(i => [i.code, i.count]));

    let expectedSalesRevenueCents = 0;
    const inventoryVariance: Array<{
      code: string;
      name: string;
      countIn: number;
      restocks: number;
      countOut: number;
      waste: number;
      expectedSold: number;
      posSold: number;
      varianceQuantity: number;
      varianceDollarsCents: number;
    }> = [];

    countInMap.forEach((item, code) => {
      const cIn = item.count;
      const restockQty = restockMap.get(code) || 0;
      const cOut = countOutMap.get(code) || 0;
      const wasteQty = wasteMap.get(code) || 0;
      const posSoldQty = posSoldMap.get(code) || 0;

      const expectedSold = cIn + restockQty - cOut - wasteQty;
      const varianceQuantity = expectedSold - posSoldQty;
      const itemExpectedRevenue = expectedSold * item.unitPriceCents;
      expectedSalesRevenueCents += itemExpectedRevenue;
      const varianceDollarsCents = varianceQuantity * item.unitPriceCents;

      inventoryVariance.push({
        code,
        name: item.name,
        countIn: cIn,
        restocks: restockQty,
        countOut: cOut,
        waste: wasteQty,
        expectedSold,
        posSold: posSoldQty,
        varianceQuantity,
        varianceDollarsCents,
      });
    });

    const varianceAmountCents = expectedSalesRevenueCents - dto.actualPosRevenueCents;

    const reconciled = await this.prisma.standSheet.update({
      where: { id: standSheetId },
      data: {
        status: 'reconciled',
        countOut: dto.countOutItems as any,
        wasteCount: dto.wasteItems as any,
        posItemsSold: dto.posItemsSold as any,
        expectedSalesRevenueCents,
        actualPosRevenueCents: dto.actualPosRevenueCents,
        varianceAmountCents,
        inventoryVariance: inventoryVariance as any,
      },
    });

    return reconciled;
  }

  // --- Central Commissary Restock Transfers ---
  async listTransfers(facilityId: string) {
    return this.prisma.inventoryTransferRequest.findMany({
      where: { facilityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitTransferRequest(dto: CreateTransferDto) {
    const transfer = await this.prisma.inventoryTransferRequest.create({
      data: {
        organizationId: dto.organizationId,
        facilityId: dto.facilityId,
        fromOutletId: dto.fromOutletId,
        toOutletId: dto.toOutletId,
        eventId: dto.eventId ?? null,
        requestedBy: dto.requestedBy ?? 'Concourse Supervisor',
        status: 'pending',
        items: dto.items as any,
      },
    });

    this.wsGateway.broadcastReplenishment(dto.facilityId, 'zone-central', {
      transferId: transfer.id,
      fromOutletId: dto.fromOutletId,
      toOutletId: dto.toOutletId,
      items: dto.items,
    });

    return transfer;
  }

  async updateTransferStatus(facilityId: string, transferId: string, status: 'approved' | 'in_transit' | 'completed' | 'rejected') {
    const transfer = await this.prisma.inventoryTransferRequest.findFirst({ where: { id: transferId, facilityId } });
    if (!transfer) throw new NotFoundException('Transfer request not found.');
    const allowed: Record<string, string[]> = {
      pending: ['approved', 'rejected'], approved: ['in_transit', 'rejected'], in_transit: ['completed'], completed: [], rejected: [],
    };
    if (!allowed[transfer.status]?.includes(status)) {
      throw new BadRequestException(`Cannot transition a transfer from ${transfer.status} to ${status}.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryTransferRequest.update({
        where: { id: transferId },
        data: { status, ...(status === 'completed' ? { completedAt: new Date() } : {}) },
      });
      if (status !== 'completed') return updated;

      const activeSheet = await tx.standSheet.findFirst({
        where: { facilityId, outletId: transfer.toOutletId, status: { in: ['count_in_recorded', 'active_event'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (!activeSheet) return updated;
      const existingRestocks = (activeSheet.restocks as any[]) || [];
      if (!existingRestocks.some((entry) => entry.transferId === transfer.id)) {
        existingRestocks.push({ transferId: transfer.id, items: transfer.items, addedAt: new Date().toISOString() });
        await tx.standSheet.update({
          where: { id: activeSheet.id },
          data: { restocks: existingRestocks as any, status: 'active_event' },
        });
      }
      return updated;
    });
  }

  // --- Hawker Vendor Commissions ---
  async checkoutHawkerInventory(dto: HawkerCheckoutDto) {
    return this.prisma.hawkerVendorSession.create({
      data: {
        organizationId: dto.organizationId,
        facilityId: dto.facilityId,
        hawkerId: dto.hawkerId,
        hawkerName: dto.hawkerName,
        eventId: dto.eventId ?? null,
        itemsCheckedOut: dto.itemsCheckedOut as any,
        commissionRateBps: dto.commissionRateBps ?? 1500, // 15.00%
        status: 'active',
      },
    });
  }

  async settleHawkerSession(facilityId: string, sessionId: string, dto: HawkerSettleDto) {
    const session = await this.prisma.hawkerVendorSession.findFirst({ where: { id: sessionId, facilityId } });
    if (!session) throw new NotFoundException('Hawker session not found.');
    if (session.status === 'settled') throw new BadRequestException('Hawker session is already settled.');

    const checkedOutMap = new Map<string, { name: string; quantity: number; unitPriceCents: number }>(
      (session.itemsCheckedOut as any[]).map(i => [i.code, i])
    );

    const checkedInMap = new Map<string, number>(dto.itemsCheckedIn.map(i => [i.code, i.quantity]));

    let grossSalesCents = 0;
    const itemsSold: Array<{ code: string; name: string; quantitySold: number; subtotalCents: number }> = [];

    checkedOutMap.forEach((item, code) => {
      const checkedInQty = checkedInMap.get(code) || 0;
      const quantitySold = Math.max(0, item.quantity - checkedInQty);
      const subtotalCents = quantitySold * item.unitPriceCents;
      grossSalesCents += subtotalCents;

      itemsSold.push({
        code,
        name: item.name,
        quantitySold,
        subtotalCents,
      });
    });

    const commissionRate = session.commissionRateBps / 10000.0;
    const commissionPayoutCents = Math.round(grossSalesCents * commissionRate);

    const settled = await this.prisma.hawkerVendorSession.update({
      where: { id: sessionId },
      data: {
        status: 'settled',
        itemsCheckedIn: dto.itemsCheckedIn as any,
        itemsSold: itemsSold as any,
        cashCollectedCents: dto.cashCollectedCents,
        cardCollectedCents: dto.cardCollectedCents,
        grossSalesCents,
        commissionPayoutCents,
        settledAt: new Date(),
      },
    });

    return settled;
  }

  // --- Test Seeding ---
  async seedConcourseOutletsAndWarehouse(facilityId: string, organizationId: string, zoneId: string) {
    // 1 Central Warehouse, 5 Concourse Stands, 3 Mobile Carts
    const warehouse = await this.prisma.outlet.upsert({
      where: { organizationId_facilityId_code: { organizationId, facilityId, code: 'WH-CENTRAL-01' } },
      create: {
        organizationId,
        facilityId,
        zoneId,
        code: 'WH-CENTRAL-01',
        name: 'Central Commissary Warehouse',
        department: 'culinary_production',
        outletType: 'commissary',
        status: 'open',
      },
      update: {},
    });

    const stands = [];
    for (let i = 1; i <= 5; i++) {
      const code = `STAND-${100 + i}`;
      const stand = await this.prisma.outlet.upsert({
        where: { organizationId_facilityId_code: { organizationId, facilityId, code } },
        create: {
          organizationId,
          facilityId,
          zoneId,
          code,
          name: `Concourse Stand ${100 + i} (Grill & Draft)`,
          department: 'concessions',
          outletType: 'fixed_concourse_stand',
          status: 'open',
        },
        update: {},
      });
      stands.push(stand);
    }

    const carts = [];
    for (let j = 1; j <= 3; j++) {
      const code = `CART-${200 + j}`;
      const cart = await this.prisma.outlet.upsert({
        where: { organizationId_facilityId_code: { organizationId, facilityId, code } },
        create: {
          organizationId,
          facilityId,
          zoneId,
          code,
          name: `Mobile Pop-up Beer Cart ${200 + j}`,
          department: 'beverage_operations',
          outletType: 'mobile_cart',
          status: 'open',
        },
        update: {},
      });
      carts.push(cart);
    }

    return { warehouse, stands, carts };
  }
}
