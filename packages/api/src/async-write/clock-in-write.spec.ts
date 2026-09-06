import { describe, expect, it, vi } from 'vitest';
import { applyQueuedClockIn } from './clock-in-write';

const CLOCK_IN_AT = new Date('2026-09-06T18:00:00.000Z');

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed on TimeEntry_profileId_open_key'), { code: 'P2002' });
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    timeEntry: {
      create: vi.fn().mockResolvedValue({ id: 'entry-1', clockInAt: CLOCK_IN_AT }),
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
  } as any;
}

const payload = {
  profileId: 'profile-1',
  clockInAt: CLOCK_IN_AT.toISOString(),
  lat: 40.7,
  lng: -74,
  accuracy: 8,
  mocked: false,
};

describe('applyQueuedClockIn', () => {
  it('creates the open punch and reports it', async () => {
    const tx = makeTx();

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).resolves.toEqual({
      accepted: true,
      status: 'completed',
      timeEntryId: 'entry-1',
      clockInAt: CLOCK_IN_AT.toISOString(),
    });
  });

  // Previously this P2002 escaped, isPermanent() classified the message as
  // poisoned, and a punch that had already landed was reported as a failure.
  it('completes against the existing punch when the worker races an open punch', async () => {
    const tx = makeTx({
      create: vi.fn().mockRejectedValue(uniqueViolation()),
      findFirst: vi.fn().mockResolvedValue({ id: 'entry-existing', clockInAt: CLOCK_IN_AT }),
    });

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).resolves.toEqual({
      accepted: true,
      status: 'completed',
      timeEntryId: 'entry-existing',
      clockInAt: CLOCK_IN_AT.toISOString(),
    });
    expect(tx.timeEntry.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'profile-1', venueId: 'venue-1', isOpen: true },
      orderBy: { clockInAt: 'desc' },
      select: { id: true, clockInAt: true },
    });
  });

  it('rethrows a uniqueness failure that left no open punch to complete against', async () => {
    const tx = makeTx({ create: vi.fn().mockRejectedValue(uniqueViolation()) });

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rethrows errors that are not uniqueness failures', async () => {
    const tx = makeTx({ create: vi.fn().mockRejectedValue(new Error('connection lost')) });

    await expect(applyQueuedClockIn(tx, 'venue-1', payload)).rejects.toThrow('connection lost');
    expect(tx.timeEntry.findFirst).not.toHaveBeenCalled();
  });
});
