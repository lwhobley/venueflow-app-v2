import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb } from '../test/setup-test-db';
import { tenantIsolationExtension } from './tenant-isolation.extension';
import { runWithTenant } from './tenant-context';

/**
 * End-to-end proof that the tenant-isolation extension actually isolates tenants
 * against a real Postgres.
 */
describe('tenant isolation extension (integration)', () => {
  let base: PrismaClient;
  let db: ReturnType<typeof makeExtended>;
  let teardown: () => Promise<void> = async () => {};
  let venueA = '';
  let venueB = '';

  function makeExtended(client: PrismaClient) {
    return client.$extends(tenantIsolationExtension());
  }

  beforeAll(async () => {
    const setup = await setupTestDb();
    base = setup.prisma;
    teardown = setup.teardown;
    db = makeExtended(base);

    // Two tenants, each with one bar inventory item. Seeded WITHOUT a tenant
    // context so the extension stays inert during setup.
    const [a, b] = await Promise.all([
      base.venue.create({ data: { name: 'Venue A', code: 'VW-TENANTA001', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', organization: { create: { name: 'Tenant Organization A', code: 'ORG-TENANTA001' } } } }),
      base.venue.create({ data: { name: 'Venue B', code: 'VW-TENANTB001', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', organization: { create: { name: 'Tenant Organization B', code: 'ORG-TENANTB001' } } } }),
    ]);
    venueA = a.id;
    venueB = b.id;
    await Promise.all([
      base.barInventoryItem.create({ data: { venueId: venueA, name: 'A-Gin', normalizedName: 'a-gin', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
      base.barInventoryItem.create({ data: { venueId: venueB, name: 'B-Rum', normalizedName: 'b-rum', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!base) return;
    await base.barInventoryItem.deleteMany();
    await base.venue.deleteMany();
    await teardown();
  });

  // Prisma queries are lazy (PrismaPromise executes on await), so the await MUST
  // happen inside the tenant context — otherwise run() has already exited by the
  // time the query runs and the extension sees no venueId. Mirrors the real
  // enablement path (AuthGuard -> enterTenant), which persists for the request.
  const asTenant = <T>(venueId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenant(venueId, async () => await fn());

  it('findMany returns only the bound tenant rows', async () => {
    const rows = await asTenant(venueA, () => db.barInventoryItem.findMany());
    expect(rows.map((r) => r.name)).toEqual(['A-Gin']);
  });

  it('a hostile where cannot reach another tenant', async () => {
    // Ask (as Venue A) for Venue B's rows — the AND-ed predicate yields nothing.
    const rows = await asTenant(venueA, () => db.barInventoryItem.findMany({ where: { venueId: venueB } }));
    expect(rows).toHaveLength(0);
  });

  it('findUnique cannot reach another tenant by id', async () => {
    const otherTenantItem = await base.barInventoryItem.findFirstOrThrow({ where: { venueId: venueB } });
    const row = await asTenant(venueA, () => db.barInventoryItem.findUnique({ where: { id: otherTenantItem.id } }));
    expect(row).toBeNull();
  });

  it('without a tenant context the extension is inert (sees all)', async () => {
    const rows = await db.barInventoryItem.findMany();
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('create forces the bound venueId regardless of supplied data', async () => {
    const created = await asTenant(venueA, () =>
      db.barInventoryItem.create({ data: { venueId: venueB, name: 'A-Vodka', normalizedName: 'a-vodka', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    );
    expect(created.venueId).toBe(venueA);
    await base.barInventoryItem.delete({ where: { id: created.id } });
  });
});
