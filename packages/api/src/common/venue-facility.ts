import { Prisma } from '@prisma/client';

type VenueFacilityClient = {
  venue: {
    findUniqueOrThrow: Prisma.VenueDelegate['findUniqueOrThrow'];
  };
  facility: {
    findUnique: Prisma.FacilityDelegate['findUnique'];
    create: Prisma.FacilityDelegate['create'];
  };
};

/**
 * Legacy Venue rows and hierarchical Facility rows share an id. Stadium/VMS
 * models FK to Facility; Auth and the mobile app still key off Venue.
 * Creating a Venue without a same-id Facility makes every facility-scoped
 * write fail on P2003.
 */
export async function organizationIdForPairedVenue(
  db: VenueFacilityClient,
  venueId: string,
): Promise<string> {
  const venue = await db.venue.findUniqueOrThrow({
    where: { id: venueId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      code: true,
      timezone: true,
      address: true,
      latitude: true,
      longitude: true,
      stadiumCapacity: true,
    },
  });

  const existing = await db.facility.findUnique({
    where: { id: venue.id },
    select: { id: true },
  });
  if (!existing) {
    await db.facility.create({
      data: {
        id: venue.id,
        organizationId: venue.organizationId,
        code: venue.code,
        name: venue.name,
        timezone: venue.timezone,
        address: venue.address,
        latitude: venue.latitude,
        longitude: venue.longitude,
        capacity: venue.stadiumCapacity,
        active: true,
      },
    });
  }

  return venue.organizationId;
}
