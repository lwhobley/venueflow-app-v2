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

    prisma.suiteBeoOrder.findUnique.mockResolvedValue(existing);
    prisma.suiteBeoOrder.update.mockResolvedValue({ ...existing, status: 'closed_invoiced' });

    const result = await service.updateOrderStatus('beo_1', 'closed_invoiced', 'user_1', 'Chef', 'Closing order');

    expect(result.status).toBe('closed_invoiced');
    expect(webhooks.emitSuiteBeoWebhook).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'suite.beo.closed_invoiced' }));
  });

  it('creates quick replenishment request and broadcasts alert via WebSocket', async () => {
    prisma.suiteBeoOrder.findUnique.mockResolvedValue({ id: 'beo_1', facilityId: 'facility-1', zoneId: 'zone-1' });
    prisma.suiteBeoReplenishmentRequest.create.mockResolvedValue({
      id: 'replenish_1',
      beoOrderId: 'beo_1',
      itemSummary: 'Need 2x Ice Bags',
      priority: 'urgent',
    });

    const result = await service.createReplenishment('beo_1', {
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
    prisma.suiteBeoOrder.findUnique.mockResolvedValue(null);
    prisma.suiteBeoOrder.create.mockImplementation(({ data }) => Promise.resolve({ id: `beo_${data.beoNumber}`, ...data }));

    const orders = await service.seed10VipSuites('facility-1', 'org-1', 'zone-1');

    expect(orders).toHaveLength(10);
    expect(prisma.suiteBeoOrder.create).toHaveBeenCalledTimes(10);
  });
});
