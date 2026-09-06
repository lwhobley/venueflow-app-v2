import { Prisma } from '@prisma/client';

/**
 * Venue/Facility pairing.
 *
 * Auth, the mobile app, and every legacy `venueId`-scoped table key off
 * `Venue`. The stadium/VMS modules were added later against `Facility` and
 * foreign-key to it. The convention the whole codebase assumes is that the two
 * rows share a single UUID: `scope.venueId` is handed straight to
 * `facilityId` columns.
 *
 * Nothing enforced that convention on write, so a `Venue` created by
 * `registerVenue` had no `Facility`, and the first stadium/VMS write for that
 * tenant failed with a P2003 foreign-key violation (HTTP 500) rather than
 * anything the caller could act on.
 *
 * These helpers make the pairing lazily self-healing: any code path that needs
 * the organization for a venue also guarantees the paired Facility exists. A
 * missing Venue still throws — the tenant genuinely does not exist, and
 * inventing an organization for it would write rows into a tenant that is not
 * there.
 */

/** The Prisma surface these helpers need — satisfied by PrismaService and by a `$transaction` client. */
export type VenueFacilityClient = Pick<Prisma.TransactionClient, 'venue' | 'facility'>;

const VENUE_PAIRING_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  code: true,
  timezone: true,
  address: true,
  latitude: true,
  longitude: true,
  stadiumCapacity: true,
} as const;

type PairableVenue = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  timezone: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  stadiumCapacity: number | null;
};

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Create the Facility paired with an already-loaded Venue, if it is missing.
 *
 * Safe to call concurrently: a lost race surfaces as P2002 on the primary key,
 * which means the row this call wanted now exists. `Facility` also carries a
 * `@@unique([organizationId, code])`; if some other facility in the org already
 * holds the venue's code, the pairing falls back to a code derived from the
 * venue id so the same-id invariant still holds.
 */
export async function ensurePairedFacility(db: VenueFacilityClient, venue: PairableVenue): Promise<void> {
  const existing = await db.facility.findUnique({ where: { id: venue.id }, select: { id: true } });
  if (existing) return;

  const data = {
    id: venue.id,
    organizationId: venue.organizationId,
    name: venue.name,
    timezone: venue.timezone,
    address: venue.address,
    latitude: venue.latitude,
    longitude: venue.longitude,
    capacity: venue.stadiumCapacity,
  };

  try {
    await db.facility.create({ data: { ...data, code: venue.code } });
    return;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  // Either another writer created the pair first, or the venue's code is taken
  // inside this organization. Re-read before deciding which.
  if (await db.facility.findUnique({ where: { id: venue.id }, select: { id: true } })) return;

  try {
    await db.facility.create({ data: { ...data, code: `venue-${venue.id}` } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    if (!(await db.facility.findUnique({ where: { id: venue.id }, select: { id: true } }))) throw error;
  }
}

/**
 * Resolve a venue's organization, guaranteeing the paired Facility exists.
 *
 * Drop-in replacement for the `venue.findUniqueOrThrow(...).organizationId`
 * lookups the stadium/VMS controllers used to do by hand: same throw for an
 * unknown venue, but callers can now safely write `facilityId: scope.venueId`.
 */
export async function organizationIdForPairedVenue(db: VenueFacilityClient, venueId: string): Promise<string> {
  const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: VENUE_PAIRING_SELECT });
  await ensurePairedFacility(db, venue);
  return venue.organizationId;
}
