import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service';
import { bootstrapE2eApp, signTestToken } from '../../test/e2e-app';

/**
 * StaffRequestsController carries TenantRequestTransactionInterceptor but its
 * create/review routes are @SkipTenantTransaction() (they await
 * NotificationsService, which awaits a blocking Expo push fetch — see the
 * controller). That meant their own DB writes, which used to run inside the
 * interceptor's request-scoped transaction implicitly, needed their OWN
 * explicit GUC binding instead — createStaffRequest and reviewStaffRequest
 * were converted from a bare (or absent) transaction to withTenantTransaction
 * for exactly this reason. This test proves both writes still work correctly
 * end-to-end through real HTTP against a real Postgres, not just that they
 * compile.
 */
describe('StaffRequestsController tenant-transaction fixes (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let teardown: () => Promise<void> = async () => {};
  let venueId = '';
  let userIds: string[] = [];
  let staffToken = '';
  let managerToken = '';
  let managerProfileId = '';

  beforeAll(async () => {
    const boot = await bootstrapE2eApp();
    app = boot.app;
    prisma = boot.prisma;
    jwt = boot.jwt;
    teardown = boot.teardown;

    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const venue = await prisma.venue.create({
      data: {
        name: `SR Test Venue ${suffix}`,
        code: `VW-SR-${suffix.toUpperCase()}`,
        latitude: 0,
        longitude: 0,
        geofenceRadiusM: 100,
        timezone: 'UTC',
        subscriptionStatus: 'active',
        organization: { create: { name: `SR Org ${suffix}`, code: `org-sr-${suffix}` } },
      },
    });
    venueId = venue.id;

    async function makeUser(role: 'staff' | 'manager', label: string) {
      const user = await prisma.user.create({ data: { email: `sr-${label}-${suffix}@test.local` } });
      userIds.push(user.id);
      const profile = await prisma.profile.create({
        data: { userId: user.id, email: user.email!, fullName: `SR ${label}`, role, jobTitle: role, venueId: venue.id },
      });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const session = await prisma.session.create({ data: { userId: user.id, expiresAt } });
      const token = signTestToken(jwt, { sub: user.id, sid: session.id });
      await prisma.session.update({
        where: { id: session.id },
        data: { tokenHash: createHash('sha256').update(token).digest('hex') },
      });
      return { token, profileId: profile.id };
    }

    const staff = await makeUser('staff', 'staff');
    staffToken = staff.token;
    const manager = await makeUser('manager', 'mgr');
    managerToken = manager.token;
    managerProfileId = manager.profileId;
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    if (userIds.length) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.staffRequest.deleteMany({ where: { venueId } });
      await prisma.profile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (venueId) {
      await prisma.venue.deleteMany({ where: { id: venueId } });
      await prisma.organization.deleteMany();
    }
    await teardown();
  });

  it('creates a staff request via withTenantTransaction and it is readable back', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/staff-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ kind: 'other', title: 'Need a new badge', details: 'Lost my badge, need a replacement.' })
      .expect(201);

    expect(createRes.body.title).toBe('Need a new badge');
    expect(createRes.body.status).toBe('pending');
    expect(createRes.body._id).toBeTruthy();

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/staff-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(listRes.body.some((r: any) => r._id === createRes.body._id)).toBe(true);
  });

  it('reviews (approves) a staff request via withTenantTransaction and persists the review', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/staff-requests')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ kind: 'other', title: 'Schedule question', details: 'Can I swap Friday?' })
      .expect(201);

    const reviewRes = await request(app.getHttpServer())
      .patch(`/api/v1/staff-requests/${createRes.body._id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'approved', responseNotes: 'Sure, approved.' })
      .expect(200);

    expect(reviewRes.body.status).toBe('approved');

    const stored = await prisma.staffRequest.findUniqueOrThrow({ where: { id: createRes.body._id } });
    expect(stored.status).toBe('approved');
    expect(stored.reviewerId).toBe(managerProfileId);
  });
});
