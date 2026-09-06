import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SuiteHospitalityService } from './suite-hospitality.service';

describe('SuiteHospitalityService', () => {
  let service: SuiteHospitalityService;
  let prisma: any;
  let wsGateway: any;
  let webhooks: any;

  beforeEach(() => {
    prisma = {
      suiteBeoOrder: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      suiteBeoStatusLog: {
        create: vi.fn(),
      },
      suiteBeoReplenishmentRequest: {
        create: vi.fn(),
      },
      subVenue: {
        findMany: vi.fn(),
      },
      crmBeo: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    wsGateway = {
      broadcastBeoUpdate: vi.fn(),
      broadcastReplenishment: vi.fn(),
    };

    webhooks = {
      emitSuiteBeoWebhook: vi.fn().mockResolvedValue({ success: true, targetSystem: 'NetSuite', responseCode: 200 }),
    };

    service = new SuiteHospitalityService(prisma, wsGateway, webhooks);
  });

  it('creates a confirmed BEO order, logs audit event, and emits enterprise webhook', async () => {
    const mockOrder = {
      id: 'beo_1',
      beoNumber: 'BEO-SUITE-2001',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      zoneId: 'zone-1',
      subVenueId: 'sub-1',
      status: 'confirmed_beo',
      totalCents: 50000,
      cateringLineItems: [{ code: 'CAVIAR', name: 'Caviar', quantity: 2, unitPriceCents: 25000, category: 'Appetizer' }],
    };

    prisma.suiteBeoOrder.create.mockResolvedValue(mockOrder);

    const result = await service.createBeoOrder({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      zoneId: 'zone-1',
      subVenueId: 'sub-1',
      beoNumber: 'BEO-SUITE-2001',
      hostName: 'Test Host',
      deliveryWindowStart: new Date().toISOString(),
      deliveryWindowEnd: new Date(Date.now() + 3600000).toISOString(),
      cateringLineItems: [{ code: 'CAVIAR', name: 'Caviar', quantity: 2, unitPriceCents: 25000, category: 'Appetizer' }],
    });

    expect(result.beoNumber).toBe('BEO-SUITE-2001');
    expect(prisma.suiteBeoStatusLog.create).toHaveBeenCalledOnce();
    expect(wsGateway.broadcastBeoUpdate).toHaveBeenCalledOnce();
    expect(webhooks.emitSuiteBeoWebhook).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'suite.beo.confirmed' }));
  });

  it('transitions order status and emits closed_invoiced webhook on closeout', async () => {
    const existing = {
      id: 'beo_1',
      status: 'delivered',
      beoNumber: 'BEO-SUITE-2001',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      zoneId: 'zone-1',
      subVenueId: 'sub-1',
      totalCents: 50000,
      cateringLineItems: [],
    };

    prisma.suiteBeoOrder.findFirst.mockResolvedValue(existing);
    prisma.suiteBeoOrder.update.mockResolvedValue({ ...existing, status: 'closed_invoiced' });

    const result = await service.updateOrderStatus('facility-1', 'beo_1', 'closed_invoiced', 'user_1', 'Chef', 'Closing order');

    expect(result.status).toBe('closed_invoiced');
    expect(webhooks.emitSuiteBeoWebhook).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'suite.beo.closed_invoiced' }));
  });

  it('creates quick replenishment request and broadcasts alert via WebSocket', async () => {
    prisma.suiteBeoOrder.findFirst.mockResolvedValue({ id: 'beo_1', facilityId: 'facility-1', zoneId: 'zone-1', subVenueId: 'sub-1' });
    prisma.suiteBeoReplenishmentRequest.create.mockResolvedValue({
      id: 'replenish_1',
      beoOrderId: 'beo_1',
      itemSummary: 'Need 2x Ice Bags',
      priority: 'urgent',
    });

    const result = await service.createReplenishment('facility-1', 'beo_1', {
      subVenueId: 'sub-1',
      zoneId: 'zone-1',
      itemSummary: 'Need 2x Ice Bags',
      priority: 'urgent',
    });

    expect(result.itemSummary).toBe('Need 2x Ice Bags');
    expect(wsGateway.broadcastReplenishment).toHaveBeenCalledOnce();
  });

  it('seeds 10 VIP Suites with staggered delivery windows', async () => {
    prisma.subVenue.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `sub_${i + 1}`, name: `VIP Suite ${101 + i}` }))
    );
    prisma.suiteBeoOrder.findFirst.mockResolvedValue(null);
    prisma.suiteBeoOrder.create.mockImplementation(({ data }: any) => Promise.resolve({ id: `beo_${data.beoNumber}`, ...data }));

    const orders = await service.seed10VipSuites('facility-1', 'org-1', 'zone-1');

    expect(orders).toHaveLength(10);
    expect(prisma.suiteBeoOrder.create).toHaveBeenCalledTimes(10);
  });

  /**
   * `Venue` and `Facility` deliberately share an id, so a sales BEO belongs to
   * this facility exactly when its `venueId` matches. A database trigger
   * enforces the same rule; the service checks first so an operator gets a
   * message rather than a raw Postgres exception.
   */
  describe('linkToCrmBeo', () => {
    it('links a suite order to a sales BEO in the same venue', async () => {
      prisma.suiteBeoOrder.findFirst.mockResolvedValue({ id: 'beo_1' });
      prisma.crmBeo.findFirst.mockResolvedValue({ id: 'crm_1' });
      prisma.suiteBeoOrder.update.mockResolvedValue({ id: 'beo_1', crmBeoId: 'crm_1' });

      const result = await service.linkToCrmBeo('facility-1', 'beo_1', 'crm_1');

      expect(prisma.crmBeo.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'crm_1', venueId: 'facility-1' } })
      );
      expect(prisma.suiteBeoOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'beo_1' }, data: { crmBeoId: 'crm_1' } })
      );
      expect(result.crmBeoId).toBe('crm_1');
    });

    it('refuses a sales BEO from another venue', async () => {
      prisma.suiteBeoOrder.findFirst.mockResolvedValue({ id: 'beo_1' });
      prisma.crmBeo.findFirst.mockResolvedValue(null);

      await expect(service.linkToCrmBeo('facility-1', 'beo_1', 'crm_other')).rejects.toThrow(
        /does not exist in this venue/
      );
      expect(prisma.suiteBeoOrder.update).not.toHaveBeenCalled();
    });

    it('refuses a suite order from another facility', async () => {
      prisma.suiteBeoOrder.findFirst.mockResolvedValue(null);

      await expect(service.linkToCrmBeo('facility-1', 'beo_elsewhere', 'crm_1')).rejects.toThrow(
        /unavailable in this facility/
      );
      expect(prisma.suiteBeoOrder.update).not.toHaveBeenCalled();
    });

    it('clears the link without looking up a sales BEO', async () => {
      prisma.suiteBeoOrder.findFirst.mockResolvedValue({ id: 'beo_1' });
      prisma.suiteBeoOrder.update.mockResolvedValue({ id: 'beo_1', crmBeoId: null });

      const result = await service.linkToCrmBeo('facility-1', 'beo_1', null);

      expect(prisma.crmBeo.findFirst).not.toHaveBeenCalled();
      expect(result.crmBeoId).toBeNull();
    });
  });
});
