import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PosController } from './pos.controller';
import { hashWebhookSecret, secretsMatch } from '../../common/webhook-auth';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeController() {
  const prisma = {
    posConnection: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    },
    posCheck: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalCents: 0, tipCents: 0 } }),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    posLaborPunch: {
      upsert: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    venue: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/New_York' }) },
    posAggregatorChannel: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  } as any;
  const controller = new PosController(prisma);
  return { controller, prisma };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;

function makeRequest(ip = '203.0.113.5') {
  return { ip } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PosController', () => {
  describe('ingest webhook', () => {
    it('verifies the webhook secret before touching the rate limiter', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue(null);

      await expect(controller.ingest(makeRequest(), 'venue-1', 'secret', { provider: 'toast' } as any))
        .rejects.toThrow(UnauthorizedException);

      // An unauthenticated spray of random venueIds must not churn buckets.
      expect(assertWithinSharedRateLimit).not.toHaveBeenCalled();
    });

    it('applies a per-venue, per-IP rate limit once the secret is verified', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({ id: 'conn-1', webhookSecret: hashWebhookSecret('secret') });

      await controller.ingest(makeRequest(), 'venue-1', 'secret', { provider: 'toast' } as any);

      expect(assertWithinSharedRateLimit).toHaveBeenCalledWith(
        prisma,
        'pos-ingest:venue-1:203.0.113.5',
        120,
        60_000,
        'Too many webhook requests.',
      );
    });

    it('rejects when no matching POS connection exists', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue(null);

      await expect(controller.ingest(makeRequest(), 'venue-1', 'any-secret', { provider: 'toast' } as any))
        .rejects.toThrow('Invalid webhook secret');
    });

    it('rejects a webhook secret that does not match the stored hash', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({ id: 'conn-1', webhookSecret: hashWebhookSecret('correct-secret') });

      await expect(controller.ingest(makeRequest(), 'venue-1', 'wrong-secret', { provider: 'toast' } as any))
        .rejects.toThrow('Invalid webhook secret');
    });

    it('rejects when the connection has no webhook secret configured', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({ id: 'conn-1', webhookSecret: null });

      await expect(controller.ingest(makeRequest(), 'venue-1', 'any-secret', { provider: 'toast' } as any))
        .rejects.toThrow('Invalid webhook secret');
    });

    it('upserts checks and labor punches, then records lastSyncAt', async () => {
      const { controller, prisma } = makeController();
      const secret = 'correct-secret';
      prisma.posConnection.findFirst.mockResolvedValue({ id: 'conn-1', webhookSecret: hashWebhookSecret(secret) });

      const result = await controller.ingest(makeRequest(), 'venue-1', secret, {
        provider: 'toast',
        checks: [{
          externalCheckId: 'chk-1', openedAt: Date.now(), subtotalCents: 1000, totalCents: 1100, tipCents: 100,
        }],
        laborPunches: [{
          externalEmployeeId: 'emp-1', employeeName: 'Alex', clockInAt: Date.now(), businessDate: '2026-07-15',
        }],
      } as any);

      expect(prisma.posCheck.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { venueId_provider_externalCheckId: { venueId: 'venue-1', provider: 'toast', externalCheckId: 'chk-1' } },
      }));
      expect(prisma.posLaborPunch.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          venueId_provider_externalEmployeeId_businessDate: {
            venueId: 'venue-1', provider: 'toast', externalEmployeeId: 'emp-1', businessDate: '2026-07-15',
          },
        },
      }));
      expect(prisma.posConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { lastSyncAt: expect.any(Date) },
      });
      expect(result).toEqual({ ok: true, checksUpserted: 1, laborUpserted: 1 });
    });

    it('chunks large ingest batches into multiple transactions', async () => {
      const { controller, prisma } = makeController();
      const secret = 'correct-secret';
      prisma.posConnection.findFirst.mockResolvedValue({ id: 'conn-1', webhookSecret: hashWebhookSecret(secret) });
      const checks = Array.from({ length: 250 }, (_, i) => ({
        externalCheckId: `chk-${i}`, openedAt: Date.now(), subtotalCents: 100, totalCents: 100, tipCents: 0,
      }));

      await controller.ingest(makeRequest(), 'venue-1', secret, { provider: 'toast', checks } as any);

      // 250 checks at INGEST_CHUNK_SIZE=100 -> 3 chunked transactions
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('manager-only guard', () => {
    it('rejects staff from the overview endpoint', async () => {
      const { controller } = makeController();
      await expect(controller.getPosOverview(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects an uninitialized profile from connections upsert', async () => {
      const { controller } = makeController();
      await expect(controller.upsertPosConnection(undefined as any, { provider: 'toast', status: 'connected' }))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPosOverview', () => {
    it('aggregates today totals and open checks scoped to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findMany.mockResolvedValue([
        { id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: null, status: 'connected', lastSyncAt: new Date('2026-07-15T10:00:00Z'), createdAt: new Date(), updatedAt: new Date() },
      ]);
      prisma.posCheck.aggregate.mockResolvedValue({ _sum: { totalCents: 5000, tipCents: 750 } });
      prisma.posCheck.count.mockResolvedValue(3);

      const result = await controller.getPosOverview(managerScope);

      expect(result.todaySalesCents).toBe(5000);
      expect(result.todayTipsCents).toBe(750);
      expect(result.openChecks).toBe(3);
      expect(result.lastSyncAt).toBe(new Date('2026-07-15T10:00:00Z').getTime());
      expect(prisma.posCheck.aggregate).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ venueId: 'venue-1', status: { not: 'void' } }),
      }));
    });
  });

  describe('upsertPosConnection', () => {
    it('looks up an existing provider connection regardless of location changes', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({
        id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: 'old-location',
        status: 'connected', webhookSecret: hashWebhookSecret('already-set'), lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });
      prisma.posConnection.update.mockResolvedValue({
        id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: 'new-location',
        status: 'connected', lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });

      await controller.upsertPosConnection(managerScope, {
        provider: 'toast', status: 'connected', externalLocationId: 'new-location',
      });

      expect(prisma.posConnection.findFirst).toHaveBeenCalledWith({
        where: { venueId: 'venue-1', provider: 'toast' },
      });
      expect(prisma.posConnection.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'conn-1' },
        data: expect.objectContaining({ externalLocationId: 'new-location' }),
      }));
    });

    it('creates a new connection with a freshly generated webhook secret', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue(null);
      prisma.posConnection.create.mockResolvedValue({
        id: 'conn-new', venueId: 'venue-1', provider: 'toast', externalLocationId: null,
        status: 'connected', lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await controller.upsertPosConnection(managerScope, { provider: 'toast', status: 'connected' });

      expect(prisma.posConnection.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ venueId: 'venue-1', webhookSecret: expect.stringMatching(/^sha256:/) }),
      }));
      expect(result.webhookSecret).toEqual(expect.any(String));
    });

    it('updates the winning connection when a concurrent create returns P2002', async () => {
      const { controller, prisma } = makeController();
      const winner = {
        id: 'conn-winner', venueId: 'venue-1', provider: 'toast', externalLocationId: null,
        status: 'connected', webhookSecret: hashWebhookSecret('winner-secret'), lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      };
      prisma.posConnection.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      prisma.posConnection.create.mockRejectedValue({ code: 'P2002' });
      prisma.posConnection.update.mockResolvedValue({ ...winner, status: 'paused' });

      const result = await controller.upsertPosConnection(managerScope, { provider: 'toast', status: 'paused' });

      expect(prisma.posConnection.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'conn-winner' },
        data: expect.not.objectContaining({ webhookSecret: expect.anything() }),
      }));
      expect(result.webhookSecret).toBeNull();
    });

    it('rotates the secret only when the existing connection has none', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({
        id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: null,
        status: 'paused', webhookSecret: hashWebhookSecret('already-set'), lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });
      prisma.posConnection.update.mockResolvedValue({
        id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: null,
        status: 'connected', lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await controller.upsertPosConnection(managerScope, { provider: 'toast', status: 'connected' });

      expect(prisma.posConnection.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'conn-1' },
        data: expect.not.objectContaining({ webhookSecret: expect.anything() }),
      }));
      expect(result.webhookSecret).toBeNull();
    });

    it('issues a new secret when reconnecting an existing connection that had none', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({
        id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: null,
        status: 'error', webhookSecret: null, lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });
      prisma.posConnection.update.mockResolvedValue({
        id: 'conn-1', venueId: 'venue-1', provider: 'toast', externalLocationId: null,
        status: 'connected', lastSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await controller.upsertPosConnection(managerScope, { provider: 'toast', status: 'connected' });

      expect(prisma.posConnection.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ webhookSecret: expect.stringMatching(/^sha256:/) }),
      }));
      expect(result.webhookSecret).toEqual(expect.any(String));
    });
  });

  describe('rotatePosConnectionSecret', () => {
    it('rotates a venue-scoped connection and returns the plaintext once', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue({ id: 'conn-1' });

      const result = await controller.rotatePosConnectionSecret(managerScope, 'conn-1');

      expect(prisma.posConnection.findFirst).toHaveBeenCalledWith({
        where: { id: 'conn-1', venueId: 'venue-1' },
        select: { id: true },
      });
      const update = prisma.posConnection.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'conn-1' });
      expect(update.data.webhookSecret).toMatch(/^sha256:/);
      expect(secretsMatch(result.webhookSecret, update.data.webhookSecret)).toBe(true);
      expect(secretsMatch('old-secret', update.data.webhookSecret)).toBe(false);
    });

    it('does not reveal whether another venue owns a connection', async () => {
      const { controller, prisma } = makeController();
      prisma.posConnection.findFirst.mockResolvedValue(null);

      await expect(controller.rotatePosConnectionSecret(managerScope, 'foreign-connection'))
        .rejects.toThrow('POS connection not found');
      expect(prisma.posConnection.update).not.toHaveBeenCalled();
    });
  });

  describe('getLaborSummary', () => {
    it('sums declared and reported tips across employees', async () => {
      const { controller, prisma } = makeController();
      prisma.posLaborPunch.groupBy.mockResolvedValue([
        {
          externalEmployeeId: 'emp-1', employeeName: 'Alex', jobTitle: 'Server',
          _sum: { regularMinutes: 480, overtimeMinutes: 0, totalPayCents: 12000, tipsCents: 3000, declaredTipsCents: 500 },
        },
      ]);

      const result = await controller.getLaborSummary(managerScope, {});

      expect(result.byEmployee[0]).toEqual(expect.objectContaining({ employeeName: 'Alex', tipsCents: 3500, payCents: 12000 }));
      expect(result.totalTipsCents).toBe(3500);
    });
  });

  describe('aggregator channels', () => {
    it('rejects listing channels for a role that cannot manage the venue', async () => {
      const { controller } = makeController();
      await expect(controller.getAggregatorChannels(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('lists only this venue\'s channels, serialized for the frontend', async () => {
      const { controller, prisma } = makeController();
      prisma.posAggregatorChannel.findMany.mockResolvedValue([
        { id: 'ch-1', name: 'North Stands', zoneLabel: 'North 100', primaryProvider: 'toast', fallbackProvider: 'square', terminalCount: 16, active: true },
      ]);

      const result = await controller.getAggregatorChannels(managerScope);

      expect(prisma.posAggregatorChannel.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([
        { id: 'ch-1', name: 'North Stands', zone: 'North 100', primaryProvider: 'toast', fallbackProvider: 'square', terminalCount: 16, status: 'active' },
      ]);
    });

    it('rejects creating a channel for a role that cannot manage the venue', async () => {
      const { controller } = makeController();
      await expect(controller.createAggregatorChannel(staffScope, {
        name: 'North Stands', zoneLabel: 'North 100', primaryProvider: 'toast', fallbackProvider: 'square',
      } as any)).rejects.toThrow(ForbiddenException);
    });

    it('creates a channel scoped to the caller\'s venue', async () => {
      const { controller, prisma } = makeController();
      prisma.posAggregatorChannel.create.mockResolvedValue({
        id: 'ch-2', name: 'East Stands', zoneLabel: 'East 100', primaryProvider: 'toast', fallbackProvider: 'clover', terminalCount: 0, active: true,
      });

      const result = await controller.createAggregatorChannel(managerScope, {
        name: 'East Stands', zoneLabel: 'East 100', primaryProvider: 'toast', fallbackProvider: 'clover',
      } as any);

      expect(prisma.posAggregatorChannel.create).toHaveBeenCalledWith({
        data: { venueId: 'venue-1', name: 'East Stands', zoneLabel: 'East 100', primaryProvider: 'toast', fallbackProvider: 'clover', terminalCount: 0 },
      });
      expect(result.status).toBe('active');
    });

    it('does not let one venue update another venue\'s channel', async () => {
      const { controller, prisma } = makeController();
      prisma.posAggregatorChannel.findFirst.mockResolvedValue(null);

      await expect(controller.updateAggregatorChannelStatus(managerScope, 'foreign-channel', { active: false } as any))
        .rejects.toThrow('POS aggregator channel not found');
      expect(prisma.posAggregatorChannel.update).not.toHaveBeenCalled();
    });

    it('toggles a channel\'s active status', async () => {
      const { controller, prisma } = makeController();
      prisma.posAggregatorChannel.findFirst.mockResolvedValue({ id: 'ch-1', venueId: 'venue-1' });
      prisma.posAggregatorChannel.update.mockResolvedValue({
        id: 'ch-1', name: 'North Stands', zoneLabel: 'North 100', primaryProvider: 'toast', fallbackProvider: 'square', terminalCount: 16, active: false,
      });

      const result = await controller.updateAggregatorChannelStatus(managerScope, 'ch-1', { active: false } as any);

      expect(prisma.posAggregatorChannel.update).toHaveBeenCalledWith({ where: { id: 'ch-1' }, data: { active: false } });
      expect(result.status).toBe('inactive');
    });
  });
});
