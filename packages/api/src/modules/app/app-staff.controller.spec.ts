import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppStaffController } from './app-staff.controller';

vi.mock('../../common/rate-limit', () => ({
  assertWithinSharedRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { assertWithinSharedRateLimit } from '../../common/rate-limit';

function makeController() {
  const prisma: any = {
    profile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(5),
      update: vi.fn(),
      create: vi.fn(),
    },
    staffOnboardingTask: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    team: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'team-1' }),
      update: vi.fn(),
    },
    user: {
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: 'user-x' }),
    },
    passwordCredential: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  };
  // The controller passes the same client through as `tx`; reuse the mock so
  // assertions can target the same jest.fn() regardless of which one is used.
  prisma.$transaction = vi.fn(async (cb: any) => cb(prisma));

  const email = { send: vi.fn().mockResolvedValue(undefined) };
  const profiles = {
    requireManagerProfile: vi.fn(),
  };
  const staffImportParser = { parse: vi.fn() };

  const auth = {
    hashPassword: vi.fn().mockResolvedValue({ salt: 'salt', hash: 'hash' }),
  };
  const controller = new AppStaffController(prisma, email as any, profiles as any, staffImportParser as any, auth as any);
  return { controller, prisma, email, profiles, staffImportParser, auth };
}

const managerViewer = { id: 'manager-1', role: 'manager', allAccess: false, venueId: 'venue-1', fullName: 'Manager Mike', venue: { name: 'Test Venue' } };
const ownerViewer = { id: 'owner-1', role: 'owner', allAccess: false, venueId: 'venue-1', fullName: 'Owner Olivia', venue: { name: 'Test Venue' } };
const user = { sub: 'user-1' } as any;

function profileRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'staff-2',
    email: 'staff@example.com',
    fullName: 'Staff Person',
    role: 'staff',
    jobTitle: 'Server',
    venueId: 'venue-1',
    allAccess: false,
    trialEndsAt: null,
    userId: 'staff-user-2',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppStaffController', () => {
  describe('authorization', () => {
    it('rejects listVenueStaff when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.listVenueStaff(user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects listOnboardingTasks when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.listOnboardingTasks(user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects listAuditLog when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.listAuditLog(user)).rejects.toThrow(ForbiddenException);
    });

    it('rejects upsertVenueStaff when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.upsertVenueStaff(user, { venueId: 'venue-1' } as any)).rejects.toThrow(ForbiddenException);
    });

    it('rejects deactivateVenueStaff when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.deactivateVenueStaff(user, 'staff-2')).rejects.toThrow(ForbiddenException);
    });

    it('rejects parseStaffImport when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.parseStaffImport(user, { text: 'x' })).rejects.toThrow(ForbiddenException);
    });

    it('rejects commitStaffImport when the caller is not a manager', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockRejectedValue(new ForbiddenException('Not authorized'));
      await expect(controller.commitStaffImport(user, { venueId: 'venue-1', items: [] })).rejects.toThrow(ForbiddenException);
    });

    it('allows a manager through listVenueStaff', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      await expect(controller.listVenueStaff(user)).resolves.toEqual([]);
    });
  });

  describe('listVenueStaff', () => {
    it('scopes the roster query to the manager venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findMany.mockResolvedValue([profileRow()]);

      const result = await controller.listVenueStaff(user);

      expect(prisma.profile.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1', OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
        orderBy: { fullName: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ email: 'staff@example.com' });
    });
  });

  describe('listOnboardingTasks', () => {
    it('seeds default tasks only for profiles missing them, then returns grouped results', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findMany.mockResolvedValue([
        { id: 'staff-1', fullName: 'Has Tasks', email: 'a@x.com', role: 'staff', jobTitle: 'Server' },
        { id: 'staff-2', fullName: 'No Tasks', email: 'b@x.com', role: 'staff', jobTitle: 'Server' },
      ]);
      prisma.staffOnboardingTask.findMany.mockImplementation((args: any) => {
        if (args.distinct) {
          return Promise.resolve([{ profileId: 'staff-1' }]);
        }
        return Promise.resolve([
          {
            id: 'task-1', profileId: 'staff-1', title: 'Confirm profile details', details: 'd', category: 'profile',
            dueDate: null, status: 'done', completedBy: 'manager-1', completedAt: new Date('2026-07-01T00:00:00Z'),
            createdAt: new Date('2026-06-01T00:00:00Z'), updatedAt: new Date('2026-06-01T00:00:00Z'),
          },
        ]);
      });

      const result = await controller.listOnboardingTasks(user);

      expect(prisma.staffOnboardingTask.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ profileId: 'staff-2' })]),
      }));
      expect(prisma.staffOnboardingTask.createMany.mock.calls[0][0].data.some((t: any) => t.profileId === 'staff-1')).toBe(false);
      expect(result.staff).toHaveLength(2);
      const withTask = result.staff.find((s: any) => s._id === 'staff-1');
      expect(withTask!.completedCount).toBe(1);
      expect(withTask!.totalCount).toBe(1);
    });

    it('scopes the profile lookup to a single profileId when provided', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);

      await controller.listOnboardingTasks(user, 'staff-1');

      expect(prisma.profile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { venueId: 'venue-1', id: 'staff-1', OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
        take: 1,
      }));
    });
  });

  describe('updateOnboardingTask', () => {
    it('404s when the task does not belong to the venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.staffOnboardingTask.findFirst = vi.fn().mockResolvedValue(null);

      await expect(controller.updateOnboardingTask(user, 'task-1', { status: 'done' })).rejects.toThrow(NotFoundException);
    });

    it('stamps completedBy/completedAt only when marking done', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      const task = { id: 'task-1', venueId: 'venue-1', profileId: 'staff-2', title: 'Review handbook and policies', status: 'open' };
      prisma.staffOnboardingTask.findFirst = vi.fn().mockResolvedValue(task);
      prisma.profile.findFirst.mockResolvedValue(profileRow());
      prisma.staffOnboardingTask.update.mockResolvedValue({
        id: 'task-1', profileId: 'staff-2', title: task.title, details: null, category: 'training',
        dueDate: null, status: 'done', completedBy: 'manager-1', completedAt: new Date('2026-07-16T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'), updatedAt: new Date('2026-07-16T00:00:00Z'),
      });

      const result = await controller.updateOnboardingTask(user, 'task-1', { status: 'done' });

      expect(prisma.staffOnboardingTask.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'done', completedBy: 'manager-1', completedAt: expect.any(Date) }),
      }));
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(result.status).toBe('done');
    });

    it('clears completedBy/completedAt when reopening a task', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      const task = { id: 'task-1', venueId: 'venue-1', profileId: 'staff-2', title: 'Review handbook and policies', status: 'done' };
      prisma.staffOnboardingTask.findFirst = vi.fn().mockResolvedValue(task);
      prisma.profile.findFirst.mockResolvedValue(profileRow());
      prisma.staffOnboardingTask.update.mockResolvedValue({
        id: 'task-1', profileId: 'staff-2', title: task.title, details: null, category: 'training',
        dueDate: null, status: 'open', completedBy: null, completedAt: null,
        createdAt: new Date('2026-07-01T00:00:00Z'), updatedAt: new Date('2026-07-16T00:00:00Z'),
      });

      await controller.updateOnboardingTask(user, 'task-1', { status: 'open' });

      expect(prisma.staffOnboardingTask.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'open', completedBy: null, completedAt: null }),
      }));
    });
  });

  describe('listAuditLog', () => {
    it('scopes to the manager venue and maps entries', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.auditLog.findMany.mockResolvedValue([
        { id: 'log-1', actorName: 'Manager Mike', actorRole: 'manager', targetName: 'Staff Person', targetRole: 'staff', entityType: 'profile', action: 'staff_created', summary: 'x', createdAt: new Date('2026-07-01T00:00:00Z') },
      ]);

      const result = await controller.listAuditLog(user);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { venueId: 'venue-1' }, take: 100 }));
      expect(result.entries[0]).toMatchObject({ _id: 'log-1', action: 'staff_created' });
    });
  });

  describe('upsertVenueStaff (tenant isolation and role security)', () => {
    it('rejects when body.venueId does not match the caller venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'other-venue', email: 'x@example.com', fullName: 'X', role: 'staff', jobTitle: 'Server',
      } as any)).rejects.toThrow(ForbiddenException);
      expect(prisma.profile.findFirst).not.toHaveBeenCalled();
    });

    it('blocks a manager from assigning the manager role to a new hire', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'x@example.com', fullName: 'X', role: 'manager', jobTitle: 'Manager',
      } as any)).rejects.toThrow('Managers cannot assign admin, owner, or manager roles');
      expect(prisma.profile.findFirst).toHaveBeenCalledTimes(1);
    });

    it('blocks a manager from assigning admin/owner roles', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'x@example.com', fullName: 'X', role: 'admin', jobTitle: 'Admin',
      } as any)).rejects.toThrow(ForbiddenException);
    });

    it('allows an owner to assign the manager role and create a profile, sending an invite email', async () => {
      const { controller, prisma, profiles, email } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(null);
      prisma.profile.create.mockResolvedValue(profileRow({ id: 'new-1', email: 'new@example.com', fullName: 'New Hire', role: 'manager', jobTitle: 'Manager', userId: null }));

      const result = await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'new@example.com', fullName: 'New Hire', role: 'manager', jobTitle: 'Manager',
      } as any);

      expect(prisma.profile.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ email: 'new@example.com', role: 'manager', venueId: 'venue-1' }),
      }));
      expect(prisma.staffOnboardingTask.createMany).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'staff_created' }),
      }));
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'new@example.com',
        subject: expect.stringContaining('Invitation'),
      }));
      expect(result.email).toBe('new@example.com');
    });

    it('lets an administrator assign a sign-in PIN to a non-admin new hire (everyone signs in with email + PIN)', async () => {
      const { controller, prisma, profiles, auth } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(null);
      prisma.profile.create.mockResolvedValue(profileRow({ id: 'new-1', email: 'new@example.com', role: 'staff', userId: null }));
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'new-1', email: 'new@example.com', role: 'staff', userId: 'user-x' }));

      const result = await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'new@example.com', fullName: 'New Hire', role: 'staff', jobTitle: 'Server', onboardingPin: '123456',
      } as any);

      expect(auth.hashPassword).toHaveBeenCalledWith('123456');
      expect(prisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'new@example.com' } }));
      expect(prisma.passwordCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'user-x' },
      }));
      expect(prisma.profile.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'new-1' },
        data: { userId: 'user-x' },
      }));
      expect(result.email).toBe('new@example.com');
    });

    it('blocks a manager (non-administrator) from assigning a PIN at all', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'x@example.com', fullName: 'X', role: 'staff', jobTitle: 'Server', onboardingPin: '123456',
      } as any)).rejects.toThrow('Only venue administrators can assign access PINs.');
    });

    it('lower-cases the email on create', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(null);
      prisma.profile.create.mockResolvedValue(profileRow({ email: 'mixedcase@example.com' }));

      await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'MixedCase@Example.com', fullName: 'X', role: 'staff', jobTitle: 'Server',
      } as any);

      expect(prisma.profile.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ email: 'mixedcase@example.com' }),
      }));
    });

    it('rejects a manager editing another manager (equal-rank, non-owner-admin)', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'other-manager', role: 'manager' }));

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'other-manager', email: 'other@example.com', fullName: 'Other Manager', role: 'staff', jobTitle: 'Server',
      } as any)).rejects.toThrow('You cannot modify this staff member');
    });

    it('blocks demoting the last owner/admin in the venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'owner-1', role: 'owner' }));
      prisma.profile.count.mockResolvedValue(1);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'owner-1', email: 'owner@example.com', fullName: 'Owner Olivia', role: 'staff', jobTitle: 'Owner',
      } as any)).rejects.toThrow('You cannot remove the last owner or admin from the venue');
    });

    it('allows demoting an owner when another owner/admin remains', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'owner-2', role: 'owner', userId: 'owner-2-user' }));
      prisma.profile.count.mockResolvedValue(2);
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'owner-2', role: 'staff' }));

      await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'owner-2', email: 'owner2@example.com', fullName: 'Owner Two', role: 'staff', jobTitle: 'Server',
      } as any);

      expect(prisma.profile.update).toHaveBeenCalled();
    });

    it('preserves multi-venue sessions when a live role changes', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'staff-2', role: 'staff', userId: 'staff-2-user' }));
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'staff-2', role: 'manager' }));

      await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'staff-2', email: 'staff@example.com', fullName: 'Staff Person', role: 'manager', jobTitle: 'Manager',
      } as any);

      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    });

    it('does not invalidate sessions when the role is unchanged', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'staff-2', role: 'staff', userId: 'staff-2-user' }));
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'staff-2', role: 'staff', phone: '555-1000' }));

      await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'staff-2', email: 'staff@example.com', fullName: 'Staff Person', role: 'staff', jobTitle: 'Server', phone: '555-1000',
      } as any);

      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    });

    it('sends a "profile updated" email (not an invite) when editing an existing staff member', async () => {
      const { controller, prisma, profiles, email } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'staff-2', role: 'staff', userId: 'staff-2-user' }));
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'staff-2', role: 'staff' }));

      await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'staff-2', email: 'staff@example.com', fullName: 'Staff Person', role: 'staff', jobTitle: 'Server',
      } as any);

      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
        subject: expect.stringContaining('Profile Has Been Updated'),
      }));
    });

    it('rejects an invalid dateOfBirth format', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(null);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', email: 'x@example.com', fullName: 'X', role: 'staff', jobTitle: 'Server', dateOfBirth: 'not-a-date',
      } as any)).rejects.toThrow(BadRequestException);
    });

    it('404s when staffId does not resolve within the venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(null);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: 'missing', email: 'x@example.com', fullName: 'X', role: 'staff', jobTitle: 'Server',
      } as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('parseStaffImport', () => {
    it('applies a shared, venue-scoped AI rate limit before parsing', async () => {
      const { controller, profiles, staffImportParser } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      staffImportParser.parse.mockResolvedValue({ items: [] });

      await controller.parseStaffImport(user, { text: 'raw csv' });

      expect(assertWithinSharedRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        'ai-parse:staff-import:venue-1',
        20,
        10 * 60 * 1000,
        expect.any(String),
      );
      expect(staffImportParser.parse).toHaveBeenCalledWith('raw csv');
    });

    it('propagates rate-limit rejection', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      vi.mocked(assertWithinSharedRateLimit).mockRejectedValueOnce(new Error('Too many attempts'));

      await expect(controller.parseStaffImport(user, { text: 'x' })).rejects.toThrow('Too many attempts');
    });
  });

  describe('commitStaffImport', () => {
    it('rejects when body.venueId does not match the caller venue', async () => {
      const { controller, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);

      await expect(controller.commitStaffImport(user, {
        venueId: 'other-venue', items: [],
      } as any)).rejects.toThrow(ForbiddenException);
    });

    it('creates new rows, updates existing rows, and collects per-row failures without aborting the batch', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst
        .mockResolvedValueOnce(null) // existingBefore check for create@x.com
        .mockResolvedValueOnce(null) // staffId lookup path not used (email path)
        .mockResolvedValueOnce({ id: 'existing-1' }) // existingBefore check for update@x.com
        .mockResolvedValueOnce({ id: 'existing-1', role: 'staff', venueId: 'venue-1' }) // update lookup inside upsertOneStaffMember
        .mockResolvedValueOnce(null); // existingBefore check for bad@x.com
      prisma.profile.create.mockResolvedValueOnce(profileRow({ email: 'create@x.com' }));
      prisma.profile.update.mockResolvedValueOnce(profileRow({ id: 'existing-1', email: 'update@x.com' }));
      // Force the third row to fail deterministically.
      prisma.profile.create.mockImplementationOnce(() => {
        throw new Error('should not be reached for row 3');
      });

      const result = await controller.commitStaffImport(user, {
        venueId: 'venue-1',
        items: [
          { email: 'create@x.com', fullName: 'Create Me', role: 'staff', jobTitle: 'Server' },
          { email: 'update@x.com', fullName: 'Update Me', role: 'staff', jobTitle: 'Server' },
          { email: 'admin-attempt@x.com', fullName: 'Nope', role: 'manager' as any, jobTitle: 'Manager' },
        ],
      });

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].email).toBe('admin-attempt@x.com');
    });

    it('scopes the existing-row lookup to the target venue and lower-cased email', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.create.mockResolvedValue(profileRow());

      await controller.commitStaffImport(user, {
        venueId: 'venue-1',
        items: [{ email: 'Row@Example.com', fullName: 'Row', role: 'staff', jobTitle: 'Server' }],
      });

      expect(prisma.profile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { venueId: 'venue-1', email: 'row@example.com' },
      }));
    });
  });

  describe('deactivateVenueStaff', () => {
    it('404s when the staff member is not in the venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findFirst.mockResolvedValue(null);

      await expect(controller.deactivateVenueStaff(user, 'ghost')).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup to the manager venue', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'staff-2' }));
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'staff-2', venueId: null }));

      await controller.deactivateVenueStaff(user, 'staff-2');

      expect(prisma.profile.findFirst).toHaveBeenCalledWith({ where: { id: 'staff-2', venueId: 'venue-1' } });
    });

    it('blocks removing the last owner/admin', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(ownerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'owner-1', role: 'owner' }));
      prisma.profile.count.mockResolvedValue(1);

      await expect(controller.deactivateVenueStaff(user, 'owner-1')).rejects.toThrow('You cannot remove the last owner or admin from the venue');
    });

    it('blocks a manager from removing another manager (equal rank)', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'other-manager', role: 'manager' }));

      await expect(controller.deactivateVenueStaff(user, 'other-manager')).rejects.toThrow('You cannot modify this staff member');
    });

    it('revokes membership and invalidates sessions when no active venue remains', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'staff-2', userId: 'staff-2-user' }));
      prisma.profile.count.mockResolvedValue(0);
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'staff-2', membershipStatus: 'revoked' }));

      await controller.deactivateVenueStaff(user, 'staff-2');

      expect(prisma.profile.update).toHaveBeenCalledWith({ where: { id: 'staff-2' }, data: { membershipStatus: 'revoked' } });
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'staff-2-user' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'staff_deactivated' }),
      }));
    });

    it('preserves sessions when the user still has another active venue membership', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      prisma.profile.findFirst.mockResolvedValue(profileRow({ id: 'staff-2', userId: 'staff-2-user' }));
      prisma.profile.count.mockResolvedValue(1);
      prisma.profile.update.mockResolvedValue(profileRow({ id: 'staff-2', membershipStatus: 'revoked' }));

      await controller.deactivateVenueStaff(user, 'staff-2');

      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('self-edit with an unchanged elevated role', () => {
    it('allows a manager to edit their own profile without re-triggering the role-assignment guard', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      const self = profileRow({ id: managerViewer.id, role: 'manager', userId: 'manager-1-user' });
      prisma.profile.findFirst.mockResolvedValue(self);
      prisma.profile.update.mockResolvedValue({ ...self, phone: '555-2000' });

      // The manager resubmits their own unchanged role ('manager') while
      // editing an unrelated field. This must not be treated as granting an
      // elevated role, and assertCanManageLegacyStaffTarget's self-edit
      // exception (target.id === viewer.id) allows the rest through.
      const result = await controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: managerViewer.id, email: 'manager@example.com', fullName: 'Manager Mike', role: 'manager', jobTitle: 'Manager', phone: '555-2000',
      } as any);

      expect(prisma.profile.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: managerViewer.id },
        data: expect.objectContaining({ phone: '555-2000', role: 'manager' }),
      }));
      // Role didn't change, so no session invalidation.
      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
      expect(result.phone).toBe('555-2000');
    });

    it('still blocks a manager from self-promoting to owner', async () => {
      const { controller, prisma, profiles } = makeController();
      profiles.requireManagerProfile.mockResolvedValue(managerViewer);
      const self = profileRow({ id: managerViewer.id, role: 'manager', userId: 'manager-1-user' });
      prisma.profile.findFirst.mockResolvedValue(self);

      await expect(controller.upsertVenueStaff(user, {
        venueId: 'venue-1', staffId: managerViewer.id, email: 'manager@example.com', fullName: 'Manager Mike', role: 'owner', jobTitle: 'Manager',
      } as any)).rejects.toThrow('Managers cannot assign admin, owner, or manager roles');
      expect(prisma.profile.update).not.toHaveBeenCalled();
    });
  });
});
