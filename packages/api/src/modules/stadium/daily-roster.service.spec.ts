import { describe, expect, it, vi } from 'vitest';
import { DailyRosterService } from './daily-roster.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';

describe('DailyRosterService (Unit)', () => {
  const facilityId = 'venue-stadium-1';
  const orgId = 'org-1';

  it('creates a new daily roster when user has department authority', async () => {
    const prismaMock = {
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'roster-1', ...data })),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    const result = await service.createRoster({
      organizationId: orgId,
      facilityId,
      actorUserId: 'u-catering-mgr',
      actorRole: 'manager',
      dto: {
        operationalDate: '2026-09-10',
        name: 'Instawork Catering Day 1',
        rosterType: 'temporary',
        staffingSource: 'Instawork',
        departmentId: 'dept-catering',
      },
    });

    expect(result.id).toBe('roster-1');
    expect(result.status).toBe('draft');
    expect(result.version).toBe(1);
    expect(prismaMock.dailyTemporaryRoster.create).toHaveBeenCalled();
  });

  it('rejects duplicate roster name for the same operational date', async () => {
    const prismaMock = {
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-roster' }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.createRoster({
        organizationId: orgId,
        facilityId,
        actorUserId: 'u-catering-mgr',
        actorRole: 'manager',
        dto: {
          operationalDate: '2026-09-10',
          name: 'Instawork Catering Day 1',
          staffingSource: 'Instawork',
          departmentId: 'dept-catering',
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('enforces immutability: rejects direct worker addition on approved or closed roster', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-approved',
          status: 'approved',
          departmentId: 'dept-catering',
        }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.addWorker({
        organizationId: orgId,
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-approved',
        dto: {
          workerName: 'Jane Doe',
          workerRole: 'Server',
        },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('enforces immutability: rejects direct worker update on closed roster', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-closed',
          status: 'closed',
          departmentId: 'dept-catering',
        }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.updateWorker({
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-closed',
        workerId: 'w-1',
        dto: { hoursWorked: 8.5 },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('redacts sensitive hourlyRateCents for non-billing roles', async () => {
    const mockRoster = {
      id: 'roster-1',
      name: 'Roster 1',
      operationalDate: '2026-09-10',
      workers: [
        { id: 'w-1', workerName: 'Alice', hourlyRateCents: 2500 },
        { id: 'w-2', workerName: 'Bob', hourlyRateCents: 3000 },
      ],
      history: [],
    };

    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockImplementation(() => ({
          ...mockRoster,
          workers: mockRoster.workers.map((w) => ({ ...w })),
        })),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    const nonBillingResult = await service.getRoster({
      facilityId,
      rosterId: 'roster-1',
      actorRole: 'manager', // operational manager cannot see payroll rates
    });

    expect(nonBillingResult.workers[0].hourlyRateCents).toBe(0);
    expect(nonBillingResult.workers[1].hourlyRateCents).toBe(0);

    const billingResult = await service.getRoster({
      facilityId,
      rosterId: 'roster-1',
      actorRole: 'admin', // admin can see payroll rates
    });
    expect(billingResult.workers[0].hourlyRateCents).toBe(2500);
  });

  it('permits post-approval adjustments via versioned correction workflow', async () => {
    const mockRoster = {
      id: 'roster-approved',
      status: 'approved',
      version: 1,
      departmentId: 'dept-catering',
      workers: [{ id: 'w-1', hoursWorked: 6.0 }],
    };

    const prismaMock = {
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue(mockRoster),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        const tx = {
          dailyTemporaryRosterHistory: {
            create: vi.fn().mockResolvedValue({ id: 'hist-1' }),
          },
          dailyTemporaryRosterWorker: {
            update: vi.fn().mockResolvedValue({ id: 'w-1', hoursWorked: 7.5 }),
          },
          dailyTemporaryRoster: {
            update: vi.fn().mockResolvedValue({ id: 'roster-approved', version: 2 }),
          },
        };
        return callback(tx);
      }),
    } as any;

    const service = new DailyRosterService(prismaMock);
    const adjusted = await service.adjustClosedRoster({
      organizationId: orgId,
      facilityId,
      actorUserId: 'u-mgr',
      actorRole: 'manager',
      rosterId: 'roster-approved',
      dto: {
        reason: 'Overtime missed in initial check-out punch',
        workerUpdates: [{ workerId: 'w-1', hoursWorked: 7.5 }],
      },
    });

    expect(adjusted.version).toBe(2);
  });
});
