import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb } from '../test/setup-test-db';
import { runWithTenant } from './tenant-context';

/**
 * End-to-end proof that the FULL cutover pipeline scopes correctly when
 * TENANT_ISOLATION_ENFORCED=true: PrismaService -> Proxy -> $extends -> extension
 * -> AsyncLocalStorage context. Complements tenant-isolation.integration.spec.ts
 * (which exercises the extension directly) by going through the real service
 * that the rest of the app injects.
 */
describe('PrismaService cutover (integration)', () => {
  let prisma: any;
  let teardown: () => Promise<void> = async () => {};
  let venueA = '';
  let venueB = '';

  beforeAll(async () => {
    const setup = await setupTestDb();
    teardown = setup.teardown;
    // PrismaService reads DATABASE_URL at construction time; point it at the
    // same DB setupTestDb() prepared, and turn the flag on for this suite.
    process.env.DATABASE_URL = setup.url;
    process.env.TENANT_ISOLATION_ENFORCED = 'true';
    // Import AFTER env is set so the constructor branches into the Proxy path.
    const { PrismaService } = await import('./prisma.service');
    prisma = new PrismaService();
    await prisma.$connect();

    // Seed without a tenant context — extension stays inert during setup.
    const [a, b] = await Promise.all([
      setup.prisma.venue.create({ data: { name: 'Cutover A', code: 'VW-CUTOVERA01', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', organization: { create: { name: 'Cutover Org A', code: 'ORG-CUTOVERA01' } } } }),
      setup.prisma.venue.create({ data: { name: 'Cutover B', code: 'VW-CUTOVERB01', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', organization: { create: { name: 'Cutover Org B', code: 'ORG-CUTOVERB01' } } } }),
    ]);
    venueA = a.id;
    venueB = b.id;
    await Promise.all([
      setup.prisma.barInventoryItem.create({ data: { venueId: venueA, name: 'A-Item', normalizedName: 'a-item', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
      setup.prisma.barInventoryItem.create({ data: { venueId: venueB, name: 'B-Item', normalizedName: 'b-item', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    ]);
  }, 60_000);

  afterAll(async () => {
    delete process.env.TENANT_ISOLATION_ENFORCED;
    if (!prisma) return;
    await prisma.$disconnect();
    await teardown();
  });

  // See tenant-isolation.integration.spec.ts for the lazy-promise note: await
  // inside the context, otherwise run() exits before the query executes.
  const asTenant = <T>(venueId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenant(venueId, async () => await fn());

  it('scopes findMany through PrismaService when context is bound', async () => {
    const rows = (await asTenant(venueA, () => prisma.barInventoryItem.findMany())) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toContain('A-Item');
    expect(rows.map((r) => r.name)).not.toContain('B-Item');
  });

  it('hostile where via PrismaService cannot reach another tenant', async () => {
    const rows = (await asTenant(venueA, () => prisma.barInventoryItem.findMany({ where: { venueId: venueB } }))) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('PrismaService.create forces the bound venueId', async () => {
    const created = (await asTenant(venueA, () =>
      prisma.barInventoryItem.create({ data: { venueId: venueB, name: 'A-Forced', normalizedName: 'a-forced', category: 'spirit', unit: 'bottle', parLevel: 1, onHand: 1 } }),
    )) as { venueId: string };
    expect(created.venueId).toBe(venueA);
  });

  it('without a tenant context PrismaService still works (extension is inert)', async () => {
    const rows = (await prisma.barInventoryItem.findMany()) as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
