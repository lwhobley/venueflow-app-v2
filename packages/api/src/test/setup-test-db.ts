import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

let containerCleanup: (() => Promise<void>) | null = null;

/**
 * Provision a test Postgres database. Tries, in order:
 *   1. TEST_DATABASE_URL env var (Neon branch, local PG, etc.)
 *   2. Testcontainers (requires Docker)
 * Returns a connected PrismaClient + teardown function.
 * Throws if neither source is available.
 */
export async function setupTestDb(): Promise<{
  prisma: PrismaClient;
  url: string;
  teardown: () => Promise<void>;
}> {
  let url: string;

  if (process.env.TEST_DATABASE_URL) {
    url = process.env.TEST_DATABASE_URL;
  } else {
    const pg = await startContainer();
    url = pg.url;
    containerCleanup = pg.stop;
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  await prisma.$connect();
  await applyAuthBootstrapFunctions(prisma);

  return {
    prisma,
    url,
    teardown: async () => {
      await prisma.$disconnect();
      if (containerCleanup) await containerCleanup();
    },
  };
}

/**
 * `prisma db push` syncs schema.prisma only — it never runs the raw SQL in
 * prisma/migrations/*.sql, so a db-push test database never gets the
 * app_private.auth_lookup_session/auth_lookup_profiles SECURITY DEFINER
 * functions from migration 20260903140000_auth_bootstrap_security_definer.
 * AuthGuard now calls those UNCONDITIONALLY (not just for the eventual
 * NOBYPASSRLS cutover role — see that migration's comment) — every db-push
 * test database needs them too, or any test that drives a real authenticated
 * HTTP request (e.g. app.e2e.integration.spec.ts) 500s on its first request.
 *
 * Deliberately re-implemented here rather than executing the migration file's
 * raw text: splitting a multi-statement SQL file that contains a dollar-quoted
 * DO block on ad-hoc `;` boundaries is fragile, and Prisma's raw-query API
 * runs one statement per call. Keep this in sync with that migration's
 * CREATE FUNCTION bodies if they change — the shapes are guarded by
 * auth.guard.ts's SessionBootstrapRow/ProfileBootstrapRow types and exercised
 * end-to-end by app.e2e.integration.spec.ts, so drift here fails loudly.
 *
 * Safe under `db push`: no RLS is enabled in these test databases (that only
 * happens via the real migration chain), and TEST_DATABASE_URL/testcontainers
 * connect as a superuser, so SECURITY DEFINER has no special effect here
 * beyond making the functions callable — this exists purely so AuthGuard's
 * code path has something to call.
 */
async function applyAuthBootstrapFunctions(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS app_private`);
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION app_private.auth_lookup_session(p_session_id text)
    RETURNS TABLE ("userId" text, "expiresAt" timestamptz, "tokenHash" text)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT s."userId", s."expiresAt", s."tokenHash"
      FROM public."Session" s
      WHERE s.id = p_session_id;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION app_private.auth_lookup_profiles(p_user_id text, p_venue_id text DEFAULT NULL)
    RETURNS TABLE (
      "id" text,
      "email" text,
      "fullName" text,
      "role" "Role",
      "allAccess" boolean,
      "trialEndsAt" timestamptz,
      "venueId" text,
      "venueName" text,
      "venueSubscriptionStatus" text,
      "venueOrganizationId" text
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT
        p."id", p."email", p."fullName", p."role", p."allAccess", p."trialEndsAt", p."venueId",
        v."name", v."subscriptionStatus", v."organizationId"
      FROM public."Profile" p
      LEFT JOIN public."Venue" v ON v."id" = p."venueId"
      WHERE p."userId" = p_user_id
        AND (p_venue_id IS NULL OR p."venueId" = p_venue_id)
        AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active')
      ORDER BY p."createdAt" ASC
    $$
  `);
}

async function startContainer(): Promise<{ url: string; stop: () => Promise<void> }> {
  // Dynamic import so the dep is optional
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test')
    .withUsername('test')
    .withPassword('test')
    .start();
  return {
    url: container.getConnectionUri(),
    stop: async () => { await container.stop(); },
  };
}

/**
 * Seed minimal data for scheduling concurrency tests.
 * Returns stable IDs for the venue, two profiles, and a pre-created open shift.
 */
export async function seedSchedulingFixtures(prisma: PrismaClient) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const venue = await prisma.venue.create({
    data: {
      name: `Test Venue ${suffix}`,
      code: `VW-SCHED-${suffix.toUpperCase()}`,
      latitude: 40.7,
      longitude: -74.0,
      geofenceRadiusM: 100,
      timezone: 'America/New_York',
      organization: { create: { name: `Test Organization ${suffix}`, code: `org-vw-${suffix}` } },
    },
  });

  const [profileA, profileB] = await Promise.all([
    prisma.profile.create({
      data: {
        email: `alice-${suffix}@test.local`,
        fullName: 'Alice Test',
        role: 'staff',
        jobTitle: 'Server',
        venueId: venue.id,
      },
    }),
    prisma.profile.create({
      data: {
        email: `bob-${suffix}@test.local`,
        fullName: 'Bob Test',
        role: 'staff',
        jobTitle: 'Server',
        venueId: venue.id,
      },
    }),
  ]);

  const openShift = await prisma.scheduleShift.create({
    data: {
      venueId: venue.id,
      profileId: null,
      dayIndex: 1,
      startMinutes: 600,
      endMinutes: 900,
      jobTitle: 'Server',
      station: 'Floor',
      status: 'open',
    },
  });

  return { venue, profileA, profileB, openShift };
}

/**
 * Delete all rows from scheduling-related tables in reverse FK order.
 */
export async function cleanSchedulingData(prisma: PrismaClient) {
  try {
    await prisma.shiftSwap.deleteMany().catch(() => {});
    await prisma.scheduleShift.deleteMany().catch(() => {});
    await prisma.timeEntry.deleteMany().catch(() => {});
    await prisma.session.deleteMany().catch(() => {});
    await prisma.organizationMembership.deleteMany().catch(() => {});
    await prisma.facilityZone.deleteMany().catch(() => {});
    await prisma.facility.deleteMany().catch(() => {});
    await prisma.profile.deleteMany().catch(() => {});
    await prisma.venue.deleteMany().catch(() => {});
    await prisma.organization.deleteMany().catch(() => {});
  } catch {
    // Ignore transient cleanup errors
  }
}
