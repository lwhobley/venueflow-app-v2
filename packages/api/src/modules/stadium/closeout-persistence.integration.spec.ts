import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupTestDb } from '../../test/setup-test-db';
import { StadiumController } from './stadium.controller';

describe('closeout with the actual database immutability trigger', () => {
  let setup: Awaited<ReturnType<typeof setupTestDb>>;
  beforeAll(async () => { setup = await setupTestDb(); }, 60000);
  afterAll(async () => { await setup?.teardown(); });

  it('supports draft saves, finalization and append-only adjustments', async () => {
    const rollback = new Error('Rollback isolated fixture and transactional trigger');
    try {
      await setup.prisma.$transaction(async (tx) => {
        const sql = readFileSync(join(__dirname, '../../../prisma/migrations/20260813150000_immutable_closeout_revision_ledger/migration.sql'), 'utf8');
        const functionSql = sql.match(/CREATE OR REPLACE FUNCTION app_private\.prevent_closeout_revision_mutation\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/)![0];
        await tx.$executeRawUnsafe(functionSql);
        await tx.$executeRawUnsafe('CREATE TRIGGER review_closeout_immutable BEFORE UPDATE OR DELETE ON "EventCloseoutRevision" FOR EACH ROW EXECUTE FUNCTION app_private.prevent_closeout_revision_mutation()');
        const code = randomUUID();
        const venue = await tx.venue.create({ data: { name: 'Closeout test', code, latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', organization: { create: { name: 'Test organization', code } } } });
        const event = await tx.venueEvent.create({ data: { venueId: venue.id, organizationId: venue.organizationId!, title: 'Test concert', startsAt: new Date(), createdBy: 'test-actor' } });
        const controller = new StadiumController(new Proxy(tx, { get(target, key) { return key === '$transaction' ? (fn: any) => fn(tx) : Reflect.get(target, key); } }) as any);
        const scope: any = { venueId: venue.id, profileId: 'test-actor', role: 'organization_admin', allAccess: true };
        await controller.upsertEventCloseout(scope, event.id, { actualSalesCents: 100 });
        await controller.upsertEventCloseout(scope, event.id, { actualSalesCents: 200 });
        await controller.upsertEventCloseout(scope, event.id, { status: 'finalized' });
        await expect(controller.upsertEventCloseout(scope, event.id, { actualSalesCents: 999 })).rejects.toThrow('immutable revisions');
        const adjusted = await controller.submitCloseoutRevision(scope, event.id, { actualSalesCents: 250, adjustmentReason: 'Verified late sales import' });
        expect(adjusted.currentVersion).toBe(4);
        expect(adjusted.revisions.map((row) => row.version)).toEqual([4, 3, 2, 1]);
        expect(adjusted.revisions.at(-1)?.actualSalesCents).toBe(100);
        throw rollback;
      }, { timeout: 20000 });
    } catch (error) { if (error !== rollback) throw error; }
  });
});
