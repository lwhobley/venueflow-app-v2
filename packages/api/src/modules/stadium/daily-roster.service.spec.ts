import { describe, expect, it, vi } from 'vitest';
import { DailyRosterService } from './daily-roster.service';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

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

  // F-03: Direct-by-ID getRoster authorization check
  it('F-03: rejects getRoster for user outside the target department', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          departmentId: 'dept-suites',
          workers: [],
          history: [],
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue(null), // User is not member of dept-suites
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.getRoster({
        facilityId,
        actorUserId: 'u-culinary-only',
        rosterId: 'roster-1',
        actorRole: 'staff',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // F-03: Direct-by-ID exportRosterCsv authorization check
  it('F-03: rejects exportRosterCsv for user outside the target department', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          departmentId: 'dept-suites',
          department: { name: 'Suites' },
          workers: [],
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.exportRosterCsv({
        facilityId,
        actorUserId: 'u-culinary-only',
        rosterId: 'roster-1',
        actorRole: 'staff',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // F-04: submitRoster requires department membership
  it('F-04: rejects submitRoster if actor is not member of the department', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          status: 'draft',
          departmentId: 'dept-catering',
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.submitRoster({
        facilityId,
        actorUserId: 'u-outsider',
        actorRole: 'staff',
        rosterId: 'roster-1',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // F-05: State machine guards on approve and close
  it('F-05: rejects approveRoster if roster is not in submitted state', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          status: 'draft', // cannot approve draft directly
          departmentId: 'dept-catering',
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.approveRoster({
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('F-05: rejects closeRoster if roster is not in approved state', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          status: 'submitted', // must be approved before closing
          departmentId: 'dept-catering',
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.closeRoster({
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // F-06: Worker IDOR check in updateWorker and adjustClosedRoster
  it('F-06: rejects updateWorker when worker does not belong to authorized roster', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          status: 'draft',
          departmentId: 'dept-catering',
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      dailyTemporaryRosterWorker: {
        findFirst: vi.fn().mockResolvedValue(null), // Worker not found on roster-1
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.updateWorker({
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-1',
        workerId: 'worker-from-other-roster',
        dto: { hoursWorked: 8.0 },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('F-06: rejects adjustClosedRoster when worker in updates belongs to another roster', async () => {
    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'roster-1',
          status: 'closed',
          version: 1,
          departmentId: 'dept-catering',
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
      dailyTemporaryRosterWorker: {
        findFirst: vi.fn().mockResolvedValue(null), // worker not on this roster
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.adjustClosedRoster({
        organizationId: orgId,
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-1',
        dto: {
          reason: 'Correcting hours',
          workerUpdates: [{ workerId: 'worker-from-other-roster', hoursWorked: 7.0 }],
        },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // F-08: CAS concurrency on adjustClosedRoster
  it('F-08: throws ConflictException if concurrent edit modifies roster version', async () => {
    const mockRoster = {
      id: 'roster-1',
      status: 'approved',
      version: 1,
      departmentId: 'dept-catering',
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
          dailyTemporaryRoster: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }), // CAS conflict: version changed!
          },
        };
        return callback(tx);
      }),
    } as any;

    const service = new DailyRosterService(prismaMock);
    await expect(
      service.adjustClosedRoster({
        organizationId: orgId,
        facilityId,
        actorUserId: 'u-mgr',
        actorRole: 'manager',
        rosterId: 'roster-1',
        dto: {
          reason: 'Concurrent adjustment attempt',
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  // F-10: CSV formula injection neutralization
  it('F-10: neutralizes formula injection characters (=, +, -, @) in CSV export', async () => {
    const mockRoster = {
      id: 'roster-malicious',
      name: '=cmd|\'/c calc\'!A1',
      operationalDate: '2026-09-10',
      status: 'approved',
      staffingSource: '+123456',
      department: { name: '-DeptFormula' },
      workers: [
        {
          id: 'w-1',
          workerName: '=HYPERLINK("http://evil.com")',
          workerRole: '@admin',
          hoursWorked: 5,
          breakMinutes: 30,
          attendanceStatus: 'checked_in',
          hourlyRateCents: 2500,
          notes: '+malicious note',
        },
      ],
    };

    const prismaMock = {
      dailyTemporaryRoster: {
        findFirst: vi.fn().mockResolvedValue(mockRoster),
      },
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    const csv = await service.exportRosterCsv({
      facilityId,
      actorUserId: 'u-mgr',
      rosterId: 'roster-malicious',
      actorRole: 'admin',
    });

    // Verify leading single quote is prepended to neutralize execution
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+123456");
    expect(csv).toContain("'-DeptFormula");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@admin");
    expect(csv).toContain("'+malicious note");
  });

  it('redacts sensitive hourlyRateCents for non-billing roles', async () => {
    const mockRoster = {
      id: 'roster-1',
      name: 'Roster 1',
      operationalDate: '2026-09-10',
      departmentId: 'dept-catering',
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
      departmentMembership: {
        findFirst: vi.fn().mockResolvedValue({ id: 'mem-1' }),
      },
    } as any;

    const service = new DailyRosterService(prismaMock);
    const nonBillingResult = await service.getRoster({
      facilityId,
      actorUserId: 'u-mgr',
      rosterId: 'roster-1',
      actorRole: 'manager', // operational manager cannot see payroll rates
    });

    expect(nonBillingResult.workers[0].hourlyRateCents).toBe(0);
    expect(nonBillingResult.workers[1].hourlyRateCents).toBe(0);

    const billingResult = await service.getRoster({
      facilityId,
      actorUserId: 'u-admin',
      rosterId: 'roster-1',
      actorRole: 'admin', // admin can see payroll rates
    });
    expect(billingResult.workers[0].hourlyRateCents).toBe(2500);
  });

  it('permits post-approval adjustments via versioned correction workflow with CAS', async () => {
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
      dailyTemporaryRosterWorker: {
        findFirst: vi.fn().mockResolvedValue({ id: 'w-1', rosterId: 'roster-approved' }),
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
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'roster-approved', version: 2 }),
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
