import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb } from '../test/setup-test-db';
import { BillingController } from './billing.controller';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotency proof for the shared Stripe/RevenueCat subscription-apply path.
 * Duplicate webhook deliveries are a normal, expected occurrence for both
 * providers (at-least-once delivery); this proves a replayed event does not
 * double-process.
 *
 * The actual mechanism (billing.controller.ts applySubscription): a unique
 * constraint on SubscriptionEvent(source, externalEventId) + a P2002 catch
 * that returns `{ duplicate: true }` instead of re-applying. Critically, the
 * redundant venue/subscription update happens INSIDE the same transaction as
 * the duplicate-detecting insert, so when the insert fails on the second
 * delivery, Postgres rolls back the whole transaction — not just the audit
 * row. This spec verifies that rollback actually happens against real
 * Postgres, not just that the second call returns a "duplicate" flag.
 */
describe('billing webhook idempotency (integration)', () => {
  let prisma: PrismaClient;
  let teardown: () => Promise<void> = async () => {};
  let controller: BillingController;
  let venueId = '';

  beforeAll(async () => {
    const db = await setupTestDb();
    prisma = db.prisma;
    teardown = db.teardown;
    // ConfigService is only used by the HTTP webhook handlers (secret lookup),
    // not by applyStripeSubscription/applyAppleSubscription — a stub is fine.
    const configStub = { get: () => undefined } as any;
    controller = new BillingController(prisma as unknown as PrismaService, configStub);
  }, 60_000);

  beforeEach(async () => {
    const venue = await prisma.venue.create({
      data: {
        name: 'Idempotency Test Venue',
        code: `VW-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        latitude: 0,
        longitude: 0,
        geofenceRadiusM: 100,
        timezone: 'UTC',
        organization: { create: { name: 'Idempotency Test Organization', code: `ORG-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}` } },
      },
    });
    venueId = venue.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.subscriptionEvent.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.venue.deleteMany();
    await teardown();
  });

  it('a replayed Stripe event is a no-op: exactly one SubscriptionEvent row, unchanged subscription state', async () => {
    const eventAt = new Date();
    const payload = {
      venueId,
      status: 'active' as const,
      planId: 'price_test123',
      priceCents: 4900,
      currency: 'USD',
      externalSubscriptionId: 'sub_test123',
      externalCustomerId: 'cus_test123',
      eventId: 'evt_replayed_test',
      eventType: 'customer.subscription.created',
      eventAt,
    };

    const first = await controller.applyStripeSubscription(payload);
    expect(first).toMatchObject({ status: 'active' });

    const afterFirst = await prisma.subscription.findFirst({ where: { venueId } });
    expect(afterFirst?.status).toBe('active');

    // Replay the exact same event (same eventId, same eventAt) — simulates
    // Stripe's at-least-once delivery re-sending the same webhook.
    const second = await controller.applyStripeSubscription(payload);
    expect(second).toMatchObject({ ok: true, duplicate: true });

    const events = await prisma.subscriptionEvent.findMany({
      where: { venueId, source: 'stripe', externalEventId: 'evt_replayed_test' },
    });
    expect(events).toHaveLength(1);

    const afterSecond = await prisma.subscription.findFirst({ where: { venueId } });
    expect(afterSecond?.status).toBe('active');
    expect(afterSecond?.updatedAt.getTime()).toBe(afterFirst?.updatedAt.getTime());
  });

  it('a replayed RevenueCat event is also a no-op', async () => {
    const eventAt = new Date();
    const payload = {
      venueId,
      status: 'active' as const,
      planId: 'apple_subscription',
      externalSubscriptionId: 'apple_txn_test456',
      externalCustomerId: venueId,
      eventId: 'evt_apple_replayed_test',
      eventType: 'INITIAL_PURCHASE',
      eventAt,
    };

    const first = await controller.applyAppleSubscription(payload);
    expect(first).toMatchObject({ status: 'active' });

    const second = await controller.applyAppleSubscription(payload);
    expect(second).toMatchObject({ ok: true, duplicate: true });

    const events = await prisma.subscriptionEvent.findMany({
      where: { venueId, source: 'revenuecat', externalEventId: 'evt_apple_replayed_test' },
    });
    expect(events).toHaveLength(1);
  });

  it('an out-of-order (stale) event is ignored without overwriting newer state', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);

    await controller.applyStripeSubscription({
      venueId,
      status: 'active',
      planId: 'price_test123',
      eventId: 'evt_current',
      eventType: 'customer.subscription.updated',
      eventAt: now,
    });

    // A late-arriving, older event (e.g. redelivered after a retry backlog)
    // must not roll the status back to what it was before the newer event.
    const stale = await controller.applyStripeSubscription({
      venueId,
      status: 'past_due',
      planId: 'price_test123',
      eventId: 'evt_stale',
      eventType: 'customer.subscription.updated',
      eventAt: earlier,
    });
    expect(stale).toMatchObject({ status: 'active', ignored: true });

    const afterStale = await prisma.subscription.findFirst({ where: { venueId } });
    expect(afterStale?.status).toBe('active');
  });
});
