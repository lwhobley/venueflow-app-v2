import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TimeClockController } from './time-clock.controller';

const venue = {
  id: 'venue-1',
  name: 'Test Venue',
  latitude: 40,
  longitude: -74,
  geofenceRadiusM: 100,
  timezone: 'America/New_York',
  earlyClockInWindowMin: 10,
  subscriptionStatus: 'active',
  subscriptionPlatform: null,
};

const profile = {
  id: 'staff-1',
  fullName: 'Alex Server',
  role: 'staff',
  jobTitle: 'Server',
  sickHoursAccrued: 0,
  ptoHoursAccrued: 0,
};

const validPunch = { lat: 40, lng: -74, accuracy: 10, mocked: false };

function makeController() {
  const prisma = {
    venue: { findUnique: vi.fn().mockResolvedValue(venue) },
    timeEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: 'entry-1',
        clockInAt: new Date(),
        clockOutAt: null,
        clockInLat: validPunch.lat,
        clockInLng: validPunch.lng,
        clockInAccuracyM: validPunch.accuracy,
        clockInMocked: false,
        isOpen: true,
        breaks: [],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn(),
    },
    profile: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(profile),
      findFirst: vi.fn().mockResolvedValue(profile),
      findUnique: vi.fn().mockResolvedValue(profile),
    },
    scheduleShift: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  } as any;
  const asyncWrites = { isEnabled: vi.fn().mockReturnValue(false), enqueue: vi.fn(), markResult: vi.fn() };
  const controller = new TimeClockController(prisma, asyncWrites as any);
  return { controller, prisma, asyncWrites };
}

const scope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false } as any;
const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false } as any;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimeClockController', () => {
  describe('clockIn', () => {
    it('rejects a missing scope', async () => {
      const { controller } = makeController();
      await expect(controller.clockIn(undefined as any, validPunch)).rejects.toThrow('Profile is not initialized');
    });

    it('rejects a mocked location', async () => {
      const { controller } = makeController();
      await expect(controller.clockIn(scope, { ...validPunch, mocked: true })).rejects.toThrow('Mocked locations are not allowed.');
    });

    it('rejects a punch outside the geofence', async () => {
      const { controller } = makeController();
      await expect(controller.clockIn(scope, { ...validPunch, lat: 41, lng: -74 })).rejects.toThrow('outside the venue geofence');
    });

    it('rejects a second clock-in while one is already open', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.findFirst.mockResolvedValue({ id: 'open-entry' });
      await expect(controller.clockIn(scope, validPunch)).rejects.toThrow('Already clocked in');
    });

    it('blocks staff from clocking in too early for their shift', async () => {
      const { controller, prisma } = makeController();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z')); // Wed noon UTC = 08:00 America/New_York
      prisma.scheduleShift.findFirst.mockResolvedValue({ startMinutes: 600, dayIndex: 3, status: 'scheduled' });

      await expect(controller.clockIn(scope, validPunch)).rejects.toThrow('Too early to clock in');
    });

    it('does not apply the early-shift check to managers', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findUniqueOrThrow.mockResolvedValue({ ...profile, id: 'manager-1', role: 'manager' });

      const result = await controller.clockIn(managerScope, validPunch);

      expect(prisma.scheduleShift.findFirst).not.toHaveBeenCalled();
      expect(result.memberId).toBe('manager-1');
    });

    it('creates an open time entry on a valid punch', async () => {
      const { controller, prisma } = makeController();

      const result = await controller.clockIn(scope, validPunch);

      expect(prisma.timeEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          profileId: 'staff-1',
          venueId: 'venue-1',
          isOpen: true,
          clockInLat: 40,
          clockInLng: -74,
        }),
      });
      expect(result.isOpen).toBe(true);
    });

    it('converts a unique-constraint race into "Already clocked in"', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.create.mockRejectedValue({ code: 'P2002' });

      await expect(controller.clockIn(scope, validPunch)).rejects.toThrow('Already clocked in');
    });

    it('rethrows unrelated errors from entry creation', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.create.mockRejectedValue(new Error('db down'));

      await expect(controller.clockIn(scope, validPunch)).rejects.toThrow('db down');
    });
  });

  describe('clockOut', () => {
    it('rejects when there is no active clock-in', async () => {
      const { controller } = makeController();
      await expect(controller.clockOut(scope, validPunch)).rejects.toThrow('No active clock-in found');
    });

    it('closes the open entry on a valid punch', async () => {
      const { controller, prisma } = makeController();
      const openEntry = { id: 'entry-1', updatedAt: new Date('2026-07-15T00:00:00Z') };
      prisma.timeEntry.findFirst.mockResolvedValue(openEntry);
      prisma.timeEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'entry-1',
        clockInAt: new Date(),
        clockOutAt: new Date(),
        isOpen: false,
        breaks: [],
      });

      await controller.clockOut(scope, validPunch);

      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'entry-1', isOpen: true, updatedAt: openEntry.updatedAt },
        data: expect.objectContaining({ isOpen: false }),
      });
    });

    it('surfaces a conflict when the entry changed between read and write', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.findFirst.mockResolvedValue({ id: 'entry-1', updatedAt: new Date() });
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(controller.clockOut(scope, validPunch)).rejects.toThrow('Clock-out state changed. Refresh and try again.');
    });
  });

  describe('startBreak', () => {
    it('rejects when there is no active clock-in', async () => {
      const { controller } = makeController();
      await expect(controller.startBreak(scope, { type: 'unpaid' })).rejects.toThrow('No active clock-in found');
    });

    it('rejects starting a break while already on one', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.findFirst.mockResolvedValue({
        id: 'entry-1',
        updatedAt: new Date(),
        breaks: [{ startAt: Date.now(), endAt: null, type: 'unpaid' }],
      });

      await expect(controller.startBreak(scope, { type: 'unpaid' })).rejects.toThrow('Already on a break');
    });

    it('appends a new break to the entry', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.findFirst.mockResolvedValue({ id: 'entry-1', updatedAt: new Date(), breaks: [] });
      prisma.timeEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'entry-1',
        clockInAt: new Date(),
        clockOutAt: null,
        isOpen: true,
        breaks: [{ startAt: Date.now(), endAt: null, type: 'unpaid' }],
      });

      await controller.startBreak(scope, { type: 'unpaid' });

      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'entry-1', isOpen: true, updatedAt: expect.any(Date) },
        data: { breaks: [expect.objectContaining({ endAt: null, type: 'unpaid' })] },
      });
    });
  });

  describe('endBreak', () => {
    it('rejects when there is no active clock-in', async () => {
      const { controller } = makeController();
      await expect(controller.endBreak(scope)).rejects.toThrow('No active clock-in found');
    });

    it('rejects ending a break when not currently on one', async () => {
      const { controller, prisma } = makeController();
      prisma.timeEntry.findFirst.mockResolvedValue({ id: 'entry-1', updatedAt: new Date(), breaks: [] });

      await expect(controller.endBreak(scope)).rejects.toThrow('Not currently on a break');
    });

    it('closes out the active break', async () => {
      const { controller, prisma } = makeController();
      const startAt = Date.now() - 60000;
      prisma.timeEntry.findFirst.mockResolvedValue({
        id: 'entry-1',
        updatedAt: new Date(),
        breaks: [{ startAt, endAt: null, type: 'unpaid' }],
      });
      prisma.timeEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'entry-1',
        clockInAt: new Date(),
        clockOutAt: null,
        isOpen: true,
        breaks: [{ startAt, endAt: Date.now(), type: 'unpaid' }],
      });

      await controller.endBreak(scope);

      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'entry-1', isOpen: true, updatedAt: expect.any(Date) },
        data: { breaks: [expect.objectContaining({ startAt, endAt: expect.any(Number) })] },
      });
    });
  });

  describe('getMyTimeClock', () => {
    it('returns null when the caller has no profile', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findFirst = vi.fn().mockResolvedValue(null);

      const result = await controller.getMyTimeClock({ sub: 'user-1' } as any, scope);

      expect(result).toBeNull();
    });

    it('subtracts unpaid break time from regular hours', async () => {
      const { controller, prisma } = makeController();
      prisma.profile.findFirst = vi.fn().mockResolvedValue({ ...profile, venue: { timezone: 'America/New_York' } });
      const clockInAt = new Date(Date.now() - 4 * 3600000);
      const clockOutAt = new Date(Date.now() - 1 * 3600000);
      prisma.timeEntry.findMany.mockResolvedValue([
        {
          isOpen: false,
          clockInAt,
          clockOutAt,
          breaks: [{ type: 'unpaid', startAt: clockInAt.getTime() + 1800000, endAt: clockInAt.getTime() + 3600000 }],
        },
      ]);

      const result = await controller.getMyTimeClock({ sub: 'user-1' } as any, scope);

      expect(result!.isClockedIn).toBe(false);
      expect(result!.regularHours).toBe(2.5);
    });
  });
});
