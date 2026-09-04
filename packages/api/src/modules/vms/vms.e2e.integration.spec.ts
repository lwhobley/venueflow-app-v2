import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../prisma/prisma.service';
import { bootstrapE2eApp, signTestToken } from '../../test/e2e-app';

/**
 * VMS end-to-end journey against a real Postgres database and the full Nest
 * module graph — guards, interceptors, validation pipe and all.
 *
 * The unit specs mock the Prisma client, which means they cannot catch a
 * missing column, a broken migration, a shadowed route or a tenant-isolation
 * gap. This file exercises the journey the checklist describes: vendor
 * onboarding → requisition → bid → confirmation → assignment → punch →
 * payroll export, plus the isolation and RBAC boundaries around it.
 */
describe('e2e: VMS vendor onboarding through payroll', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let teardown: () => Promise<void> = async () => {};

  type Actor = {
    userId: string;
    sessionId: string;
    profileId: string;
    token: string;
    venueId: string;
  };

  let manager: Actor;
  let outsider: Actor;
  let staffMember: Actor;

  let venueId = '';
  let otherVenueId = '';
  let organizationId = '';
  const createdUserIds: string[] = [];
  const venueIds: string[] = [];

  /**
   * Creates the legacy Venue and the hierarchical Facility that VMS rows
   * actually foreign-key to. The two deliberately share an id — the
   * compatibility convention established by the hierarchy migration and
   * documented in prisma/bootstrap-stadium-pilot.sql. Without the Facility row
   * every VMS insert fails on its composite foreign key.
   *
   * The coordinates live on the Facility because that is where geofencing
   * reads them from; a Facility with null coordinates flags every punch
   * `geofence_unconfigured` instead of checking distance.
   */
  async function makeVenue(label: string) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const venue = await prisma.venue.create({
      data: {
        name: `VMS ${label} ${suffix}`,
        code: `VW-VMS-${suffix.toUpperCase()}`,
        latitude: 34.1614,
        longitude: -118.1676,
        geofenceRadiusM: 500,
        timezone: 'UTC',
        subscriptionStatus: 'active',
        organization: { create: { name: `VMS Org ${suffix}`, code: `org-vms-${suffix}` } },
      },
      include: { organization: true },
    });
    venueIds.push(venue.id);

    await prisma.facility.create({
      data: {
        id: venue.id,
        organizationId: venue.organizationId,
        code: `FAC-${suffix.toUpperCase()}`,
        name: venue.name,
        timezone: 'UTC',
        latitude: 34.1614,
        longitude: -118.1676,
        active: true,
      },
    });

    return venue;
  }

  /**
   * VenueScopeInterceptor requires `venueId` and `profileId` claims on the JWT
   * — without them it never binds request.venueScope and every scoped
   * controller sees an undefined scope.
   */
  async function makeUser(venue: string, role: string, jobTitle: string) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const user = await prisma.user.create({ data: { email: `vms-${suffix}@test.local` } });
    createdUserIds.push(user.id);

    const profile = await prisma.profile.create({
      data: {
        userId: user.id,
        email: user.email!,
        fullName: `VMS ${role} ${suffix}`,
        role: role as never,
        jobTitle,
        venueId: venue,
      },
    });

    const session = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
    });
    const token = signTestToken(jwt, {
      sub: user.id,
      sid: session.id,
      venueId: venue,
      profileId: profile.id,
      role,
    });
    await prisma.session.update({
      where: { id: session.id },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });

    return { userId: user.id, sessionId: session.id, profileId: profile.id, token, venueId: venue };
  }

  /** Bearer token plus the venue header every scoped route expects. */
  const auth = (actor: { token: string; venueId: string }) => ({
    Authorization: `Bearer ${actor.token}`,
    'x-venue-id': actor.venueId,
  });

  beforeAll(async () => {
    const boot = await bootstrapE2eApp();
    app = boot.app;
    prisma = boot.prisma;
    jwt = boot.jwt;
    teardown = boot.teardown;

    const primary = await makeVenue('Primary');
    venueId = primary.id;
    organizationId = primary.organizationId;

    const other = await makeVenue('Other');
    otherVenueId = other.id;

    manager = await makeUser(venueId, 'manager', 'Workforce Manager');
    staffMember = await makeUser(venueId, 'staff', 'Server');
    outsider = await makeUser(otherVenueId, 'manager', 'Workforce Manager');

    // `prisma db push` syncs schema.prisma only and never runs the raw SQL in
    // prisma/migrations, so the audit-log immutability trigger does not exist
    // in a db-push test database. Recreate it here — the same approach
    // setup-test-db.ts takes for the auth bootstrap functions.
    //
    // UPDATE only, matching 20260904180000: guarding DELETE with a trigger made
    // it impossible to cascade-delete a Facility that had produced audit rows.
    // Deletion is blocked by privilege instead — stadium_api holds SELECT and
    // INSERT only — which the owner connection used here deliberately bypasses.
    await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS app_private');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION app_private.enforce_vms_audit_log_immutability()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
      BEGIN
        RAISE EXCEPTION 'VmsAuditLog records are immutable and cannot be updated or deleted.';
      END;
      $fn$;
    `);
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS enforce_vms_audit_log_immutability ON "VmsAuditLog"',
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER enforce_vms_audit_log_immutability
        BEFORE UPDATE ON "VmsAuditLog"
        FOR EACH ROW EXECUTE FUNCTION app_private.enforce_vms_audit_log_immutability();
    `);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    if (createdUserIds.length) {
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.profile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (venueIds.length) {
      await prisma.facility.deleteMany({ where: { id: { in: venueIds } } });
      await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
      await prisma.organization.deleteMany();
    }
    await teardown();
  });

  // These carry state across the ordered journey below.
  let vendorId = '';
  let workerId = '';
  let orderId = '';
  let fulfillmentId = '';
  let attendanceId = '';

  describe('access control', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/v1/vms/vendors').expect(401);
    });

    it('rejects a non-manager on a management endpoint', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/vms/vendors')
        .set(auth(staffMember))
        .expect(403);
    });

    it('allows a manager', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/vms/vendors')
        .set(auth(manager))
        .expect(200);
    });
  });

  describe('vendor onboarding', () => {
    it('creates a vendor', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vms/vendors')
        .set(auth(manager))
        .send({
          name: 'Apex Staffing',
          code: `APEX-${randomUUID().slice(0, 6)}`,
          vendorType: 'staffing_agency',
          contactEmail: 'ops@apex.test',
          billingRateMultiplier: 1.5,
        })
        .expect(201);

      vendorId = res.body.id;
      expect(res.body.status).toBe('active');
    });

    it('rejects a duplicate vendor code', async () => {
      const vendor = await prisma.vmsVendor.findUniqueOrThrow({ where: { id: vendorId } });
      await request(app.getHttpServer())
        .post('/api/v1/vms/vendors')
        .set(auth(manager))
        .send({ name: 'Copycat', code: vendor.code })
        .expect(400);
    });

    it('serves the CSV export rather than treating "export" as a vendor id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/vendors/export')
        .set(auth(manager))
        .expect(200);

      expect(res.text).toContain('Name');
      expect(res.text).toContain('Apex Staffing');
    });

    it('bulk imports vendors from CSV and skips duplicates on a second run', async () => {
      const code = `BULK-${randomUUID().slice(0, 6)}`;
      const csv = `name,code,contactEmail\nBulk Imported Co,${code},bulk@test.io\n`;

      const first = await request(app.getHttpServer())
        .post('/api/v1/vms/vendors/import')
        .set(auth(manager))
        .send({ csv })
        .expect(201);
      expect(first.body.imported).toBe(1);

      const second = await request(app.getHttpServer())
        .post('/api/v1/vms/vendors/import')
        .set(auth(manager))
        .send({ csv })
        .expect(201);
      expect(second.body.imported).toBe(0);
      expect(second.body.skipped).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('hides another venue\'s vendor', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/vms/vendors/${vendorId}`)
        .set(auth(outsider))
        .expect(404);
    });

    it('refuses a bid that references another venue\'s vendor', async () => {
      const order = await request(app.getHttpServer())
        .post('/api/v1/vms/orders')
        .set(auth(outsider))
        .send({
          title: 'Cross-tenant probe',
          roleRequired: 'Bartender',
          quantityRequested: 1,
          shiftDate: '2026-10-01',
          startTime: '16:00',
          endTime: '22:00',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/vms/orders/${order.body.id}/bids`)
        .set(auth(outsider))
        .send({ vendorId, staffCountAssigned: 1, bidHourlyRateCents: 2500 })
        .expect(404);
    });
  });

  describe('roster', () => {
    it('creates a worker with a PIN and never returns the credential', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vms/staff')
        .set(auth(manager))
        .send({
          firstName: 'Rosa',
          lastName: 'Klein',
          email: `rosa-${randomUUID().slice(0, 6)}@test.io`,
          vendorId,
          skills: ['Bartender'],
          hourlyRateCents: 3000,
          pin: '4821',
        })
        .expect(201);

      workerId = res.body.id;
      expect(res.body.pinHash).toBeUndefined();
      expect(res.body.pinSalt).toBeUndefined();
    });

    it('does not leak credentials through the vendor detail endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vms/vendors/${vendorId}`)
        .set(auth(manager))
        .expect(200);

      for (const member of res.body.staffMembers ?? []) {
        expect(member.pinHash).toBeUndefined();
        expect(member.pinSalt).toBeUndefined();
      }
    });

    it('filters the roster by skill', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/staff?role=Bartender')
        .set(auth(manager))
        .expect(200);

      expect(res.body.some((m: any) => m.id === workerId)).toBe(true);
    });
  });

  describe('requisition through confirmation', () => {
    it('creates an order', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vms/orders')
        .set(auth(manager))
        .send({
          title: 'Saturday bar service',
          roleRequired: 'Bartender',
          quantityRequested: 1,
          shiftDate: new Date().toISOString().split('T')[0],
          startTime: '00:01',
          endTime: '23:59',
          durationHours: 8,
        })
        .expect(201);

      orderId = res.body.id;
      expect(res.body.status).toBe('requested');
    });

    it('rejects an illegal status transition', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/vms/orders/${orderId}/status`)
        .set(auth(manager))
        .send({ status: 'draft' })
        .expect(400);
    });

    it('records a bid and confirms it', async () => {
      const bid = await request(app.getHttpServer())
        .post(`/api/v1/vms/orders/${orderId}/bids`)
        .set(auth(manager))
        .send({ vendorId, staffCountAssigned: 1, bidHourlyRateCents: 3000 })
        .expect(201);

      fulfillmentId = bid.body.id;

      await request(app.getHttpServer())
        .post(`/api/v1/vms/orders/fulfillments/${fulfillmentId}/confirm`)
        .set(auth(manager))
        .expect(201);

      const order = await prisma.vmsStaffingOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.quantityFulfilled).toBe(1);
      expect(order.status).toBe('confirmed');
    });
  });

  describe('assignment and availability', () => {
    it('assigns the worker to the order', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vms/orders/${orderId}/assignments`)
        .set(auth(manager))
        .send({ staffMemberId: workerId, fulfillmentId })
        .expect(201);

      expect(res.body.status).toBe('assigned');
    });

    it('refuses a second assignment that collides with an unavailable window', async () => {
      const shiftDate = new Date().toISOString().split('T')[0];

      await request(app.getHttpServer())
        .post('/api/v1/vms/staff/availability')
        .set(auth(manager))
        .send({
          staffMemberId: workerId,
          startDate: shiftDate,
          endDate: shiftDate,
          available: false,
          reason: 'Annual leave',
        })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/v1/vms/orders')
        .set(auth(manager))
        .send({
          title: 'Colliding shift',
          roleRequired: 'Bartender',
          quantityRequested: 1,
          shiftDate,
          startTime: '18:00',
          endTime: '23:00',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/vms/orders/${second.body.id}/assignments`)
        .set(auth(manager))
        .send({ staffMemberId: workerId })
        .expect(400);

      // The same call succeeds once the conflict is explicitly overridden.
      await request(app.getHttpServer())
        .post(`/api/v1/vms/orders/${second.body.id}/assignments`)
        .set(auth(manager))
        .send({ staffMemberId: workerId, force: true })
        .expect(201);
    });

    it('surfaces the double booking on the calendar', async () => {
      const day = new Date().toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vms/staff/calendar?from=${day}&to=${day}`)
        .set(auth(manager))
        .expect(200);

      expect(res.body.conflicts.length).toBeGreaterThan(0);
      expect(res.body.unavailableBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('time and attendance', () => {
    it('refuses a self-service punch with no credential presented', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/vms/attendance/clock-in')
        .set(auth(staffMember))
        .send({ staffMemberId: workerId })
        .expect(403);
    });

    it('refuses a self-service punch with the wrong PIN', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/vms/attendance/clock-in')
        .set(auth(staffMember))
        .send({ staffMemberId: workerId, pin: '0000' })
        .expect(400);
    });

    it('accepts the correct PIN and records the punch', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vms/attendance/clock-in')
        .set(auth(staffMember))
        .send({
          staffMemberId: workerId,
          pin: '4821',
          gpsLatitude: 34.1614,
          gpsLongitude: -118.1676,
        })
        .expect(201);

      attendanceId = res.body.id;
      expect(res.body.isWithinGeofence).toBe(true);
      // The vendor's 1.5x markup reaches the billed rate.
      expect(res.body.billedRateCents).toBe(4500);
    });

    it('rejects a second concurrent punch for the same worker', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/vms/attendance/clock-in')
        .set(auth(manager))
        .send({ staffMemberId: workerId })
        .expect(400);
    });

    it('rejects a break longer than the shift', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/vms/attendance/clock-out')
        .set(auth(manager))
        .send({ attendanceId, breakMinutes: 600 })
        .expect(400);
    });

    it('clocks out and computes billable hours', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/vms/attendance/clock-out')
        .set(auth(manager))
        .send({ attendanceId, breakMinutes: 0 })
        .expect(201);

      expect(res.body.clockOut).toBeTruthy();
      expect(res.body.billableHours).toBeGreaterThan(0);
      expect(res.body.pinHash).toBeUndefined();
    });

    it('approves the record', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/vms/attendance/${attendanceId}/approve`)
        .set(auth(manager))
        .expect(201);

      expect(res.body.status).toBe('approved');
    });
  });

  describe('payroll export', () => {
    it('exports ADP CSV containing the approved shift', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/attendance/payroll/adp')
        .set(auth(manager))
        .expect(200);

      expect(res.text).toContain('Co Code');
      expect(res.text).toContain('Klein, Rosa');
      expect(res.text).toContain('REG');
    });

    it('exports Gusto JSON with reconcilable totals', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/attendance/payroll/gusto')
        .set(auth(manager))
        .expect(200);

      expect(res.body.records.length).toBeGreaterThan(0);
      expect(res.body.totalHours).toBeGreaterThan(0);
    });
  });

  describe('audit trail', () => {
    it('completes the order through the audited status transition', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/vms/orders/${orderId}/status`)
        .set(auth(manager))
        .send({ status: 'completed' })
        .expect(200);

      const order = await prisma.vmsStaffingOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('completed');
    });

    it('records the journey with actor and before/after values', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/audit-logs?limit=100')
        .set(auth(manager))
        .expect(200);

      const actions = res.body.map((entry: any) => entry.action);
      expect(actions).toContain('CREATE');
      expect(actions).toContain('STATUS_CHANGE');
      expect(actions).toContain('ASSIGN_STAFF');
      expect(actions).toContain('APPROVE_HOURS');

      const statusChange = res.body.find((e: any) => e.action === 'STATUS_CHANGE');
      expect(statusChange.performedByUserId).toBe(manager.userId);
      expect(statusChange.changes.before).toBeDefined();
    });

    it('refuses to amend an audit entry', async () => {
      const entry = await prisma.vmsAuditLog.findFirstOrThrow({ where: { facilityId: venueId } });

      await expect(
        prisma.vmsAuditLog.update({ where: { id: entry.id }, data: { action: 'TAMPERED' } }),
      ).rejects.toThrow(/immutable/i);
    });

    it('withholds UPDATE and DELETE on the audit log from the runtime role', async () => {
      // Deletion is blocked by privilege rather than by a trigger, so that a
      // legitimate Facility teardown can still cascade. Assert the grant state
      // directly. The role only exists once migrations have run, so a db-push
      // database (which is what this suite uses) simply has nothing to check.
      const [role] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') AS present`,
      );
      if (!role?.present) return;

      const [grants] = await prisma.$queryRawUnsafe<
        Array<{ canUpdate: boolean; canDelete: boolean; canInsert: boolean }>
      >(`
        SELECT
          has_table_privilege('stadium_api', '"VmsAuditLog"', 'UPDATE') AS "canUpdate",
          has_table_privilege('stadium_api', '"VmsAuditLog"', 'DELETE') AS "canDelete",
          has_table_privilege('stadium_api', '"VmsAuditLog"', 'INSERT') AS "canInsert"
      `);

      expect(grants.canUpdate).toBe(false);
      expect(grants.canDelete).toBe(false);
      expect(grants.canInsert).toBe(true);
    });

    it('exports the audit trail as CSV', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/audit-logs/export?format=csv')
        .set(auth(manager))
        .expect(200);

      expect(typeof res.text === 'string' ? res.text : JSON.stringify(res.body)).toContain(
        'STATUS_CHANGE',
      );
    });
  });

  describe('analytics', () => {
    it('reports the vendor scorecard from real aggregates', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/analytics/vendor-scorecard')
        .set(auth(manager))
        .expect(200);

      const row = res.body.find((r: any) => r.vendorId === vendorId);
      expect(row).toBeDefined();
      expect(row.hasData).toBe(true);
      expect(row.totalBilledCents).toBeGreaterThan(0);
    });

    it('reports null rather than an invented rate for a vendor with no history', async () => {
      const fresh = await request(app.getHttpServer())
        .post('/api/v1/vms/vendors')
        .set(auth(manager))
        .send({ name: 'Untested Co', code: `NEW-${randomUUID().slice(0, 6)}` })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/vms/analytics/vendor-scorecard')
        .set(auth(manager))
        .expect(200);

      const row = res.body.find((r: any) => r.vendorId === fresh.body.id);
      expect(row.onTimeRatePercent).toBeNull();
      expect(row.hasData).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('refuses to delete a vendor with confirmed fulfillments', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/vms/vendors/${vendorId}`)
        .set(auth(manager))
        .expect(400);
    });

    it('deactivates instead, without losing data', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/vms/vendors/${vendorId}/deactivate`)
        .set(auth(manager))
        .send({ reason: 'Contract paused' })
        .expect(200);

      const vendor = await prisma.vmsVendor.findUniqueOrThrow({ where: { id: vendorId } });
      expect(vendor.status).toBe('inactive');

      const staffCount = await prisma.vmsStaffMember.count({ where: { vendorId } });
      expect(staffCount).toBeGreaterThan(0);
    });
  });
});
