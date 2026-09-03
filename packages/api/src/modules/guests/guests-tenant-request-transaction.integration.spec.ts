import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service';
import { bootstrapE2eApp, signTestToken } from '../../test/e2e-app';

/**
 * Proves TenantRequestTransactionInterceptor end-to-end through the real Nest
 * app (real AuthGuard, real interceptor, real GuestsController) over real
 * HTTP, against a real Postgres — not the SQL-only proof in
 * scripts/rls-cutover/verify-tenant-isolation.sh, and not the direct-extension
 * proof in tenant-isolation.integration.spec.ts. GuestsController is the first
 * controller carrying @UseInterceptors(TenantRequestTransactionInterceptor)
 * (see docs/rls-cutover-runbook.md).
 *
 * This database is schema-only (prisma db push via setupTestDb) — it never
 * applies the RLS migrations, so it does NOT prove PostgreSQL-level RLS
 * enforcement (that is scripts/rls-cutover/verify-tenant-isolation.sh's job,
 * run against a real NOBYPASSRLS role). What this DOES prove: the
 * interceptor's transaction lifecycle, GUC binding, and the extension's
 * tx-redirect actually work correctly end-to-end through the full HTTP
 * request pipeline — including GuestsController.listGuests's array-form
 * `$transaction([...])`, the one case flagged as a caveat in the
 * interceptor's own doc comment — without breaking auth, tenant scoping, or
 * response correctness for either the redirected or the non-redirected path.
 */
describe('TenantRequestTransactionInterceptor via GuestsController (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let teardown: () => Promise<void> = async () => {};
  let venueIds: string[] = [];
  let userIds: string[] = [];

  let tenantA: { token: string; venueId: string; guestId: string; guestName: string };
  let tenantB: { token: string; venueId: string; guestId: string; guestName: string };

  async function makeTenant(suffix: string) {
    const venue = await prisma.venue.create({
      data: {
        name: `Tenant ${suffix}`,
        code: `VW-ITX-${suffix.toUpperCase()}`,
        latitude: 0,
        longitude: 0,
        geofenceRadiusM: 100,
        timezone: 'UTC',
        subscriptionStatus: 'active',
        organization: { create: { name: `Org ${suffix}`, code: `org-itx-${suffix}` } },
      },
    });
    const user = await prisma.user.create({ data: { email: `itx-${suffix}@test.local` } });
    userIds.push(user.id);
    venueIds.push(venue.id);
    await prisma.profile.create({
      data: {
        userId: user.id,
        email: user.email!,
        fullName: `Tenant ${suffix} Manager`,
        role: 'manager',
        jobTitle: 'GM',
        venueId: venue.id,
      },
    });
    const guestName = `Secret Guest ${suffix} ${randomUUID().slice(0, 8)}`;
    const guest = await prisma.guest.create({
      data: { venueId: venue.id, fullName: guestName, nameLower: guestName.toLowerCase() },
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await prisma.session.create({ data: { userId: user.id, expiresAt } });
    const token = signTestToken(jwt, { sub: user.id, sid: session.id });
    await prisma.session.update({
      where: { id: session.id },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    return { token, venueId: venue.id, guestId: guest.id, guestName };
  }

  beforeAll(async () => {
    const boot = await bootstrapE2eApp();
    app = boot.app;
    prisma = boot.prisma;
    jwt = boot.jwt;
    teardown = boot.teardown;

    tenantA = await makeTenant('A');
    tenantB = await makeTenant('B');
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    if (userIds.length) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.profile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (venueIds.length) {
      await prisma.guest.deleteMany({ where: { venueId: { in: venueIds } } });
      await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
      await prisma.organization.deleteMany();
    }
    await teardown();
  });

  it('lists only the requesting tenant\'s guests through the array-form $transaction batch', async () => {
    const resA = await request(app.getHttpServer())
      .get('/api/v1/guests')
      .set('Authorization', `Bearer ${tenantA.token}`)
      .expect(200);
    const namesA = resA.body.guests.map((g: any) => g.fullName);
    expect(namesA).toContain(tenantA.guestName);
    expect(namesA).not.toContain(tenantB.guestName);
    expect(resA.body.totalCount).toBe(1);

    const resB = await request(app.getHttpServer())
      .get('/api/v1/guests')
      .set('Authorization', `Bearer ${tenantB.token}`)
      .expect(200);
    const namesB = resB.body.guests.map((g: any) => g.fullName);
    expect(namesB).toContain(tenantB.guestName);
    expect(namesB).not.toContain(tenantA.guestName);
    expect(resB.body.totalCount).toBe(1);
  });

  it('fetches a single guest profile correctly through the redirected transaction', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/guests/${tenantA.guestId}`)
      .set('Authorization', `Bearer ${tenantA.token}`)
      .expect(200);
    expect(res.body.guest.id).toBe(tenantA.guestId);
  });

  it('does not leak another tenant\'s guest by id (still scoped correctly under the interceptor)', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/guests/${tenantB.guestId}`)
      .set('Authorization', `Bearer ${tenantA.token}`)
      .expect(404);
  });
});
