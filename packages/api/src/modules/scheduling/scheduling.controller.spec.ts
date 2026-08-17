import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

const bigVenue = {
  id: 'venue-1',
  name: 'Test Venue',
  timezone: 'America/New_York',
  weeklyLaborBudgetHours: null,
  schedulePublishedAt: null,
  schedulePublishedById: null,
  scheduleUpdatedAfterPublishAt: null,
};

function makeController() {
  const prisma = {
    venue: {
      findUnique: vi.fn().mockResolvedValue({ ...bigVenue }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...bigVenue }),
      update: vi.fn().mockResolvedValue({}),
    },
    blackoutDate: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'blackout-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
    },
    scheduleShift: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    profile: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'staff-1', fullName: 'Staff One', venueId: 'venue-1', email: 's1@test.com' }),
    },
    scheduleMemoryNote: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'note-1', title: 't', detail: 'd', weekStart: '2026-07-12', createdAt: new Date() }),
    },
    scheduleTemplate: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
    },
    shiftSwap: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    reservation: { findMany: vi.fn().mockResolvedValue([]) },
    venueEvent: { findMany: vi.fn().mockResolvedValue([]) },
    staffRequest: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  } as any;

  const notifications = {
    notifyProfile: vi.fn().mockResolvedValue(undefined),
    notifyManagers: vi.fn().mockResolvedValue(undefined),
    notifyStaff: vi.fn().mockResolvedValue(undefined),
  } as any;

  const email = {
    send: vi.fn().mockResolvedValue(undefined),
    sendToProfile: vi.fn().mockResolvedValue(undefined),
    sendToVenueManagers: vi.fn().mockResolvedValue(undefined),
  } as any;

  const assignments = {
    createShift: vi.fn(),
    updateShift: vi.fn(),
    assignShift: vi.fn(),
    deleteShift: vi.fn(),
    claimOpenShift: vi.fn(),
    applyTemplate: vi.fn(),
    copyDayShifts: vi.fn(),
    clearWeek: vi.fn(),
    restoreShifts: vi.fn(),
    applyOpenAssignments: vi.fn(),
    proposeSwap: vi.fn(),
    respondToSwap: vi.fn(),
    reviewSwap: vi.fn(),
  } as any;

  const aiScheduler = {
    generateDraft: vi.fn(),
  } as any;

  const controller = new SchedulingController(prisma, notifications, email, assignments, aiScheduler);
  return { controller, prisma, notifications, email, assignments, aiScheduler };
}

const managerScope = { venueId: 'venue-1', profileId: 'manager-1', role: 'manager', allAccess: false, fullName: 'Manager Mike' } as any;
const staffScope = { venueId: 'venue-1', profileId: 'staff-1', role: 'staff', allAccess: false, fullName: 'Staff Sam' } as any;

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SchedulingController', () => {
  it('logs detached email-query failures instead of leaking an unhandled rejection', async () => {
    const { controller } = makeController();
    const error = new Error('db down');
    vi.spyOn(controller as any, 'sendManagerSwapApprovalEmailInBackground').mockRejectedValue(error);
    const log = vi.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);

    (controller as any).sendManagerSwapApprovalEmail('venue-1', 'swap-1');
    await flush();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('manager swap approval email failed: db down'),
      error.stack,
    );
  });

  // ---------------------------------------------------------------------
  // 1. Authorization guards
  // ---------------------------------------------------------------------
  describe('manager-only guard', () => {
    it('rejects staff from creating a shift', async () => {
      const { controller } = makeController();
      await expect(
        controller.createShift(staffScope, { dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from deleting a shift', async () => {
      const { controller } = makeController();
      await expect(controller.deleteShift(staffScope, 'shift-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from adding a blackout date', async () => {
      const { controller } = makeController();
      await expect(
        controller.addBlackout(staffScope, { startDate: '2026-08-01', reason: 'Closed' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from reviewing a shift swap', async () => {
      const { controller } = makeController();
      await expect(controller.reviewShiftSwap(staffScope, 'swap-1', { approve: true })).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from previewing the AI schedule', async () => {
      const { controller } = makeController();
      await expect(controller.previewAiSchedule(staffScope)).rejects.toThrow(ForbiddenException);
    });

    it('rejects staff from committing the AI schedule', async () => {
      const { controller } = makeController();
      await expect(controller.commitAiSchedule(staffScope, { shifts: [] })).rejects.toThrow(ForbiddenException);
    });

    it('rejects an undefined scope the same as a staff role', async () => {
      const { controller } = makeController();
      await expect(controller.getManagerSchedule(undefined as any)).rejects.toThrow(ForbiddenException);
    });

    it('allows a manager through the guard', async () => {
      const { controller, prisma } = makeController();
      prisma.blackoutDate.create.mockResolvedValue({ id: 'blackout-9' });
      const id = await controller.addBlackout(managerScope, { startDate: '2026-08-01', reason: 'Closed' } as any);
      expect(id).toBe('blackout-9');
    });
  });

  describe('no-scope guard (self-service endpoints)', () => {
    it('rejects claimOpenShift with no scope', async () => {
      const { controller } = makeController();
      await expect(controller.claimOpenShift(undefined as any, 'shift-1')).rejects.toThrow('Profile does not belong to a venue');
    });

    it('rejects proposeShiftSwap with no scope', async () => {
      const { controller } = makeController();
      await expect(
        controller.proposeShiftSwap(undefined as any, { myShiftId: 's1', targetProfileId: 'p2' }),
      ).rejects.toThrow('Profile does not belong to a venue');
    });

    it('rejects respondToShiftSwap with no scope', async () => {
      const { controller } = makeController();
      await expect(controller.respondToShiftSwap(undefined as any, 'swap-1', { accept: true })).rejects.toThrow(
        'Profile does not belong to a venue',
      );
    });

    it('returns empty defaults for read endpoints with no scope instead of throwing', async () => {
      const { controller } = makeController();
      await expect(controller.getMySchedule(undefined as any)).resolves.toEqual({ mine: [], open: [], roster: [] });
      await expect(controller.getMyShiftSwaps(undefined as any)).resolves.toEqual([]);
      await expect(controller.listBlackouts(undefined as any)).resolves.toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // 2. Tenant isolation
  // ---------------------------------------------------------------------
  describe('tenant isolation', () => {
    it('scopes createShift to the caller venue', async () => {
      const { controller, assignments } = makeController();
      assignments.createShift.mockResolvedValue({ id: 'shift-1' });

      await controller.createShift(managerScope, {
        dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor',
      } as any);

      expect(assignments.createShift).toHaveBeenCalledWith(expect.objectContaining({ venueId: 'venue-1' }));
    });

    it('scopes the manager schedule queries to the caller venue', async () => {
      const { controller, prisma } = makeController();

      await controller.getManagerSchedule(managerScope, '2026-08-02');

      expect(prisma.venue.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'venue-1' } });
      expect(prisma.scheduleShift.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1', weekStart: '2026-08-02' }) }));
      expect(prisma.profile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ venueId: 'venue-1' }) }));
    });

    it('scopes listBlackouts to the caller venue', async () => {
      const { controller, prisma } = makeController();

      await controller.listBlackouts(managerScope);

      expect(prisma.blackoutDate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { venueId: 'venue-1' } }));
    });

    it('does not leak another venue shift into deleteShift/updateShift lookups', async () => {
      const { controller, assignments } = makeController();
      assignments.deleteShift.mockResolvedValue({
        id: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'scheduled', profileId: null, notes: null,
      });

      await controller.deleteShift(managerScope, 'shift-1');

      expect(assignments.deleteShift).toHaveBeenCalledWith({ venueId: 'venue-1', shiftId: 'shift-1' });
    });
  });

  // ---------------------------------------------------------------------
  // 3. Shift mutation endpoints (highest blast radius)
  // ---------------------------------------------------------------------
  describe('createShift', () => {
    it('rejects an invalid shift window before calling the assignment service', async () => {
      const { controller, assignments } = makeController();

      await expect(
        controller.createShift(managerScope, { dayIndex: 1, startMinutes: 900, endMinutes: 600, jobTitle: 'Server', station: 'Floor' } as any),
      ).rejects.toThrow('End time must be after start time');
      expect(assignments.createShift).not.toHaveBeenCalled();
    });

    it('does not notify anyone when the shift is created unassigned', async () => {
      const { controller, assignments, notifications } = makeController();
      assignments.createShift.mockResolvedValue({ id: 'shift-1' });

      await controller.createShift(managerScope, { dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' } as any);

      expect(notifications.notifyProfile).not.toHaveBeenCalled();
    });

    it('notifies the assigned profile and fires the update email when profileId is set', async () => {
      const { controller, prisma, assignments, notifications, email } = makeController();
      assignments.createShift.mockResolvedValue({ id: 'shift-1' });

      const id = await controller.createShift(managerScope, {
        dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', profileId: 'staff-1',
      } as any);
      await flush();

      expect(id).toBe('shift-1');
      expect(notifications.notifyProfile).toHaveBeenCalledWith(expect.objectContaining({
        venueId: 'venue-1', profileId: 'staff-1', kind: 'shift_assigned',
      }));
      expect(prisma.profile.findUnique).toHaveBeenCalledWith({ where: { id: 'staff-1' } });
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-1', expect.objectContaining({ subject: expect.any(String) }));
    });
  });

  describe('updateShift', () => {
    it('rejects an invalid shift window', async () => {
      const { controller, assignments } = makeController();
      await expect(
        controller.updateShift(managerScope, 'shift-1', { dayIndex: 9, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' } as any),
      ).rejects.toThrow('dayIndex must be between 0 and 6');
      expect(assignments.updateShift).not.toHaveBeenCalled();
    });

    it('delegates to the assignment service scoped to the venue and shift', async () => {
      const { controller, assignments } = makeController();
      assignments.updateShift.mockResolvedValue({ id: 'shift-1', profileId: null, dayIndex: 1, startMinutes: 600, endMinutes: 900, station: 'Floor' });

      await controller.updateShift(managerScope, 'shift-1', { dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' } as any);

      expect(assignments.updateShift).toHaveBeenCalledWith(expect.objectContaining({ venueId: 'venue-1', shiftId: 'shift-1' }));
    });
  });

  describe('assignShift', () => {
    it('sends an Added email only when newly assigning an open shift', async () => {
      const { controller, prisma, assignments, email } = makeController();
      assignments.assignShift.mockResolvedValue({
        shift: { dayIndex: 1, startMinutes: 600, endMinutes: 900, station: 'Floor', profileId: null },
        nextProfileId: 'staff-1',
      });

      await controller.assignShift(managerScope, 'shift-1', { profileId: 'staff-1' });
      await flush();

      expect(assignments.assignShift).toHaveBeenCalledWith({ venueId: 'venue-1', shiftId: 'shift-1', profileId: 'staff-1' });
      expect(prisma.profile.findUnique).toHaveBeenCalledWith({ where: { id: 'staff-1' } });
      expect(email.sendToProfile).toHaveBeenCalledTimes(1);
    });

    it('sends a Removed email only when unassigning', async () => {
      const { controller, assignments, email } = makeController();
      assignments.assignShift.mockResolvedValue({
        shift: { dayIndex: 1, startMinutes: 600, endMinutes: 900, station: 'Floor', profileId: 'staff-1' },
        nextProfileId: null,
      });

      await controller.assignShift(managerScope, 'shift-1', {});
      await flush();

      expect(email.sendToProfile).toHaveBeenCalledTimes(1);
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-1', expect.anything());
    });

    it('sends both an Added and a Removed email when reassigning to a different profile', async () => {
      const { controller, assignments, email } = makeController();
      assignments.assignShift.mockResolvedValue({
        shift: { dayIndex: 1, startMinutes: 600, endMinutes: 900, station: 'Floor', profileId: 'staff-1' },
        nextProfileId: 'staff-2',
      });

      await controller.assignShift(managerScope, 'shift-1', { profileId: 'staff-2' });
      await flush();

      expect(email.sendToProfile).toHaveBeenCalledTimes(2);
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-2', expect.anything());
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-1', expect.anything());
    });
  });

  describe('deleteShift', () => {
    it('returns the deleted shift snapshot and notifies the previously assigned profile', async () => {
      const { controller, assignments, email } = makeController();
      assignments.deleteShift.mockResolvedValue({
        id: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'scheduled', profileId: 'staff-1', notes: null,
      });

      const result = await controller.deleteShift(managerScope, 'shift-1');
      await flush();

      expect(result).toEqual(expect.objectContaining({ dayIndex: 1, profileId: 'staff-1' }));
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-1', expect.anything());
    });

    it('does not send an email when the deleted shift had no assignee', async () => {
      const { controller, assignments, email } = makeController();
      assignments.deleteShift.mockResolvedValue({
        id: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'open', profileId: null, notes: null,
      });

      await controller.deleteShift(managerScope, 'shift-1');
      await flush();

      expect(email.sendToProfile).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Claim open shift
  // ---------------------------------------------------------------------
  describe('claimOpenShift', () => {
    it('delegates to the assignment service and notifies managers', async () => {
      const { controller, assignments, notifications, email } = makeController();
      assignments.claimOpenShift.mockResolvedValue({ id: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' });

      const result = await controller.claimOpenShift(staffScope, 'shift-1');

      expect(assignments.claimOpenShift).toHaveBeenCalledWith({ venueId: 'venue-1', profileId: 'staff-1', shiftId: 'shift-1' });
      expect(notifications.notifyManagers).toHaveBeenCalledWith(expect.objectContaining({ venueId: 'venue-1', kind: 'shift_assigned' }));
      expect(email.sendToVenueManagers).toHaveBeenCalledWith('venue-1', expect.anything());
      expect(result).toEqual({ ok: true });
    });
  });

  // ---------------------------------------------------------------------
  // Publish schedule
  // ---------------------------------------------------------------------
  describe('publishSchedule', () => {
    it('publishes, notifies staff, and emails the manager plus each assigned staff member', async () => {
      const { controller, prisma, notifications, email } = makeController();
      prisma.scheduleShift.findMany.mockResolvedValue([
        { id: 's1', profileId: 'staff-1', status: 'scheduled', dayIndex: 1, startMinutes: 600, endMinutes: 900, station: 'Floor' },
        { id: 's2', profileId: null, status: 'open', dayIndex: 2, startMinutes: 600, endMinutes: 900, station: 'Bar' },
      ]);
      prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1', fullName: 'Alex', email: 'alex@test.com' }]);

      const result = await controller.publishSchedule(managerScope, { weekStart: '2026-08-02' });

      expect(result).toEqual({ notified: 1 });
      expect(prisma.venue.update).toHaveBeenCalledWith({
        where: { id: 'venue-1' },
        data: expect.objectContaining({
          schedulePublishedAt: expect.any(Date),
          schedulePublishedById: 'manager-1',
          scheduleUpdatedAfterPublishAt: null,
        }),
      });
      expect(notifications.notifyStaff).toHaveBeenCalledWith(expect.objectContaining({ venueId: 'venue-1', kind: 'schedule_published' }));
      // One email to the publishing manager, one to the single assigned staff member.
      expect(email.sendToProfile).toHaveBeenCalledTimes(2);
      expect(email.sendToProfile).toHaveBeenCalledWith('manager-1', expect.anything());
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-1', expect.anything());
    });
  });

  // ---------------------------------------------------------------------
  // Shift swaps
  // ---------------------------------------------------------------------
  describe('proposeShiftSwap', () => {
    it('delegates to the assignment service and notifies the target', async () => {
      const { controller, assignments, notifications, email } = makeController();
      assignments.proposeSwap.mockResolvedValue({
        swap: { id: 'swap-1' },
        requesterShift: { dayIndex: 1, startMinutes: 600, endMinutes: 900 },
        target: { id: 'staff-2' },
      });

      const id = await controller.proposeShiftSwap(staffScope, { myShiftId: 'shift-1', targetProfileId: 'staff-2' });

      expect(id).toBe('swap-1');
      expect(assignments.proposeSwap).toHaveBeenCalledWith(expect.objectContaining({
        venueId: 'venue-1', requesterProfileId: 'staff-1', requesterShiftId: 'shift-1', targetProfileId: 'staff-2',
      }));
      expect(notifications.notifyProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'staff-2', kind: 'swap_proposed' }));
      expect(email.sendToProfile).toHaveBeenCalledWith('staff-2', expect.anything());
    });
  });

  describe('respondToShiftSwap', () => {
    it('notifies managers only when the swap is accepted', async () => {
      const { controller, assignments, notifications } = makeController();
      assignments.respondToSwap.mockResolvedValue({ id: 'swap-1', targetProfileId: 'staff-1' });

      await controller.respondToShiftSwap(staffScope, 'swap-1', { accept: true });

      expect(assignments.respondToSwap).toHaveBeenCalledWith({ venueId: 'venue-1', swapId: 'swap-1', profileId: 'staff-1', accept: true });
      expect(notifications.notifyManagers).toHaveBeenCalledWith(expect.objectContaining({ kind: 'swap_proposed' }));
    });

    it('does not notify managers when the swap is declined', async () => {
      const { controller, assignments, notifications } = makeController();
      assignments.respondToSwap.mockResolvedValue({ id: 'swap-1', targetProfileId: 'staff-1' });

      await controller.respondToShiftSwap(staffScope, 'swap-1', { accept: false });

      expect(notifications.notifyManagers).not.toHaveBeenCalled();
    });
  });

  describe('reviewShiftSwap', () => {
    it('notifies both parties with an approved title when approved', async () => {
      const { controller, assignments, notifications } = makeController();
      assignments.reviewSwap.mockResolvedValue({ id: 'swap-1', requesterProfileId: 'staff-1', targetProfileId: 'staff-2' });

      await controller.reviewShiftSwap(managerScope, 'swap-1', { approve: true });

      expect(assignments.reviewSwap).toHaveBeenCalledWith({ venueId: 'venue-1', swapId: 'swap-1', approve: true });
      expect(notifications.notifyProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'staff-1', title: 'Swap approved' }));
      expect(notifications.notifyProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'staff-2', title: 'Swap approved' }));
    });

    it('notifies both parties with a denied title when denied', async () => {
      const { controller, assignments, notifications } = makeController();
      assignments.reviewSwap.mockResolvedValue({ id: 'swap-1', requesterProfileId: 'staff-1', targetProfileId: 'staff-2' });

      await controller.reviewShiftSwap(managerScope, 'swap-1', { approve: false });

      expect(notifications.notifyProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'staff-1', title: 'Swap denied' }));
      expect(notifications.notifyProfile).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'staff-2', title: 'Swap denied' }));
    });
  });

  describe('listShiftSwaps', () => {
    it('rejects staff and scopes pending swaps to the venue for managers', async () => {
      const { controller, prisma } = makeController();
      await expect(controller.listShiftSwaps(staffScope)).rejects.toThrow(ForbiddenException);

      await controller.listShiftSwaps(managerScope);
      expect(prisma.shiftSwap.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { venueId: 'venue-1', status: { in: ['proposed', 'accepted'] } },
      }));
    });
  });

  // ---------------------------------------------------------------------
  // 4. AI scheduler integration
  // ---------------------------------------------------------------------
  describe('previewAiSchedule', () => {
    it('applies the shared rate limit before doing any other work', async () => {
      const { controller, prisma, aiScheduler } = makeController();
      (assertWithinSharedRateLimit as any).mockRejectedValueOnce(new Error('Too many AI schedule requests. Try again in a few minutes.'));

      await expect(controller.previewAiSchedule(managerScope)).rejects.toThrow('Too many AI schedule requests');
      expect(aiScheduler.generateDraft).not.toHaveBeenCalled();
      expect(prisma.venue.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an invalid weekStartDate', async () => {
      const { controller } = makeController();
      await expect(controller.previewAiSchedule(managerScope, 'not-a-date')).rejects.toThrow('weekStartDate must be a YYYY-MM-DD date');
    });

    it('wires the AI draft response into dayLabel/time/memberName fields', async () => {
      const { controller, prisma, aiScheduler } = makeController();
      prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1', fullName: 'Alex', jobTitle: 'Server', role: 'staff' }]);
      aiScheduler.generateDraft.mockResolvedValue({
        shifts: [{ dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', profileId: 'staff-1', reason: 'fills gap' }],
      });

      const result = await controller.previewAiSchedule(managerScope, '2026-08-02');

      expect(aiScheduler.generateDraft).toHaveBeenCalled();
      expect(result.shifts[0]).toEqual(expect.objectContaining({
        dayLabel: 'Mon', startTime: '10:00 AM', endTime: '3:00 PM', memberName: 'Alex',
      }));
    });

    it('propagates the AI service error (e.g. missing API key) unchanged', async () => {
      const { controller, aiScheduler } = makeController();
      aiScheduler.generateDraft.mockRejectedValue(new BadRequestException('AI parsing requires GEMINI_API_KEY configuration'));

      await expect(controller.previewAiSchedule(managerScope)).rejects.toThrow('AI parsing requires GEMINI_API_KEY configuration');
    });
  });

  describe('commitAiSchedule', () => {
    it('creates a shift with the proposed profile when no unavailable-day request blocks it', async () => {
      const { controller, prisma, assignments } = makeController();
      assignments.createShift.mockResolvedValue({ id: 'shift-1' });

      const result = await controller.commitAiSchedule(managerScope, {
        shifts: [{ dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', profileId: 'staff-1' }],
      });

      expect(result).toEqual({ created: 1, failed: [] });
      expect(assignments.createShift).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'staff-1', notes: 'Created by AI schedule builder' }));
    });

    it('flags a proposed profile as failed when an approved unavailable-days request covers it instead of opening the shift', async () => {
      const { controller, prisma, assignments } = makeController();
      prisma.staffRequest.findMany.mockResolvedValue([{ profileId: 'staff-1', requestedRangeStart: '2000-01-01', requestedRangeEnd: '2099-01-01', requestedForDate: null }]);
      prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1', fullName: 'Alex' }]);
      assignments.createShift.mockResolvedValue({ id: 'shift-1' });

      const result = await controller.commitAiSchedule(managerScope, {
        shifts: [{ dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', profileId: 'staff-1' }],
      });

      expect(result).toEqual({ created: 0, failed: [{ shift: expect.any(String), error: expect.stringContaining('is unavailable') }] });
      expect(assignments.createShift).not.toHaveBeenCalled();
    });

    it('collects an invalid shift window into failed without calling the assignment service', async () => {
      const { controller, assignments } = makeController();

      const result = await controller.commitAiSchedule(managerScope, {
        shifts: [{ dayIndex: 1, startMinutes: 900, endMinutes: 600, jobTitle: 'Server', station: 'Floor' }],
      });

      expect(result.created).toBe(0);
      expect(result.failed).toHaveLength(1);
      expect(assignments.createShift).not.toHaveBeenCalled();
    });

    it('continues processing remaining shifts after the assignment service throws for one', async () => {
      const { controller, assignments } = makeController();
      assignments.createShift
        .mockRejectedValueOnce(new BadRequestException('This assignment overlaps another shift.'))
        .mockResolvedValueOnce({ id: 'shift-2' });

      const result = await controller.commitAiSchedule(managerScope, {
        shifts: [
          { dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' },
          { dayIndex: 2, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' },
        ],
      });

      expect(result.created).toBe(1);
      expect(result.failed).toEqual([expect.objectContaining({ error: 'This assignment overlaps another shift.' })]);
      expect(assignments.createShift).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------
  // Auto-schedule (assignment-only builder, distinct from the AI builder)
  // ---------------------------------------------------------------------
  describe('previewAutoSchedule', () => {
    it('flags no_role_match when there is no staff to consider', async () => {
      const { controller, prisma } = makeController();
      prisma.scheduleShift.findMany.mockResolvedValue([
        { id: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'open', profileId: null },
      ]);
      prisma.profile.findMany.mockResolvedValue([]);

      const result = await controller.previewAutoSchedule(managerScope);

      expect(result.proposals[0]).toEqual(expect.objectContaining({ profileId: null, reason: 'no_role_match' }));
      expect(result.filled).toBe(0);
    });

    it('assigns an available, role-matching, non-overlapping candidate', async () => {
      const { controller, prisma } = makeController();
      prisma.scheduleShift.findMany.mockResolvedValue([
        { id: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'open', profileId: null },
      ]);
      prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1', fullName: 'Alex', jobTitle: 'Server', role: 'staff' }]);
      const result = await controller.previewAutoSchedule(managerScope);

      expect(result.proposals[0]).toEqual(expect.objectContaining({ profileId: 'staff-1', reason: 'assigned' }));
      expect(result.filled).toBe(1);
    });
  });

  describe('applyAutoSchedule', () => {
    it('delegates to applyOpenAssignments with a canAssign gate that defaults to available', async () => {
      const { controller, assignments } = makeController();
      assignments.applyOpenAssignments.mockResolvedValue({ assigned: 1, skipped: 0, assignedShifts: [] });

      await controller.applyAutoSchedule(managerScope, {
        assignments: [{ shiftId: 'shift-1', profileId: 'staff-1' }],
      });

      expect(assignments.applyOpenAssignments).toHaveBeenCalledWith(expect.objectContaining({
        venueId: 'venue-1',
        assignments: [{ shiftId: 'shift-1', profileId: 'staff-1' }],
      }));
      const { canAssign } = assignments.applyOpenAssignments.mock.calls[0][0];
      expect(canAssign({ shift: { dayIndex: 1, startMinutes: 600, endMinutes: 900 }, profileId: 'staff-1' })).toBe(true);
      expect(canAssign({ shift: { dayIndex: 2, startMinutes: 600, endMinutes: 900 }, profileId: 'staff-1' })).toBe(true);
    });

    it('emails each newly assigned staff member once', async () => {
      const { controller, prisma, assignments, email } = makeController();
      assignments.applyOpenAssignments.mockResolvedValue({
        assigned: 1,
        skipped: 0,
        assignedShifts: [{ profileId: 'staff-1', shiftId: 'shift-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' }],
      });
      prisma.profile.findMany.mockResolvedValue([{ id: 'staff-1', email: 'staff1@test.com' }]);

      const result = await controller.applyAutoSchedule(managerScope, { assignments: [{ shiftId: 'shift-1', profileId: 'staff-1' }] });

      expect(result).toEqual({ assigned: 1, skipped: 0 });
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'staff1@test.com' }));
    });
  });

  // ---------------------------------------------------------------------
  // 5. Representative read/CRUD coverage (not exhaustive)
  // ---------------------------------------------------------------------
  describe('blackouts', () => {
    it('rejects a malformed date', async () => {
      const { controller } = makeController();
      await expect(controller.addBlackout(managerScope, { startDate: '08/01/2026', reason: 'x' } as any)).rejects.toThrow(
        'Dates must be in YYYY-MM-DD format',
      );
    });

    it('rejects a calendar date that does not exist', async () => {
      const { controller } = makeController();
      await expect(
        controller.addBlackout(managerScope, { startDate: '2026-02-31', reason: 'x' } as any),
      ).rejects.toThrow('Dates must be in YYYY-MM-DD format');
    });

    it('rejects an end date before the start date', async () => {
      const { controller } = makeController();
      await expect(
        controller.addBlackout(managerScope, { startDate: '2026-08-05', endDate: '2026-08-01', reason: 'x' } as any),
      ).rejects.toThrow('End date must be on or after the start date');
    });

    it('throws NotFoundException when removing a blackout that does not exist', async () => {
      const { controller } = makeController();
      await expect(controller.removeBlackout(managerScope, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('removes an existing blackout scoped to the venue', async () => {
      const { controller, prisma } = makeController();
      prisma.blackoutDate.findFirst.mockResolvedValue({ id: 'b1' });

      const result = await controller.removeBlackout(managerScope, 'b1');

      expect(prisma.blackoutDate.findFirst).toHaveBeenCalledWith({ where: { id: 'b1', venueId: 'venue-1' } });
      expect(prisma.blackoutDate.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('schedule memory notes', () => {
    it('rejects an empty title', async () => {
      const { controller } = makeController();
      await expect(controller.addScheduleMemoryNote(managerScope, { title: '  ', detail: 'd' })).rejects.toThrow('Memory title is required');
    });

    it('rejects an empty detail', async () => {
      const { controller } = makeController();
      await expect(controller.addScheduleMemoryNote(managerScope, { title: 't', detail: '  ' })).rejects.toThrow('Memory detail is required');
    });

    it('clamps the list limit between 1 and 20', async () => {
      const { controller, prisma } = makeController();

      await controller.listScheduleMemory(managerScope, '999');

      expect(prisma.scheduleMemoryNote.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    });
  });

  describe('templates', () => {
    it('rejects saving a template with no shifts on the schedule', async () => {
      const { controller, prisma } = makeController();
      prisma.scheduleShift.findMany.mockResolvedValue([]);

      await expect(controller.saveScheduleTemplate(managerScope, { name: 'Weekday' })).rejects.toThrow(
        'Create at least one shift before saving a template.',
      );
    });

    it('rejects applying a template that does not exist', async () => {
      const { controller } = makeController();
      await expect(controller.applyScheduleTemplate(managerScope, 'missing', { replace: false })).rejects.toThrow(NotFoundException);
    });

    it('rejects applying a template that has no shifts', async () => {
      const { controller, prisma } = makeController();
      prisma.scheduleTemplate.findFirst.mockResolvedValue({ id: 'tmpl-1', shifts: [] });

      await expect(controller.applyScheduleTemplate(managerScope, 'tmpl-1', { replace: false })).rejects.toThrow(
        'This template has no shifts to apply.',
      );
    });

    it('parses stored slots and delegates to applyTemplate', async () => {
      const { controller, prisma, assignments } = makeController();
      prisma.scheduleTemplate.findFirst.mockResolvedValue({
        id: 'tmpl-1',
        shifts: [{ dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor' }],
      });
      assignments.applyTemplate.mockResolvedValue({ added: 1 });

      const result = await controller.applyScheduleTemplate(managerScope, 'tmpl-1', { replace: true, weekStart: '2026-08-02' });

      expect(assignments.applyTemplate).toHaveBeenCalledWith({
        venueId: 'venue-1',
        weekStart: '2026-08-02',
        replace: true,
        slots: [expect.objectContaining({ dayIndex: 1, jobTitle: 'Server' })],
      });
      expect(result).toEqual({ added: 1 });
    });

    it('throws NotFoundException when deleting a template that does not exist', async () => {
      const { controller } = makeController();
      await expect(controller.deleteScheduleTemplate(managerScope, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('copyDayShifts / clearWeek / restoreShifts', () => {
    it('delegates copyDayShifts scoped to the venue', async () => {
      const { controller, assignments } = makeController();
      assignments.copyDayShifts.mockResolvedValue({ added: 3 });

      const result = await controller.copyDayShifts(managerScope, { weekStart: '2026-08-02', fromDay: 1, toDays: [2, 3] });

      expect(assignments.copyDayShifts).toHaveBeenCalledWith({ venueId: 'venue-1', weekStart: '2026-08-02', fromDay: 1, toDays: [2, 3] });
      expect(result).toEqual({ added: 3 });
    });

    it('rejects copy-day values outside the weekly calendar', async () => {
      const { controller, assignments } = makeController();

      await expect(controller.copyDayShifts(managerScope, { fromDay: 7, toDays: [2] })).rejects.toThrow(
        'fromDay must be between 0 and 6.',
      );
      await expect(controller.copyDayShifts(managerScope, { fromDay: 1, toDays: [2, 99] })).rejects.toThrow(
        'toDays must contain days between 0 and 6.',
      );
      expect(assignments.copyDayShifts).not.toHaveBeenCalled();
    });

    it('deduplicates destination days before copying', async () => {
      const { controller, assignments } = makeController();
      assignments.copyDayShifts.mockResolvedValue({ added: 1 });

      await controller.copyDayShifts(managerScope, { weekStart: '2026-08-02', fromDay: 1, toDays: [2, 2] });

      expect(assignments.copyDayShifts).toHaveBeenCalledWith({ venueId: 'venue-1', weekStart: '2026-08-02', fromDay: 1, toDays: [2] });
    });

    it('delegates clearWeek scoped to the venue', async () => {
      const { controller, assignments } = makeController();
      assignments.clearWeek.mockResolvedValue({ removed: 5, shifts: [] });

      await controller.clearWeek(managerScope, { weekStart: '2026-08-02' });

      expect(assignments.clearWeek).toHaveBeenCalledWith({ venueId: 'venue-1', weekStart: '2026-08-02' });
    });

    it('rejects restoreShifts when any shift window is invalid, without calling the service', async () => {
      const { controller, assignments } = makeController();

      await expect(
        controller.restoreShifts(managerScope, {
          shifts: [{ dayIndex: 1, startMinutes: 900, endMinutes: 600, jobTitle: 'Server', station: 'Floor', status: 'scheduled' as any }],
        }),
      ).rejects.toThrow('End time must be after start time');
      expect(assignments.restoreShifts).not.toHaveBeenCalled();
    });

    it('delegates valid restoreShifts to the assignment service', async () => {
      const { controller, assignments } = makeController();
      assignments.restoreShifts.mockResolvedValue({ restored: 1 });

      const result = await controller.restoreShifts(managerScope, {
        shifts: [{ dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'scheduled' as any }],
      });

      expect(assignments.restoreShifts).toHaveBeenCalledWith(expect.objectContaining({ venueId: 'venue-1' }));
      expect(result).toEqual({ restored: 1 });
    });
  });

  describe('labor budget and labor forecast', () => {
    it('rejects a negative labor budget', async () => {
      const { controller, prisma } = makeController();

      await expect(controller.setLaborBudget(managerScope, { weeklyLaborBudgetHours: -1 })).rejects.toThrow(
        'Weekly labor budget cannot be negative.',
      );
      expect(prisma.venue.update).not.toHaveBeenCalled();
    });

    it('sets the labor budget to null when omitted', async () => {
      const { controller, prisma } = makeController();

      await controller.setLaborBudget(managerScope, {});

      expect(prisma.venue.update).toHaveBeenCalledWith({ where: { id: 'venue-1' }, data: { weeklyLaborBudgetHours: null } });
    });

    it('passes the venue labor budget through the forecast response', async () => {
      const { controller, prisma } = makeController();
      prisma.venue.findUnique.mockResolvedValue({ ...bigVenue, weeklyLaborBudgetHours: 320 });

      const result = await controller.getLaborForecast(managerScope);

      expect(result.laborBudgetHours).toBe(320);
    });
  });

  describe('read-only endpoints (representative coverage)', () => {
    it('getMySchedule splits shifts into mine/open/roster', async () => {
      const { controller, prisma } = makeController();
      prisma.scheduleShift.findMany.mockResolvedValue([
        { id: 's1', profileId: 'staff-1', dayIndex: 1, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'scheduled', notes: null, profile: { fullName: 'Staff One' } },
        { id: 's2', profileId: null, dayIndex: 2, startMinutes: 600, endMinutes: 900, jobTitle: 'Server', station: 'Floor', status: 'open', notes: null, profile: null },
      ]);

      const result = await controller.getMySchedule(staffScope);

      expect(result.mine).toHaveLength(1);
      expect(result.open).toHaveLength(1);
      expect(result.roster).toHaveLength(7);
    });
  });
});
