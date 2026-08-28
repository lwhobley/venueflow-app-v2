import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Matches, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { canManageVenue, isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { csvCell } from '../../common/csv';
import { htmlEscape } from '../../common/html-escape';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EmailService } from '../../email/email.service';
import { BarInventoryParserService } from './bar-inventory-parser.service';
import { BarInventoryReportsService } from './bar-inventory-reports.service';
import { AsyncWriteService } from '../../async-write/async-write.service';

const CATEGORIES = [
  'spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other',
  'protein', 'produce', 'dairy', 'dry_goods', 'bakery', 'frozen'
] as const;
const MOVEMENT_TYPES = ['count', 'received', 'waste', 'comp', 'transfer', 'correction'] as const;
const WASTE_REASONS = [
  'draft_flush',
  'spoilage',
  'breakage',
  'comp',
  'temperature_loss',
  'unaccounted',
] as const;
const PREP_ITEM_KINDS = ['prep', 'eighty_six'] as const;
const PREP_ITEM_STATUSES = ['open', 'done', 'cancelled'] as const;
const MAX_IMPORT_ITEMS = 100;
const AI_PARSE_RATE_LIMIT_MAX = 20;
const AI_PARSE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

type BarStockCategory = (typeof CATEGORIES)[number];
type BarStockMovementType = (typeof MOVEMENT_TYPES)[number];
type WasteReason = (typeof WASTE_REASONS)[number];
type PrepItemKind = (typeof PREP_ITEM_KINDS)[number];
type PrepItemStatus = (typeof PREP_ITEM_STATUSES)[number];

class UpsertBarItemDto {
  @IsString()
  @IsOptional()
  itemId?: string;

  @IsString()
  name!: string;

  @IsIn(CATEGORIES)
  category!: BarStockCategory;

  @IsString()
  @IsOptional()
  area?: string;

  @IsString()
  unit!: string;

  @IsNumber()
  @Min(0)
  parLevel!: number;

  @IsNumber()
  @Min(0)
  onHand!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCostCents?: number;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class RecordMovementDto {
  @IsIn(MOVEMENT_TYPES)
  movementType!: BarStockMovementType;

  @IsNumber()
  quantity!: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsIn(WASTE_REASONS)
  @IsOptional()
  wasteReason?: WasteReason;

  @IsString()
  @IsOptional()
  fromArea?: string;

  @IsString()
  @IsOptional()
  toArea?: string;
}

class RecordTransferDto {
  @IsString()
  itemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsString()
  fromArea!: string;

  @IsString()
  toArea!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class BatchCountItemDto {
  @IsString()
  itemId!: string;

  @IsNumber()
  @Min(0)
  countedQuantity!: number;
}

class BatchCountDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchCountItemDto)
  counts!: BatchCountItemDto[];

  @IsString()
  @IsOptional()
  area?: string;
}

class ParsedItemDto {
  @IsString()
  name!: string;

  @IsIn(CATEGORIES)
  category!: BarStockCategory;

  @IsString()
  @IsOptional()
  area?: string;

  @IsString()
  unit!: string;

  @IsNumber()
  @IsOptional()
  parLevel?: number;

  @IsNumber()
  @IsOptional()
  onHand?: number;

  @IsNumber()
  @IsOptional()
  unitCostCents?: number;

  @IsString()
  @IsOptional()
  supplier?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

class ImportParsedBarItemsDto {
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ParsedItemDto)
  items!: ParsedItemDto[];
}

class UpdateCostDto {
  @IsNumber()
  @Min(0)
  unitCostCents!: number;
}

class ParseBarInventoryInputDto {
  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsOptional()
  imageBase64?: string;

  @IsString()
  @IsOptional()
  imageMimeType?: string;
}

class UpsertPrepBoardItemDto {
  @IsString()
  @IsOptional()
  itemId?: string;

  @IsIn(PREP_ITEM_KINDS)
  kind!: PrepItemKind;

  @IsString()
  title!: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  station?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be in YYYY-MM-DD format.' })
  dueDate?: string;

  @IsIn(PREP_ITEM_STATUSES)
  @IsOptional()
  status?: PrepItemStatus;
}

class UpdatePrepBoardItemStatusDto {
  @IsIn(PREP_ITEM_STATUSES)
  status!: PrepItemStatus;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeInventoryName(value: string): string {
  return value.trim().toLowerCase();
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function mapItem(item: {
  id: string;
  venueId: string;
  name: string;
  category: string;
  area: string | null;
  unit: string;
  parLevel: number;
  onHand: number;
  unitCostCents: number | null;
  supplier: string | null;
  sku: string | null;
  notes: string | null;
  lastCountedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: item.id,
    venueId: item.venueId,
    name: item.name,
    category: item.category,
    area: item.area ?? null,
    unit: item.unit,
    parLevel: item.parLevel,
    onHand: item.onHand,
    unitCostCents: item.unitCostCents ?? null,
    supplier: item.supplier ?? null,
    sku: item.sku ?? null,
    notes: item.notes ?? null,
    lastCountedAt: toMs(item.lastCountedAt),
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  };
}

function mapPrepBoardItem(item: {
  id: string;
  venueId: string;
  kind: string;
  title: string;
  quantity: number | null;
  unit: string | null;
  station: string | null;
  notes: string | null;
  dueDate: string | null;
  status: string;
  createdBy: string;
  completedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: item.id,
    venueId: item.venueId,
    kind: item.kind,
    title: item.title,
    quantity: item.quantity,
    unit: item.unit,
    station: item.station,
    notes: item.notes,
    dueDate: item.dueDate,
    status: item.status,
    createdBy: item.createdBy,
    completedBy: item.completedBy,
    completedAt: toMs(item.completedAt),
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  };
}

@Controller('v1/bar-inventory')
@UseGuards(AuthGuard)
export class BarInventoryController {
  private readonly logger = new Logger(BarInventoryController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly parser: BarInventoryParserService,
    private readonly reports: BarInventoryReportsService,
    private readonly asyncWrites: AsyncWriteService,
  ) {}

  @RequireSubscription('active')
  @Get()
  async getBarStock(
    @CurrentUser() user: AuthUser,
    @Query('area') area?: string,
    @Query('multiplier') multiplierStr?: string,
  ) {
    // Read-only inventory is visible to any venue member; mutations below
    // still require a manager profile.
    const profile = await this.requireVenueProfile(user);
    const multiplier = Math.max(0.1, Math.min(10, parseFloat(multiplierStr || '1') || 1));
    const allItems = await this.prisma.barInventoryItem.findMany({
      where: { venueId: profile.venueId! },
      // Do not silently truncate inventory: totals and count workflows must be
      // based on the full venue catalog. Deterministic ordering also keeps the
      // count sequence stable between refreshes.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const locationMap = new Map<string, { count: number; totalUnits: number; totalValueCents: number; belowParCount: number }>();
    for (const item of allItems) {
      const loc = item.area?.trim() || 'Unassigned';
      const entry = locationMap.get(loc) ?? { count: 0, totalUnits: 0, totalValueCents: 0, belowParCount: 0 };
      entry.count += 1;
      entry.totalUnits += item.onHand;
      entry.totalValueCents += Math.round(item.onHand * (item.unitCostCents ?? 0));
      if (item.onHand <= item.parLevel * multiplier) {
        entry.belowParCount += 1;
      }
      locationMap.set(loc, entry);
    }

    const locationSummaries = Array.from(locationMap.entries()).map(([areaName, stats]) => ({
      area: areaName,
      itemCount: stats.count,
      totalUnits: Math.round(stats.totalUnits * 10) / 10,
      totalValueCents: stats.totalValueCents,
      belowParCount: stats.belowParCount,
    })).sort((a, b) => a.area.localeCompare(b.area));

    const cleanArea = area?.trim().toLowerCase();
    const filtered = (cleanArea && cleanArea !== 'all')
      ? allItems.filter(item => {
          const itemArea = (item.area?.trim() || 'unassigned').toLowerCase();
          return itemArea === cleanArea;
        })
      : allItems;

    const sorted = filtered.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      items: sorted.map(mapItem),
      lowStockCount: filtered.filter((item) => item.onHand <= item.parLevel * multiplier).length,
      totalValueCents: filtered.reduce(
        (sum, item) => sum + Math.round(item.onHand * (item.unitCostCents ?? 0)),
        0,
      ),
      locationSummaries,
      activeMultiplier: multiplier,
    };
  }

  @RequireSubscription('active')
  @Post()
  async upsertBarItem(@CurrentUser() user: AuthUser, @Body() body: UpsertBarItemDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Item name is required');
    const normalizedName = normalizeInventoryName(name);
    const payload = {
      venueId,
      name,
      normalizedName,
      category: body.category,
      area: cleanText(body.area) ?? null,
      unit: body.unit.trim() || 'unit',
      parLevel: Math.max(0, body.parLevel),
      onHand: Math.max(0, body.onHand),
      unitCostCents:
        body.unitCostCents === undefined ? null : Math.max(0, Math.round(body.unitCostCents)),
      supplier: cleanText(body.supplier) ?? null,
      sku: cleanText(body.sku) ?? null,
      notes: cleanText(body.notes) ?? null,
      updatedAt: now,
    };
    try {
      if (body.itemId) {
        const existing = await this.prisma.barInventoryItem.findFirst({
          where: { id: body.itemId, venueId },
        });
        if (!existing) throw new NotFoundException('Item not found');
        const updated = await this.prisma.barInventoryItem.update({
          where: { id: existing.id },
          data: payload,
        });
        return mapItem(updated);
      }
      const created = await this.prisma.barInventoryItem.create({
        data: { ...payload, createdAt: now },
      });
      return mapItem(created);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('An inventory item with this name already exists.');
      }
      throw error;
    }
  }

  @RequireSubscription('active')
  @Post(':id/movement')
  async recordBarStockMovement(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Body() body: RecordMovementDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    // Format notes with waste reasons or transfer details if provided
    let formattedNotes = cleanText(body.notes) ?? null;
    if (body.wasteReason) {
      formattedNotes = `[waste:${body.wasteReason}] ${formattedNotes || ''}`.trim();
    }
    if (body.fromArea || body.toArea) {
      formattedNotes = `[transfer:${body.fromArea || 'any'}->${body.toArea || 'any'}] ${formattedNotes || ''}`.trim();
    }

    // Counts are reconciliation records and remain synchronous. Negative movements
    // are the halftime hot path and are persisted by the consumer in order.
    if (this.asyncWrites?.isEnabled?.() && body.movementType !== 'count' && body.quantity < 0) {
      const key = (idempotencyKey ?? '').trim() || crypto.randomUUID();
      return this.asyncWrites.enqueue('inventory_decrement', key, {
        itemId, venueId, movementType: body.movementType, quantity: body.quantity,
        notes: formattedNotes, createdBy: profile.id,
      });
    }
    const { movement, item, previousOnHand, nextOnHand } = await this.prisma.$transaction(async (tx) => {
      const lockKey = `bar-inventory-${itemId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const item = await tx.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
      if (!item) throw new NotFoundException('Item not found');
      const previousOnHand = item.onHand;
      const nextOnHand =
        body.movementType === 'count'
          ? Math.max(0, body.quantity)
          : Math.max(0, previousOnHand + body.quantity);
      const appliedQuantity = nextOnHand - previousOnHand;
      const now = new Date();
      await tx.barInventoryItem.update({
        where: { id: item.id },
        data: {
          onHand: nextOnHand,
          lastCountedAt: body.movementType === 'count' ? now : item.lastCountedAt,
          updatedAt: now,
        },
      });
      const movement = await tx.barInventoryMovement.create({
        data: {
          venueId,
          itemId: item.id,
          movementType: body.movementType,
          quantity: appliedQuantity,
          requestedQuantity: body.quantity,
          appliedQuantity,
          previousOnHand,
          nextOnHand,
          notes: formattedNotes,
          createdBy: profile.id,
          createdAt: now,
        },
      });
      return { movement, item, previousOnHand, nextOnHand };
    });

    // Fire-and-forget alerts after the transaction commits
    void this.fireInventoryAlerts({ venueId, item, previousOnHand, nextOnHand, movementType: body.movementType, quantity: body.quantity });

    return { _id: movement.id };
  }

  @RequireSubscription('active')
  @Post('transfer')
  async recordLocationTransfer(
    @CurrentUser() user: AuthUser,
    @Body() body: RecordTransferDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({
      where: { id: body.itemId, venueId },
    });
    if (!item) throw new NotFoundException('Item not found');

    const now = new Date();
    const transferNotes = `[transfer:${body.fromArea}->${body.toArea}] (qty: ${body.quantity}) ${body.notes ? body.notes.trim() : ''}`.trim();
    const movement = await this.prisma.barInventoryMovement.create({
      data: {
        venueId,
        itemId: item.id,
        movementType: 'transfer',
        quantity: 0, // In-venue redistribution
        requestedQuantity: body.quantity,
        appliedQuantity: 0,
        previousOnHand: item.onHand,
        nextOnHand: item.onHand,
        notes: transferNotes,
        createdBy: profile.id,
        createdAt: now,
      },
    });
    return { _id: movement.id, success: true };
  }

  @RequireSubscription('active')
  @Post('batch-count')
  async recordBatchCount(
    @CurrentUser() user: AuthUser,
    @Body() body: BatchCountDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();

    const counts = body.counts ?? [];
    if (!counts.length) {
      return { updatedCount: 0, success: true };
    }

    const itemIds = counts.map((c) => c.itemId);
    const items = await this.prisma.barInventoryItem.findMany({
      where: { id: { in: itemIds }, venueId },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const countResults = await this.prisma.$transaction(async (tx) => {
      const movements = [];
      for (const count of counts) {
        const item = itemMap.get(count.itemId);
        if (!item) continue;

        const previousOnHand = item.onHand;
        const nextOnHand = Math.max(0, count.countedQuantity);
        const appliedQuantity = nextOnHand - previousOnHand;

        await tx.barInventoryItem.update({
          where: { id: item.id },
          data: {
            onHand: nextOnHand,
            lastCountedAt: now,
            updatedAt: now,
          },
        });

        const movement = await tx.barInventoryMovement.create({
          data: {
            venueId,
            itemId: item.id,
            movementType: 'count',
            quantity: appliedQuantity,
            requestedQuantity: count.countedQuantity,
            appliedQuantity,
            previousOnHand,
            nextOnHand,
            notes: body.area ? `[zone_audit:${body.area}]` : '[batch_count]',
            createdBy: profile.id,
            createdAt: now,
          },
        });
        movements.push(movement);
      }
      return movements;
    });

    return { updatedCount: countResults.length, success: true };
  }

  @RequireSubscription('active')
  @Post('import')
  async importParsedBarItems(@CurrentUser() user: AuthUser, @Body() body: ImportParsedBarItemsDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = body.items ?? [];
    const seenNames = new Set<string>();
    const writes = [];
    let imported = 0;
    for (const item of items.slice(0, MAX_IMPORT_ITEMS)) {
      const name = item.name?.trim() ?? '';
      if (!name) continue;
      const nameKey = normalizeInventoryName(name);
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      const now = new Date();
      const payload = {
        venueId,
        name,
        normalizedName: nameKey,
        category: item.category,
        area: cleanText(item.area) ?? null,
        unit: item.unit?.trim() || 'unit',
        parLevel: Math.max(0, item.parLevel ?? 0),
        onHand: Math.max(0, item.onHand ?? 0),
        unitCostCents:
          item.unitCostCents === undefined ? null : Math.max(0, Math.round(item.unitCostCents)),
        supplier: cleanText(item.supplier) ?? null,
        sku: cleanText(item.sku) ?? null,
        notes: cleanText(item.notes) ?? null,
        updatedAt: now,
      };
      writes.push(this.prisma.barInventoryItem.upsert({
        where: { venueId_normalizedName: { venueId, normalizedName: nameKey } },
        create: { ...payload, createdAt: now },
        update: payload,
      }));
      imported += 1;
    }
    if (writes.length) {
      await this.prisma.$transaction(writes);
    }
    return { imported };
  }

  @RequireSubscription('active')
  @Post('parse')
  async parseBarInventoryInput(
    @CurrentUser() user: AuthUser,
    @Body() body: ParseBarInventoryInputDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    await assertWithinSharedRateLimit(
      this.prisma,
      `ai-parse:bar-inventory:${profile.venueId}`,
      AI_PARSE_RATE_LIMIT_MAX,
      AI_PARSE_RATE_LIMIT_WINDOW_MS,
      'Too many AI parse requests. Try again in a few minutes.',
    );
    return this.parser.parse(body);
  }

  // ── Usage velocity ───────────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('velocity')
  async getUsageVelocity(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      take: 300,
    });
    const depletions = await this.prisma.barInventoryMovement.findMany({
      where: {
        venueId,
        createdAt: { gte: fourWeeksAgo },
        movementType: { in: ['waste', 'comp', 'transfer'] },
      },
      select: { itemId: true, quantity: true, createdAt: true },
    });
    const countMovements = await this.prisma.barInventoryMovement.findMany({
      where: {
        venueId,
        createdAt: { gte: fourWeeksAgo },
        movementType: 'count',
      },
      select: { itemId: true, quantity: true, previousOnHand: true, createdAt: true },
    });
    const usageByItem = new Map<string, number>();
    for (const d of depletions) {
      usageByItem.set(d.itemId, (usageByItem.get(d.itemId) ?? 0) + Math.abs(d.quantity));
    }
    for (const c of countMovements) {
      const impliedUsage = c.previousOnHand - c.quantity;
      if (impliedUsage > 0) {
        usageByItem.set(c.itemId, (usageByItem.get(c.itemId) ?? 0) + impliedUsage);
      }
    }
    const weeks = 4;
    return items.map((item) => {
      const totalUsed = usageByItem.get(item.id) ?? 0;
      const perWeek = totalUsed / weeks;
      const daysUntilEmpty = perWeek > 0 ? Math.round((item.onHand / (perWeek / 7)) * 10) / 10 : null;
      return {
        _id: item.id,
        name: item.name,
        category: item.category,
        onHand: item.onHand,
        parLevel: item.parLevel,
        unit: item.unit,
        usageLast4Weeks: Math.round(totalUsed * 10) / 10,
        perWeek: Math.round(perWeek * 10) / 10,
        daysUntilEmpty,
      };
    });
  }

  // ── Stock CSV export ─────────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('export-csv')
  async exportStockCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = await this.prisma.barInventoryItem.findMany({
      where: { venueId },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const headers = ['Name', 'Category', 'Area', 'Unit', 'On Hand', 'Par Level', 'Unit Cost ($)', 'Supplier', 'SKU', 'Last Counted'];
    const rows = [headers.map(csvCell).join(',')];
    for (const item of items) {
      rows.push([
        csvCell(item.name),
        csvCell(item.category),
        csvCell(item.area),
        csvCell(item.unit),
        csvCell(item.onHand),
        csvCell(item.parLevel),
        csvCell(item.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : ''),
        csvCell(item.supplier),
        csvCell(item.sku),
        csvCell(item.lastCountedAt ? item.lastCountedAt.toISOString().slice(0, 10) : ''),
      ].join(','));
    }
    return rows.join('\n');
  }

  // ── Movement log CSV export ──────────────────────────────────────────
  @RequireSubscription('active')
  @Get('movements/export-csv')
  async exportMovementsCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const movements = await this.prisma.barInventoryMovement.findMany({
      where: { venueId, createdAt: { gte: twoWeeksAgo } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const itemIds = Array.from(new Set(movements.map((m) => m.itemId)));
    const profileIds = Array.from(new Set(movements.map((m) => m.createdBy).filter(Boolean)));
    const [items, profiles] = await Promise.all([
      itemIds.length ? this.prisma.barInventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }) : [],
      profileIds.length ? this.prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const itemName = new Map(items.map((i) => [i.id, i.name]));
    const profileName = new Map(profiles.map((p) => [p.id, p.fullName]));
    const headers = ['Date', 'Item', 'Type', 'Quantity', 'Before', 'After', 'By', 'Notes'];
    const rows = [headers.map(csvCell).join(',')];
    for (const m of movements) {
      rows.push([
        csvCell(m.createdAt.toISOString().slice(0, 19).replace('T', ' ')),
        csvCell(itemName.get(m.itemId) ?? m.itemId),
        csvCell(m.movementType),
        csvCell(m.quantity),
        csvCell(m.previousOnHand),
        csvCell(m.nextOnHand),
        csvCell(profileName.get(m.createdBy) ?? m.createdBy),
        csvCell(m.notes),
      ].join(','));
    }
    return rows.join('\n');
  }

  // ── Shrinkage / variance report ──────────────────────────────────────
  @RequireSubscription('active')
  @Get('shrinkage')
  async getShrinkageReport(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    return this.reports.shrinkageReport(profile.venueId!);
  }

  // ── Purchase order draft ─────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('purchase-order')
  async getPurchaseOrder(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    return this.reports.purchaseOrder(profile.venueId!);
  }

  // ── Purchase order CSV ───────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('purchase-order/export-csv')
  async exportPurchaseOrderCsv(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    return this.reports.purchaseOrderCsv(profile.venueId!);
  }

  // ── SKU lookup for barcode scanning ──────────────────────────────────
  @RequireSubscription('active')
  @Get('sku/:sku')
  async lookupBySku(@CurrentUser() user: AuthUser, @Param('sku') sku: string) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({
      where: { venueId, sku },
    });
    if (!item) throw new NotFoundException('No item found with that SKU');
    return mapItem(item);
  }

  // ── Update unit cost (tracks history via correction movement) ─────────
  @RequireSubscription('active')
  @Patch(':id/cost')
  async updateItemCost(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Body() body: UpdateCostDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
    if (!item) throw new NotFoundException('Item not found');
    const oldCost = item.unitCostCents ?? 0;
    const newCost = Math.max(0, Math.round(body.unitCostCents));
    if (oldCost === newCost) return mapItem(item);
    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.barInventoryItem.update({
        where: { id: item.id },
        data: { unitCostCents: newCost, updatedAt: now },
      }),
      // Write a zero-quantity correction so cost history is queryable from movement log
      this.prisma.barInventoryMovement.create({
        data: {
          venueId,
          itemId: item.id,
          movementType: 'correction',
          quantity: 0,
          previousOnHand: item.onHand,
          nextOnHand: item.onHand,
          notes: `cost_change:${oldCost}:${newCost}`,
          createdBy: profile.id,
          createdAt: now,
        },
      }),
    ]);
    return mapItem(updated);
  }

  // ── Cost history (from correction movements) ──────────────────────────
  @RequireSubscription('active')
  @Get('cost-history/:id')
  async getCostHistory(@CurrentUser() user: AuthUser, @Param('id') itemId: string) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
    if (!item) throw new NotFoundException('Item not found');
    const movements = await this.prisma.barInventoryMovement.findMany({
      where: { itemId, venueId, movementType: 'correction', notes: { startsWith: 'cost_change:' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const profileIds = Array.from(new Set(movements.map((m) => m.createdBy).filter(Boolean)));
    const profiles = profileIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, fullName: true } })
      : [];
    const nameById = new Map(profiles.map((p) => [p.id, p.fullName]));
    const entries = movements.map((m) => {
      const parts = (m.notes ?? '').split(':');
      const oldCost = Number(parts[1] ?? 0);
      const newCost = Number(parts[2] ?? 0);
      return {
        _id: m.id,
        oldCostCents: oldCost,
        newCostCents: newCost,
        changedBy: nameById.get(m.createdBy) ?? m.createdBy,
        createdAt: m.createdAt.getTime(),
      };
    });
    return { itemName: item.name, currentCostCents: item.unitCostCents, entries };
  }

  // ── Stock aging report ───────────────────────────────────────────────
  @RequireSubscription('active')
  @Get('aging')
  async getAgingReport(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    return this.reports.agingReport(profile.venueId!);
  }

  // ── Send purchase order email ─────────────────────────────────────────
  @RequireSubscription('active')
  @Get('prep-board')
  async listPrepBoard(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const items = await this.prisma.prepBoardItem.findMany({
      where: { venueId: profile.venueId!, status: { not: 'cancelled' } },
      orderBy: [{ status: 'asc' }, { kind: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return {
      items: items.map(mapPrepBoardItem),
      openCount: items.filter((item) => item.status === 'open').length,
      eightySixCount: items.filter((item) => item.status === 'open' && item.kind === 'eighty_six').length,
      prepCount: items.filter((item) => item.status === 'open' && item.kind === 'prep').length,
    };
  }

  @RequireSubscription('active')
  @Post('prep-board')
  async upsertPrepBoardItem(@CurrentUser() user: AuthUser, @Body() body: UpsertPrepBoardItemDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Prep item title is required');
    const now = new Date();
    const status = body.status ?? 'open';
    const payload = {
      venueId,
      kind: body.kind,
      title,
      quantity: body.quantity == null ? null : Math.max(0, body.quantity),
      unit: cleanText(body.unit) ?? null,
      station: cleanText(body.station) ?? null,
      notes: cleanText(body.notes) ?? null,
      dueDate: cleanText(body.dueDate) ?? null,
      status,
      completedBy: status === 'done' ? profile.id : null,
      completedAt: status === 'done' ? now : null,
      updatedAt: now,
    };
    if (body.itemId) {
      const existing = await this.prisma.prepBoardItem.findFirst({ where: { id: body.itemId, venueId } });
      if (!existing) throw new NotFoundException('Prep item not found');
      const updated = await this.prisma.prepBoardItem.update({
        where: { id: existing.id },
        data: payload,
      });
      return mapPrepBoardItem(updated);
    }
    const created = await this.prisma.prepBoardItem.create({
      data: { ...payload, createdBy: profile.id, createdAt: now },
    });
    return mapPrepBoardItem(created);
  }

  @RequireSubscription('active')
  @Patch('prep-board/:id/status')
  async updatePrepBoardItemStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Body() body: UpdatePrepBoardItemStatusDto,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const existing = await this.prisma.prepBoardItem.findFirst({ where: { id: itemId, venueId } });
    if (!existing) throw new NotFoundException('Prep item not found');
    const now = new Date();
    const updated = await this.prisma.prepBoardItem.update({
      where: { id: existing.id },
      data: {
        status: body.status,
        completedBy: body.status === 'done' ? profile.id : null,
        completedAt: body.status === 'done' ? now : null,
        updatedAt: now,
      },
    });
    return mapPrepBoardItem(updated);
  }

  @RequireSubscription('active')
  @Post('purchase-order/send-email')
  async sendPurchaseOrderEmail(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const items = await this.prisma.barInventoryItem.findMany({ where: { venueId }, orderBy: [{ supplier: 'asc' }, { name: 'asc' }], take: 500 });
    const belowPar = items.filter((i) => i.onHand < i.parLevel);
    if (belowPar.length === 0) return { sent: false, reason: 'All items at or above par — nothing to order.' };

    const bySupplier = new Map<string, typeof belowPar>();
    for (const item of belowPar) {
      const supplier = item.supplier?.trim() || 'Unspecified';
      const group = bySupplier.get(supplier) ?? [];
      group.push(item);
      bySupplier.set(supplier, group);
    }

    let grandTotal = 0;
    const supplierSections = Array.from(bySupplier.entries()).map(([supplier, groupItems]) => {
      const rows = groupItems.map((item) => {
        const qty = Math.ceil(item.parLevel - item.onHand);
        const lineTotal = item.unitCostCents != null ? qty * item.unitCostCents : null;
        if (lineTotal != null) grandTotal += lineTotal;
        return `<tr><td>${htmlEscape(item.name)}</td><td>${htmlEscape(item.sku ?? '—')}</td><td>${htmlEscape(item.unit)}</td><td>${item.onHand}</td><td>${item.parLevel}</td><td><strong>${qty}</strong></td><td>${lineTotal != null ? '$' + (lineTotal / 100).toFixed(2) : '—'}</td></tr>`;
      }).join('');
      return `<h3>${htmlEscape(supplier)}</h3><table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>Item</th><th>SKU</th><th>Unit</th><th>On Hand</th><th>Par</th><th>Order Qty</th><th>Est. Cost</th></tr>${rows}</table>`;
    }).join('<br>');

    const venueName = profile.venue?.name ?? 'Your venue';
    const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const html = `<h2>Purchase Order — ${htmlEscape(venueName)}</h2><p>Generated ${date} · ${belowPar.length} items below par</p>${supplierSections}${grandTotal > 0 ? `<p><strong>Estimated total: $${(grandTotal / 100).toFixed(2)}</strong></p>` : ''}`;
    const text = `Purchase Order — ${venueName}\n${date} · ${belowPar.length} items below par\n\n${belowPar.map((i) => `${i.supplier ?? 'Unspecified'}: ${i.name} — order ${Math.ceil(i.parLevel - i.onHand)} ${i.unit}`).join('\n')}${grandTotal > 0 ? `\n\nEst. total: $${(grandTotal / 100).toFixed(2)}` : ''}`;

    await this.email.sendToVenueManagers(venueId, {
      subject: `Purchase Order — ${venueName} (${belowPar.length} items)`,
      text,
      html,
    });
    return { sent: true, itemCount: belowPar.length };
  }

  // ── Inventory digest email ────────────────────────────────────────────
  @RequireSubscription('active')
  @Post('send-digest')
  async sendInventoryDigest(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [items, movements] = await Promise.all([
      this.prisma.barInventoryItem.findMany({ where: { venueId }, take: 500 }),
      this.prisma.barInventoryMovement.findMany({
        where: { venueId, createdAt: { gte: thirtyDaysAgo } },
        select: { itemId: true, movementType: true, quantity: true },
      }),
    ]);

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const belowPar = items.filter((i) => i.onHand < i.parLevel);
    const uncounted = items.filter((i) => !i.lastCountedAt || i.lastCountedAt < sevenDaysAgo);

    let wasteCents = 0;
    let compCents = 0;
    for (const m of movements) {
      const item = itemMap.get(m.itemId);
      if (!item) continue;
      const cost = item.unitCostCents ?? 0;
      if (m.movementType === 'waste') wasteCents += Math.abs(m.quantity) * cost;
      if (m.movementType === 'comp') compCents += Math.abs(m.quantity) * cost;
    }

    const venueName = profile.venue?.name ?? 'Your venue';
    const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const belowParLines = belowPar.slice(0, 20).map((i) => `  • ${i.name}: ${i.onHand} ${i.unit} on hand (par ${i.parLevel})`).join('\n');
    const text = [
      `📊 Inventory Digest — ${venueName}`,
      date,
      '',
      `Below par: ${belowPar.length} item${belowPar.length !== 1 ? 's' : ''}`,
      belowParLines || '  (none)',
      '',
      `30-day shrinkage: waste $${(wasteCents / 100).toFixed(2)} · comp $${(compCents / 100).toFixed(2)} · total $${((wasteCents + compCents) / 100).toFixed(2)}`,
      '',
      `Items not counted in 7+ days: ${uncounted.length}`,
      `Total items tracked: ${items.length}`,
    ].join('\n');

    const html = `
      <h2>Inventory Digest — ${htmlEscape(venueName)}</h2>
      <p>${date}</p>
      <h3>Below par (${belowPar.length} items)</h3>
      ${belowPar.length === 0 ? '<p>All items at or above par.</p>' : `<ul>${belowPar.slice(0, 20).map((i) => `<li>${htmlEscape(i.name)}: ${i.onHand} ${htmlEscape(i.unit)} (par ${i.parLevel})</li>`).join('')}${belowPar.length > 20 ? `<li>…and ${belowPar.length - 20} more</li>` : ''}</ul>`}
      <h3>30-day shrinkage</h3>
      <p>Waste: <strong>$${(wasteCents / 100).toFixed(2)}</strong> · Comp: <strong>$${(compCents / 100).toFixed(2)}</strong> · Total: <strong>$${((wasteCents + compCents) / 100).toFixed(2)}</strong></p>
      <h3>Inventory health</h3>
      <p>Items not counted in 7+ days: <strong>${uncounted.length}</strong> · Total items tracked: <strong>${items.length}</strong></p>
    `;

    await this.email.sendToVenueManagers(venueId, {
      subject: `Inventory Digest — ${venueName} · ${belowPar.length} below par`,
      text,
      html,
    });

    await this.notifications.notifyManagers({
      venueId,
      kind: 'inventory_digest',
      title: 'Inventory digest sent',
      body: `${belowPar.length} items below par · $${((wasteCents + compCents) / 100).toFixed(2)} shrinkage (30d)`,
    });

    return { sent: true, belowParCount: belowPar.length, shrinkageCents: wasteCents + compCents };
  }

  // ── Movement history (parameterized — must come after literal routes) ─
  @RequireSubscription('active')
  @Get(':id/movements')
  async getItemMovements(
    @CurrentUser() user: AuthUser,
    @Param('id') itemId: string,
    @Query('limit') limitParam?: string,
  ) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const item = await this.prisma.barInventoryItem.findFirst({ where: { id: itemId, venueId } });
    if (!item) throw new NotFoundException('Item not found');
    const limit = Math.min(Math.max(1, Number(limitParam) || 50), 200);
    const movements = await this.prisma.barInventoryMovement.findMany({
      where: { itemId, venueId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const profileIds = Array.from(new Set(movements.map((m) => m.createdBy).filter(Boolean)));
    const profiles = profileIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, fullName: true } })
      : [];
    const nameById = new Map(profiles.map((p) => [p.id, p.fullName]));
    return {
      itemName: item.name,
      movements: movements.map((m) => ({
        _id: m.id,
        movementType: m.movementType,
        quantity: m.quantity,
        previousOnHand: m.previousOnHand,
        nextOnHand: m.nextOnHand,
        notes: m.notes,
        createdBy: nameById.get(m.createdBy) ?? m.createdBy,
        createdAt: m.createdAt.getTime(),
      })),
    };
  }

  private fireInventoryAlerts(args: {
    venueId: string;
    item: { id: string; name: string; parLevel: number; unitCostCents: number | null };
    previousOnHand: number;
    nextOnHand: number;
    movementType: string;
    quantity: number;
  }) {
    void this.fireInventoryAlertsInBackground(args).catch((error) => {
      this.logger.error(
        `Inventory alert delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  private async fireInventoryAlertsInBackground(args: {
    venueId: string;
    item: { id: string; name: string; parLevel: number; unitCostCents: number | null };
    previousOnHand: number;
    nextOnHand: number;
    movementType: string;
    quantity: number;
  }) {
    const { venueId, item, previousOnHand, nextOnHand, movementType, quantity } = args;

    // Low-stock alert: just crossed below par
    if (previousOnHand >= item.parLevel && nextOnHand < item.parLevel) {
      await this.notifications.notifyManagers({
        venueId,
        kind: 'inventory_low_stock',
        title: `Low stock: ${item.name}`,
        body: `${nextOnHand} ${nextOnHand === 1 ? 'unit' : 'units'} remaining (par ${item.parLevel})`,
      });
    }

    // Large waste/comp alert: loss > $50 in cost
    if ((movementType === 'waste' || movementType === 'comp') && item.unitCostCents != null) {
      const lossCents = Math.abs(quantity) * item.unitCostCents;
      if (lossCents >= 5000) {
        await this.notifications.notifyManagers({
          venueId,
          kind: 'inventory_large_loss',
          title: `Large ${movementType} recorded`,
          body: `${Math.abs(quantity)} × ${item.name} — est. $${(lossCents / 100).toFixed(2)} loss`,
        });
      }
    }
  }

  private async getProfile(user: AuthUser) {
    return this.prisma.profile.findFirst({
      where: { userId: user.sub, ...(user.venueId ? { venueId: user.venueId } : {}) },
      include: { venue: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!canManageVenue(profile.role, profile.allAccess)) throw new ForbiddenException('Not authorized');
    return profile;
  }

  // Any active member of a venue — used for read-only inventory access. Edits
  // still go through requireManagerProfile.
  private async requireVenueProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) throw new ForbiddenException('Profile is not initialized');
    if (profile.membershipStatus !== null && profile.membershipStatus !== 'active') {
      throw new ForbiddenException('Profile is not active for this venue');
    }
    return profile;
  }
}
