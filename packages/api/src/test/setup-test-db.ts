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

  return {
    prisma,
    url,
    teardown: async () => {
      await prisma.$disconnect();
      if (containerCleanup) await containerCleanup();
    },
  };
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
