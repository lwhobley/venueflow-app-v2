import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BarInventoryController } from './bar-inventory.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeProfile(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'manager-1',
    userId: 'user-1',
    venueId: 'venue-1',
    role: 'manager',
    membershipStatus: 'active',
    venue: { name: 'Test Venue' },
    ...overrides,
  };
}

function makeItem(overrides: Partial<Record<string, any>> = {}) {
  const now = new Date('2026-07-10T00:00:00.000Z');
  return {
    id: 'item-1',
    venueId: 'venue-1',
    name: 'House Vodka',
    normalizedName: 'house vodka',
    category: 'spirit',
    area: 'Bar 1',
    unit: 'bottle',
    parLevel: 4,
    onHand: 2,
    unitCostCents: 1800,
    supplier: 'Acme Distributing',
    sku: 'HV-1',
    notes: null,
    lastCountedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePrepItem(overrides: Partial<Record<string, any>> = {}) {
  const now = new Date('2026-07-10T00:00:00.000Z');
  return {
    id: 'prep-1',
    venueId: 'venue-1',
    kind: 'prep',
    title: 'Cut limes',
    quantity: 1,
    unit: 'case',
    station: 'Well',
    notes: null,
    dueDate: null,
    status: 'open',
    createdBy: 'manager-1',
    completedBy: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeController() {
  const prisma: any = {
    profile: {
      findUnique: vi.fn().mockResolvedValue(makeProfile()),
      findFirst: vi.fn().mockImplementation((args: any) => prisma.profile.findUnique(args)),
      findMany: vi.fn().mockResolvedValue([]),
    },
    barInventoryItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: any) => Promise.resolve(makeItem(args.data))),
      update: vi.fn().mockImplementation((args: any) => Promise.resolve(makeItem(args.data))),
      upsert: vi.fn().mockImplementation((args: any) => Promise.resolve(makeItem(args.update))),
    },
    barInventoryMovement: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'movement-1', ...args.data })),
    },
    prepBoardItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: any) => Promise.resolve(makePrepItem(args.data))),
      update: vi.fn().mockImplementation((args: any) => Promise.resolve(makePrepItem(args.data))),
    },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );

  const notifications = { notifyManagers: vi.fn().mockResolvedValue(undefined) };
  const email = { sendToVenueManagers: vi.fn().mockResolvedValue(undefined) };
  const parser = { parse: vi.fn() };
  const reports = {
    shrinkageReport: vi.fn().mockResolvedValue({ ok: 'shrinkage' }),
    purchaseOrder: vi.fn().mockResolvedValue({ ok: 'purchase-order' }),
    purchaseOrderCsv: vi.fn().mockResolvedValue('csv'),
    agingReport: vi.fn().mockResolvedValue({ ok: 'aging' }),
  };
  const asyncWrites = { isEnabled: vi.fn().mockReturnValue(false), enqueue: vi.fn(), markResult: vi.fn() };
  const controller = new BarInventoryController(prisma, notifications as any, email as any, parser as any, reports as any, asyncWrites as any);
  return { controller, prisma, notifications, email, parser, reports, asyncWrites };
}

const managerUser = { sub: 'user-1' } as any;
const staffUser = { sub: 'user-2' } as any;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BarInventoryController', () => {
  describe('authorization — read access (requireVenueProfile)', () => {
    it('rejects when the caller has no profile at all', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(null);

      await expect(controller.getBarStock(managerUser)).rejects.toThrow('Profile is not initialized');
    });

    it('rejects when the profile has no venueId', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ venueId: null }));

      await expect(controller.getBarStock(managerUser)).rejects.toThrow('Profile is not initialized');
    });

    it('rejects an inactive membership', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ membershipStatus: 'removed' }));

      await expect(controller.getBarStock(managerUser)).rejects.toThrow('Profile is not active for this venue');
    });

    it('allows staff (non-manager) members to read stock', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ id: 'staff-1', role: 'staff' }));
      prisma.barInventoryItem.findMany.mockResolvedValue([makeItem()]);

      const result = await controller.getBarStock(staffUser);

      expect(result.items).toHaveLength(1);
      expect(prisma.barInventoryItem.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    });

    it('calculates stock metrics across the complete result set', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findMany.mockResolvedValue([
        makeItem({ id: 'a', onHand: 2, parLevel: 4, unitCostCents: 1000 }),
        makeItem({ id: 'b', onHand: 10, parLevel: 3, unitCostCents: 250 }),
      ]);

      const result = await controller.getBarStock(managerUser);

      expect(result.lowStockCount).toBe(1);
      expect(result.totalValueCents).toBe(4500);
    });
  });

  describe('authorization — manager-only mutations (requireManagerProfile)', () => {
    it('rejects staff role from upsertBarItem', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ id: 'staff-1', role: 'staff' }));

      await expect(
        controller.upsertBarItem(staffUser, {
          name: 'Gin',
          category: 'spirit',
          unit: 'bottle',
          parLevel: 4,
          onHand: 2,
        } as any),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.upsertBarItem(staffUser, {
          name: 'Gin',
          category: 'spirit',
          unit: 'bottle',
          parLevel: 4,
          onHand: 2,
        } as any),
      ).rejects.toThrow('Not authorized');
    });

    it('rejects a missing scope from recordBarStockMovement', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUnique.mockResolvedValue(null);

      await expect(
        controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'count', quantity: 3 } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows manager, owner, and admin roles', async () => {
      for (const role of ['manager', 'owner', 'admin']) {
        const { controller, prisma } = makeController();
        prisma.profile.findUnique.mockResolvedValue(makeProfile({ role }));
        prisma.barInventoryItem.findFirst.mockResolvedValue(null);
        prisma.barInventoryItem.create.mockResolvedValue(makeItem());

        const result = await controller.upsertBarItem(managerUser, {
          name: 'Gin',
          category: 'spirit',
          unit: 'bottle',
          parLevel: 4,
          onHand: 2,
        } as any);

        expect(result._id).toBe('item-1');
      }
    });
  });

  describe('tenant isolation', () => {
    it('scopes getBarStock to the caller\'s venue', async () => {
      const { controller, prisma } = makeController();

      await controller.getBarStock(managerUser);

      expect(prisma.barInventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { venueId: 'venue-1' } }),
      );
    });

    it('scopes the movement lookup by both item id and venue id', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem());

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'count', quantity: 3 } as any);

      expect(prisma.barInventoryItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', venueId: 'venue-1' },
      });
    });

    it('treats an item outside the venue as not found (no cross-tenant leak)', async () => {
      const { controller, prisma } = makeController();
      // Simulates the item existing, but for a different venue — the scoped
      // query in the controller would not return it.
      prisma.barInventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        controller.recordBarStockMovement(managerUser, 'other-venue-item', { movementType: 'count', quantity: 3 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes updateItemCost lookups by venue', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(null);

      await expect(controller.updateItemCost(managerUser, 'item-1', { unitCostCents: 1000 } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.barInventoryItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', venueId: 'venue-1' },
      });
    });
  });

  describe('upsertBarItem', () => {
    it('creates a new item with normalized/clamped values', async () => {
      const { controller, prisma } = makeController();

      await controller.upsertBarItem(managerUser, {
        name: '  New Item  ',
        category: 'spirit',
        unit: '  Bottle  ',
        parLevel: -5,
        onHand: -1,
      } as any);

      expect(prisma.barInventoryItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          venueId: 'venue-1',
          name: 'New Item',
          normalizedName: 'new item',
          unit: 'Bottle',
          parLevel: 0,
          onHand: 0,
          unitCostCents: null,
        }),
      });
    });

    it('updates an existing item scoped by venue', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem());

      await controller.upsertBarItem(managerUser, {
        itemId: 'item-1',
        name: 'House Vodka',
        category: 'spirit',
        unit: 'bottle',
        parLevel: 4,
        onHand: 6,
      } as any);

      expect(prisma.barInventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({ onHand: 6 }),
      });
    });

    it('throws NotFoundException when itemId does not match an existing item', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        controller.upsertBarItem(managerUser, {
          itemId: 'missing',
          name: 'House Vodka',
          category: 'spirit',
          unit: 'bottle',
          parLevel: 4,
          onHand: 6,
        } as any),
      ).rejects.toThrow('Item not found');
    });

    it('rejects a blank name', async () => {
      const { controller } = makeController();

      await expect(
        controller.upsertBarItem(managerUser, {
          name: '   ',
          category: 'spirit',
          unit: 'bottle',
          parLevel: 4,
          onHand: 6,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns a conflict when a normalized item name already exists', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.create.mockRejectedValue({ code: 'P2002' });

      await expect(controller.upsertBarItem(managerUser, {
        name: '  HOUSE VODKA ', category: 'spirit', unit: 'bottle', parLevel: 4, onHand: 6,
      } as any)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('recordBarStockMovement', () => {
    it('acquires a per-item advisory lock before reading the item', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem());

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'count', quantity: 3 } as any);

      expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'bar-inventory-item-1');
    });

    it('sets onHand directly (clamped at 0) for a "count" movement', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ onHand: 10 }));

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'count', quantity: -5 } as any);

      expect(prisma.barInventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({ onHand: 0, lastCountedAt: expect.any(Date) }),
      });
    });

    it('adds the delta to onHand (clamped at 0) for additive movement types', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ onHand: 10, lastCountedAt: null }));

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'received', quantity: 5 } as any);

      expect(prisma.barInventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({ onHand: 15, lastCountedAt: null }),
      });
    });

    it('clamps additive movements at 0 instead of going negative', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ onHand: 2 }));

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'waste', quantity: -10 } as any);

      expect(prisma.barInventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({ onHand: 0 }),
      });
    });

    it('persists previousOnHand/nextOnHand and the acting profile on the movement row', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ onHand: 10 }));

      const result = await controller.recordBarStockMovement(managerUser, 'item-1', {
        movementType: 'received',
        quantity: 5,
        notes: '  delivery  ',
      } as any);

      expect(prisma.barInventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          venueId: 'venue-1',
          itemId: 'item-1',
          movementType: 'received',
          quantity: 5,
          previousOnHand: 10,
          nextOnHand: 15,
          notes: 'delivery',
          createdBy: 'manager-1',
        }),
      });
      expect(result).toEqual({ _id: 'movement-1' });
    });

    it('throws NotFoundException when the item cannot be found inside the transaction', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        controller.recordBarStockMovement(managerUser, 'missing', { movementType: 'count', quantity: 3 } as any),
      ).rejects.toThrow('Item not found');
      expect(prisma.barInventoryMovement.create).not.toHaveBeenCalled();
    });

    it('fires a low-stock alert when the movement crosses below par', async () => {
      const { controller, prisma, notifications } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ onHand: 5, parLevel: 5 }));

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'count', quantity: 3 } as any);

      expect(notifications.notifyManagers).toHaveBeenCalledWith(
        expect.objectContaining({ venueId: 'venue-1', kind: 'inventory_low_stock' }),
      );
    });

    it('does not fire a low-stock alert when the item was already below par', async () => {
      const { controller, prisma, notifications } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ onHand: 3, parLevel: 5 }));

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'count', quantity: 2 } as any);

      expect(notifications.notifyManagers).not.toHaveBeenCalled();
    });

    it('fires a large-loss alert for waste over the $50 threshold', async () => {
      const { controller, prisma, notifications } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(
        makeItem({ onHand: 1000, parLevel: 0, unitCostCents: 200 }),
      );

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'waste', quantity: -30 } as any);

      expect(notifications.notifyManagers).toHaveBeenCalledWith(
        expect.objectContaining({ venueId: 'venue-1', kind: 'inventory_large_loss' }),
      );
    });

    it('does not fire the large-loss alert under the $50 threshold', async () => {
      const { controller, prisma, notifications } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(
        makeItem({ onHand: 1000, parLevel: 0, unitCostCents: 200 }),
      );

      await controller.recordBarStockMovement(managerUser, 'item-1', { movementType: 'waste', quantity: -10 } as any);

      expect(notifications.notifyManagers).not.toHaveBeenCalled();
    });
  });

  describe('importParsedBarItems', () => {
    it('atomically upserts items by normalized venue/name', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.importParsedBarItems(managerUser, {
        items: [
          { name: 'house vodka', category: 'spirit', unit: 'bottle' } as any,
          { name: 'New Item', category: 'mixer', unit: 'case' } as any,
        ],
      });

      expect(prisma.barInventoryItem.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { venueId_normalizedName: { venueId: 'venue-1', normalizedName: 'house vodka' } },
        update: expect.objectContaining({ name: 'house vodka', normalizedName: 'house vodka' }),
      }));
      expect(prisma.barInventoryItem.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: { venueId_normalizedName: { venueId: 'venue-1', normalizedName: 'new item' } },
        create: expect.objectContaining({ name: 'New Item', normalizedName: 'new item' }),
      }));
      expect(result).toEqual({ imported: 2 });
    });

    it('skips blank-name rows and de-dupes repeated names within the batch', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.importParsedBarItems(managerUser, {
        items: [
          { name: '   ', category: 'spirit', unit: 'bottle' } as any,
          { name: 'Vodka', category: 'spirit', unit: 'bottle' } as any,
          { name: 'vodka', category: 'spirit', unit: 'bottle' } as any,
        ],
      });

      expect(prisma.barInventoryItem.upsert).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ imported: 1 });
    });

    it('caps the import batch at 100 items', async () => {
      const { controller, prisma } = makeController();
      const items = Array.from({ length: 150 }, (_, i) => ({
        name: `Item ${i}`,
        category: 'spirit',
        unit: 'bottle',
      })) as any;

      const result = await controller.importParsedBarItems(managerUser, { items });

      expect(prisma.barInventoryItem.upsert).toHaveBeenCalledTimes(100);
      expect(result).toEqual({ imported: 100 });
    });

    it('does not open a transaction when there are no valid rows', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.importParsedBarItems(managerUser, { items: [{ name: '' } as any] });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toEqual({ imported: 0 });
    });
  });

  describe('parseBarInventoryInput (AI import)', () => {
    it('rejects non-manager roles before touching the rate limit or parser', async () => {
      const { controller, prisma, parser } = makeController();
      prisma.profile.findUnique.mockResolvedValue(makeProfile({ id: 'staff-1', role: 'staff' }));

      await expect(controller.parseBarInventoryInput(staffUser, { text: 'x' })).rejects.toThrow(ForbiddenException);
      expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
      expect(parser.parse).not.toHaveBeenCalled();
    });

    it('applies the shared AI-parse rate limit scoped to the venue before calling the parser', async () => {
      const { controller, prisma, parser } = makeController();
      parser.parse.mockResolvedValue({ notes: '', items: [] });

      await controller.parseBarInventoryInput(managerUser, { text: 'Vodka x2' });

      expect(assertWithinSharedRateLimit).toHaveBeenCalledWith(
        prisma,
        'ai-parse:bar-inventory:venue-1',
        20,
        10 * 60 * 1000,
        'Too many AI parse requests. Try again in a few minutes.',
      );
    });

    it('returns the parser result unchanged', async () => {
      const { controller, parser } = makeController();
      const parsed = { notes: 'ok', items: [{ name: 'Gin', category: 'spirit', unit: 'bottle' }] };
      parser.parse.mockResolvedValue(parsed);

      const result = await controller.parseBarInventoryInput(managerUser, { text: 'Gin' });

      expect(result).toBe(parsed);
    });

    it('propagates errors thrown by the parser (e.g. missing API key)', async () => {
      const { controller, parser } = makeController();
      parser.parse.mockRejectedValue(new BadRequestException('AI parsing requires GEMINI_API_KEY configuration'));

      await expect(controller.parseBarInventoryInput(managerUser, { text: 'Gin' })).rejects.toThrow(
        'AI parsing requires GEMINI_API_KEY configuration',
      );
    });
  });

  describe('updateItemCost', () => {
    it('updates the cost and records a zero-quantity correction movement', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ unitCostCents: 1800, onHand: 7 }));
      prisma.barInventoryItem.update.mockResolvedValue(makeItem({ unitCostCents: 2200, onHand: 7 }));

      const result = await controller.updateItemCost(managerUser, 'item-1', { unitCostCents: 2200 } as any);

      expect(prisma.barInventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({ unitCostCents: 2200 }),
      });
      expect(prisma.barInventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          movementType: 'correction',
          quantity: 0,
          previousOnHand: 7,
          nextOnHand: 7,
          notes: 'cost_change:1800:2200',
        }),
      });
      expect(result.unitCostCents).toBe(2200);
    });

    it('is a no-op when the rounded cost is unchanged', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ unitCostCents: 1800 }));

      await controller.updateItemCost(managerUser, 'item-1', { unitCostCents: 1800 } as any);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.barInventoryItem.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing item', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(null);

      await expect(controller.updateItemCost(managerUser, 'missing', { unitCostCents: 100 } as any)).rejects.toThrow(
        'Item not found',
      );
    });
  });

  describe('read-only reports (representative coverage)', () => {
    it('getBarStock returns sorted items with lowStockCount and totalValueCents', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findMany.mockResolvedValue([
        makeItem({ id: 'b', name: 'Zinfandel', onHand: 10, parLevel: 2, unitCostCents: 1000 }),
        makeItem({ id: 'a', name: 'Amaro', onHand: 1, parLevel: 5, unitCostCents: 2000 }),
      ]);

      const result = await controller.getBarStock(managerUser);

      expect(result.items.map((i: any) => i.name)).toEqual(['Amaro', 'Zinfandel']);
      expect(result.lowStockCount).toBe(1);
      expect(result.totalValueCents).toBe(10 * 1000 + 1 * 2000);
    });

    it('delegates getShrinkageReport to the reports service, scoped by venue', async () => {
      const { controller, reports } = makeController();

      const result = await controller.getShrinkageReport(managerUser);

      expect(reports.shrinkageReport).toHaveBeenCalledWith('venue-1');
      expect(result).toEqual({ ok: 'shrinkage' });
    });
  });

  describe('lookupBySku', () => {
    it('throws NotFoundException when no item matches the SKU in this venue', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(null);

      await expect(controller.lookupBySku(managerUser, 'UNKNOWN')).rejects.toThrow('No item found with that SKU');
    });

    it('returns the mapped item when found', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem({ sku: 'HV-1' }));

      const result = await controller.lookupBySku(managerUser, 'HV-1');

      expect(result._id).toBe('item-1');
      expect(prisma.barInventoryItem.findFirst).toHaveBeenCalledWith({ where: { venueId: 'venue-1', sku: 'HV-1' } });
    });
  });

  describe('getItemMovements', () => {
    it('clamps the requested limit between 1 and 200', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem());

      await controller.getItemMovements(managerUser, 'item-1', '5000');

      expect(prisma.barInventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('defaults the limit to 50 when omitted', async () => {
      const { controller, prisma } = makeController();
      prisma.barInventoryItem.findFirst.mockResolvedValue(makeItem());

      await controller.getItemMovements(managerUser, 'item-1', undefined);

      expect(prisma.barInventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('prep board', () => {
    it('creates a prep item and stamps completedBy/completedAt when created directly as done', async () => {
      const { controller, prisma } = makeController();

      await controller.upsertPrepBoardItem(managerUser, {
        kind: 'eighty_six',
        title: '  86 the salmon  ',
        status: 'done',
      } as any);

      expect(prisma.prepBoardItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: '86 the salmon',
          status: 'done',
          completedBy: 'manager-1',
          completedAt: expect.any(Date),
          createdBy: 'manager-1',
        }),
      });
    });

    it('clears completedBy/completedAt when a prep item is reopened', async () => {
      const { controller, prisma } = makeController();
      prisma.prepBoardItem.findFirst.mockResolvedValue(
        makePrepItem({ status: 'done', completedBy: 'manager-1', completedAt: new Date() }),
      );

      await controller.updatePrepBoardItemStatus(managerUser, 'prep-1', { status: 'open' } as any);

      expect(prisma.prepBoardItem.update).toHaveBeenCalledWith({
        where: { id: 'prep-1' },
        data: expect.objectContaining({ status: 'open', completedBy: null, completedAt: null }),
      });
    });

    it('rejects a blank prep item title', async () => {
      const { controller } = makeController();

      await expect(
        controller.upsertPrepBoardItem(managerUser, { kind: 'prep', title: '   ' } as any),
      ).rejects.toThrow('Prep item title is required');
    });

    it('throws NotFoundException updating status of a prep item outside the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.prepBoardItem.findFirst.mockResolvedValue(null);

      await expect(
        controller.updatePrepBoardItemStatus(managerUser, 'missing', { status: 'done' } as any),
      ).rejects.toThrow('Prep item not found');
    });
  });

  describe('sendPurchaseOrderEmail', () => {
    it('returns sent:false and does not email when nothing is below par', async () => {
      const { controller, prisma, email } = makeController();
      prisma.barInventoryItem.findMany.mockResolvedValue([makeItem({ onHand: 10, parLevel: 4 })]);

      const result = await controller.sendPurchaseOrderEmail(managerUser);

      expect(result).toEqual({ sent: false, reason: 'All items at or above par — nothing to order.' });
      expect(email.sendToVenueManagers).not.toHaveBeenCalled();
    });

    it('groups below-par items by supplier and emails venue managers', async () => {
      const { controller, prisma, email } = makeController();
      prisma.barInventoryItem.findMany.mockResolvedValue([
        makeItem({ id: 'a', name: 'Gin', onHand: 1, parLevel: 4, supplier: 'Acme', unitCostCents: 500 }),
        makeItem({ id: 'b', name: 'Rum', onHand: 0, parLevel: 2, supplier: null, unitCostCents: null }),
      ]);

      const result = await controller.sendPurchaseOrderEmail(managerUser);

      expect(email.sendToVenueManagers).toHaveBeenCalledWith(
        'venue-1',
        expect.objectContaining({
          subject: expect.stringContaining('2 items'),
          html: expect.stringContaining('Acme'),
        }),
      );
      expect(result).toEqual({ sent: true, itemCount: 2 });
    });
  });

  describe('sendInventoryDigest', () => {
    it('computes 30-day shrinkage and emails + notifies managers', async () => {
      const { controller, prisma, email, notifications } = makeController();
      const item = makeItem({ id: 'a', onHand: 1, parLevel: 4, unitCostCents: 100 });
      prisma.barInventoryItem.findMany.mockResolvedValue([item]);
      prisma.barInventoryMovement.findMany.mockResolvedValue([
        { itemId: 'a', movementType: 'waste', quantity: -10 },
        { itemId: 'a', movementType: 'comp', quantity: -5 },
      ]);

      const result = await controller.sendInventoryDigest(managerUser);

      expect(email.sendToVenueManagers).toHaveBeenCalledWith(
        'venue-1',
        expect.objectContaining({ subject: expect.stringContaining('1 below par') }),
      );
      expect(notifications.notifyManagers).toHaveBeenCalledWith(
        expect.objectContaining({ venueId: 'venue-1', kind: 'inventory_digest' }),
      );
      expect(result).toEqual({ sent: true, belowParCount: 1, shrinkageCents: 1500 });
    });
  });
});
