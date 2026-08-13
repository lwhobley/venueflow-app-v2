import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from './prisma/prisma.service';
import { bootstrapE2eApp, signTestToken } from './test/e2e-app';

/**
 * True end-to-end smoke tests: boots the real Nest app (full module graph,
 * real AuthGuard/SubscriptionGuard/VenueScopeInterceptor/ValidationPipe/
 * exception filter) against a real Postgres test database and drives it over
 * HTTP via supertest.
 */
describe('e2e smoke: auth, billing, scheduling', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let teardown: () => Promise<void> = async () => {};
  let venueIds: string[] = [];

  let sessionUser: { userId: string; sid: string; venueId: string } | undefined;

  beforeAll(async () => {
    const boot = await bootstrapE2eApp();
    app = boot.app;
    prisma = boot.prisma;
    jwt = boot.jwt;
    teardown = boot.teardown;

    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const venue = await prisma.venue.create({
      data: {
        name: `E2E Test Venue ${suffix}`,
        code: `VW-E2E-${suffix.toUpperCase()}`,
        latitude: 0,
        longitude: 0,
        geofenceRadiusM: 100,
        timezone: 'UTC',
        subscriptionStatus: 'active',
        organization: { create: { name: `E2E Org ${suffix}`, code: `org-e2e-${suffix}` } },
      },
    });
    venueIds = [venue.id];

    const user = await prisma.user.create({
      data: { email: `e2e-${suffix}@test.local` },
    });

    await prisma.profile.create({
      data: {
        userId: user.id,
        email: user.email!,
        fullName: 'E2E Active User',
        role: 'staff',
        jobTitle: 'Server',
        venueId: venue.id,
      },
    });

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await prisma.session.create({
      data: { userId: user.id, expiresAt },
    });
    sessionUser = { userId: user.id, sid: session.id, venueId: venue.id };
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    if (sessionUser?.userId) {
      await prisma.session.deleteMany({ where: { userId: sessionUser.userId } });
      await prisma.profile.deleteMany({ where: { userId: sessionUser.userId } });
      await prisma.user.deleteMany({ where: { id: sessionUser.userId } });
    }
    if (venueIds.length) {
      await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
      await prisma.organization.deleteMany();
    }
    await teardown();
  });

  describe('auth', () => {
    it('rejects a request with no bearer token', async () => {
      await request(app.getHttpServer()).get('/api/v1/app/me').expect(401);
    });

    it('rejects a garbage/invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/app/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('rejects a well-formed token with no matching Session row', async () => {
      const token = signTestToken(jwt, { sub: 'nonexistent-user', sid: 'nonexistent-session' });
      await request(app.getHttpServer())
        .get('/api/v1/app/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('accepts a valid token backed by a real Session row', async () => {
      const token = signTestToken(jwt, { sub: sessionUser!.userId, sid: sessionUser!.sid });
      const res = await request(app.getHttpServer())
        .get('/api/v1/app/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.profile.fullName).toBe('E2E Active User');
      expect(res.body.venue.id).toBe(sessionUser!.venueId);
    });
  });

  describe('enterprise billing & scheduling access', () => {
    it('returns active enterprise subscription metadata without paywalls', async () => {
      const token = signTestToken(jwt, { sub: sessionUser!.userId, sid: sessionUser!.sid });
      const res = await request(app.getHttpServer())
        .get('/api/v1/app/billing')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.plan).toBe('enterprise');
      expect(res.body.status).toBe('active');
    });

    it('allows route access under enterprise licensing', async () => {
      const token = signTestToken(jwt, { sub: sessionUser!.userId, sid: sessionUser!.sid });
      await request(app.getHttpServer())
        .get('/api/v1/scheduling/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('validation', () => {
    it('rejects a request body with unknown fields (whitelist: true, forbidNonWhitelisted: true)', async () => {
      const token = signTestToken(jwt, { sub: sessionUser!.userId, sid: sessionUser!.sid });
      await request(app.getHttpServer())
        .patch('/api/v1/app/venue')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name', notAllowedField: 'should be rejected' })
        .expect(400);
    });
  });
});
