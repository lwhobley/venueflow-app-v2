import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConcourseInventoryService } from './concourse-inventory.service';
import { EventMenuService } from './event-menu.service';

describe('ConcourseInventoryService', () => {
  let service: ConcourseInventoryService;
  let eventMenuService: EventMenuService;
  let prisma: any;
  let wsGateway: any;

  beforeEach(() => {
    prisma = {
      standSheet: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      inventoryTransferRequest: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      hawkerVendorSession: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      eventMenuOverlay: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      outlet: {
        upsert: vi.fn().mockResolvedValue({ id: 'outlet_1', code: 'STAND-101' }),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    wsGateway = {
      broadcastBeoUpdate: vi.fn(),
      broadcastReplenishment: vi.fn(),
    };

    service = new ConcourseInventoryService(prisma, wsGateway);
    eventMenuService = new EventMenuService(prisma, wsGateway);
  });

  it('calculates Stand Sheet variance accurately: (Count_In + Restocks - Count_Out - Waste) - POS_Items_Sold', async () => {
    const mockExistingSheet = {
      id: 'sheet_1',
      status: 'active_event',
      countIn: [
        { code: 'BEER-IPA', name: 'IPA Pint', count: 100, unitPriceCents: 1400 },
        { code: 'HOTDOG', name: 'Hot Dog', count: 50, unitPriceCents: 1000 },
      ],
      restocks: [
        { transferId: 't1', items: [{ code: 'BEER-IPA', quantity: 50 }] },
      ],
    };

    prisma.standSheet.findFirst.mockResolvedValue(mockExistingSheet);
    prisma.standSheet.update.mockImplementation(async ({ data }) => ({ id: 'sheet_1', ...data }));

    const result = await service.reconcileStandSheet('facility-1', 'sheet_1', {
      countOutItems: [
        { code: 'BEER-IPA', name: 'IPA Pint', count: 30, unitPriceCents: 1400 },
        { code: 'HOTDOG', name: 'Hot Dog', count: 10, unitPriceCents: 1000 },
      ],
      wasteItems: [
        { code: 'BEER-IPA', name: 'IPA Pint', count: 2, unitPriceCents: 1400 },
        { code: 'HOTDOG', name: 'Hot Dog', count: 0, unitPriceCents: 1000 },
      ],
      posItemsSold: [
        { code: 'BEER-IPA', name: 'IPA Pint', count: 118, unitPriceCents: 1400 },
        { code: 'HOTDOG', name: 'Hot Dog', count: 40, unitPriceCents: 1000 },
      ],
      actualPosRevenueCents: 205200, // 118*1400 + 40*1000 = 165200 + 40000 = 205200
    });

    // BEER-IPA: CountIn(100) + Restock(50) - CountOut(30) - Waste(2) = 118 expected. POS sold = 118 -> Variance = 0
    // HOTDOG: CountIn(50) + Restock(0) - CountOut(10) - Waste(0) = 40 expected. POS sold = 40 -> Variance = 0
    expect(result.expectedSalesRevenueCents).toBe(205200);
    expect(result.actualPosRevenueCents).toBe(205200);
    expect(result.varianceAmountCents).toBe(0);
  });

  it('handles restock transfer requests and appends restocks to active stand sheet upon completion', async () => {
    prisma.inventoryTransferRequest.create.mockResolvedValue({
      id: 't_101',
      fromOutletId: 'WH-CENTRAL-01',
      toOutletId: 'STAND-112',
      items: [{ code: 'BEER-IPA', name: 'IPA Pint', quantity: 24 }],
      status: 'pending',
    });

    const transfer = await service.submitTransferRequest({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      fromOutletId: 'WH-CENTRAL-01',
      toOutletId: 'STAND-112',
      items: [{ code: 'BEER-IPA', name: 'IPA Pint', quantity: 24 }],
    });

    expect(transfer.id).toBe('t_101');
    expect(wsGateway.broadcastReplenishment).toHaveBeenCalledOnce();

    prisma.inventoryTransferRequest.findFirst.mockResolvedValue({
      id: 't_101',
      facilityId: 'facility-1',
      toOutletId: 'STAND-112',
      items: [{ code: 'BEER-IPA', name: 'IPA Pint', quantity: 24 }],
      status: 'in_transit',
    });
    prisma.standSheet.findFirst.mockResolvedValue({ id: 'sheet_101', restocks: [] });
    prisma.inventoryTransferRequest.update.mockResolvedValue({ id: 't_101', status: 'completed' });

    const completed = await service.updateTransferStatus('facility-1', 't_101', 'completed');
    expect(completed.status).toBe('completed');
    expect(prisma.standSheet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sheet_101' },
      })
    );
  });

  it('calculates hawker vendor sales and 15% commission payout', async () => {
    prisma.hawkerVendorSession.findFirst.mockResolvedValue({
      id: 'hawker_1',
      hawkerId: 'HAWKER-88',
      itemsCheckedOut: [{ code: 'BEER-IPA', name: 'IPA Pint', quantity: 50, unitPriceCents: 1000 }],
      commissionRateBps: 1500, // 15%
      status: 'active',
    });

    prisma.hawkerVendorSession.update.mockImplementation(async ({ data }) => ({ id: 'hawker_1', ...data }));

    const settled = await service.settleHawkerSession('facility-1', 'hawker_1', {
      itemsCheckedIn: [{ code: 'BEER-IPA', quantity: 10 }], // 40 sold
      cashCollectedCents: 25000,
      cardCollectedCents: 15000,
    });

    // 40 sold * $10.00 = $400.00 (40000 cents)
    // Commission = 40000 * 0.15 = 6000 cents ($60.00)
    expect(settled.grossSalesCents).toBe(40000);
    expect(settled.commissionPayoutCents).toBe(6000);
    expect(settled.status).toBe('settled');
  });

  it('does not duplicate a completed transfer after a retry', async () => {
    prisma.inventoryTransferRequest.findFirst.mockResolvedValue({
      id: 't_done', facilityId: 'facility-1', status: 'completed', toOutletId: 'STAND-112', items: [],
    });

    await expect(service.updateTransferStatus('facility-1', 't_done', 'completed')).rejects.toThrow(
      'Cannot transition a transfer from completed to completed.',
    );
    expect(prisma.inventoryTransferRequest.update).not.toHaveBeenCalled();
    expect(prisma.standSheet.update).not.toHaveBeenCalled();
  });

  it('enforces Family Event Mode (alcoholDisabled) and Concert Mode (+15% surcharge) dynamic pricing', async () => {
    prisma.eventMenuOverlay.create.mockImplementation(async ({ data }) => ({ id: 'overlay_1', ...data }));

    const familyOverlay = await eventMenuService.createMenuOverlay({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      name: 'Family Day Preset',
      presetType: 'family_event',
    });

    expect(familyOverlay.alcoholDisabled).toBe(true);

    const concertOverlay = await eventMenuService.createMenuOverlay({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      name: 'Concert Surcharge Preset',
      presetType: 'concert_mode',
      surchargePercentage: 15.0,
    });

    expect(concertOverlay.surchargePercentage).toBe(15.0);

    // Calculate price for concert mobile cart ($10.00 base -> $11.50 with 15% surcharge)
    const priceResult = await eventMenuService.calculateTerminalPrice(1000, false, 'mobile_cart', [concertOverlay]);
    expect(priceResult.finalPriceCents).toBe(1150);

    // Check alcohol disabled in family event mode
    const familyPriceResult = await eventMenuService.calculateTerminalPrice(1400, true, 'fixed_concourse_stand', [familyOverlay]);
    expect(familyPriceResult.disabled).toBe(true);
  });
});
