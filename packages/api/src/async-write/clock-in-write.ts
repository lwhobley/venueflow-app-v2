import { Prisma } from '@prisma/client';

/**
 * The domain half of a queued `clock_in` write.
 *
 * Extracted from worker.ts because that module boots a RabbitMQ consumer on
 * import and so cannot be exercised directly.
 */

/** What the clock-in route enqueues; every field is required by ClockInDto. */
export type ClockInPayload = {
  profileId: string;
  clockInAt: string | number | Date;
  lat: number;
  lng: number;
  accuracy: number;
  mocked: boolean;
};

type ClockInClient = Pick<Prisma.TransactionClient, 'timeEntry'>;

export type ClockInResult = {
  accepted: true;
  status: 'completed';
  timeEntryId: string;
  clockInAt: string;
};

/**
 * A partial unique index allows a single open TimeEntry per profile, so a
 * P2002 here means this worker raced a punch that already landed — the staff
 * member is clocked in, which is exactly what the message asked for. Completing
 * the receipt against the existing punch keeps the write idempotent. Letting
 * the P2002 escape instead made `isPermanent()` classify the message as
 * poisoned and drop a punch that had, in fact, succeeded.
 */
export async function applyQueuedClockIn(
  tx: ClockInClient,
  venueId: string,
  payload: ClockInPayload,
): Promise<ClockInResult> {
  let timeEntry: { id: string; clockInAt: Date } | null = null;
  try {
    timeEntry = await tx.timeEntry.create({
      data: {
        profileId: payload.profileId,
        venueId,
        clockInAt: new Date(payload.clockInAt),
        clockInLat: payload.lat,
        clockInLng: payload.lng,
        clockInAccuracyM: payload.accuracy,
        clockInMocked: payload.mocked,
        isOpen: true,
      },
      select: { id: true, clockInAt: true },
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
    timeEntry = await tx.timeEntry.findFirst({
      where: { profileId: payload.profileId, venueId, isOpen: true },
      orderBy: { clockInAt: 'desc' },
      select: { id: true, clockInAt: true },
    });
    // No open punch after a uniqueness failure means the conflict was not the
    // open-punch index; there is nothing to complete against.
    if (!timeEntry) throw error;
  }

  return {
    accepted: true,
    status: 'completed',
    timeEntryId: timeEntry.id,
    clockInAt: timeEntry.clockInAt.toISOString(),
  };
}
