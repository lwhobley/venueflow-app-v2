import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnionComplianceService } from './union-compliance.service';
import { TempStaffingService } from './temp-staffing.service';

describe('Mass Temp Staffing & Union Compliance Services', () => {
  let unionService: UnionComplianceService;
  let staffingService: TempStaffingService;
  let prisma: any;
  let wsGateway: any;

  beforeEach(() => {
    prisma = {
      unionRuleConfig: {
        findFirst: vi.fn(),
      },
      workerProfile: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      shiftPunch: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      tempAgency: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };

    wsGateway = {
      broadcastBeoUpdate: vi.fn(),
    };

    unionService = new UnionComplianceService(prisma, wsGateway);
    staffingService = new TempStaffingService(prisma, unionService);
  });

  it('calculates 10-hour shift math cleanly: 8.0 hrs Regular + 2.0 hrs Overtime + 1.0 hr Meal Penalty Pay', async () => {
    prisma.workerProfile.findFirst.mockResolvedValue({
      id: 'w_101',
      firstName: 'TempWorker',
      lastName: '1',
      unionMemberId: 'LOCAL226-1001',
    });

    prisma.unionRuleConfig.findFirst.mockResolvedValue({
      id: 'rule_1',
      maxContinuousWorkHours: 5.0,
      mandatoryMealBreakMinutes: 30,
      mealBreakWindowHours: 5.0,
      overtimeThresholdHours: 8.0,
      dailyDoubleTimeThreshold: 12.0,
      premiumPayMultiplier: 1.5,
      mealPenaltyPayCents: 2500, // $25.00
    });

    const startTime = new Date('2026-08-12T08:00:00.000Z');
    const endTime = new Date('2026-08-12T18:00:00.000Z'); // 10 hours continuous work

    prisma.shiftPunch.findMany.mockResolvedValue([
      { id: 'p1', workerId: 'w_101', punchType: 'IN', timestamp: startTime },
      { id: 'p2', workerId: 'w_101', punchType: 'OUT', timestamp: endTime },
    ]);

    const summary = await unionService.calculateWorkerShiftSummary('w_101', 'facility-1');

    expect(summary.regularHours).toBe(8.0);
    expect(summary.overtimeHours).toBe(2.0);
    expect(summary.doubleTimeHours).toBe(0.0);
    expect(summary.mealPenaltyPayCents).toBe(2500); // $25.00 meal break penalty
    expect(summary.violations.length).toBe(1);
    expect(summary.violations[0].type).toBe('missed_meal_break');
  });

  it('handles bulk agency roster import of 200 workers with unique PINs and QR codes', async () => {
    prisma.tempAgency.findUnique.mockResolvedValue(null);
    prisma.tempAgency.create.mockResolvedValue({
      id: 'agency_1',
      name: 'Agency INSTAWORK-01',
      code: 'INSTAWORK-01',
    });

    prisma.workerProfile.create.mockImplementation(async ({ data }) => ({ id: `w_${data.pinCode}`, ...data }));

    const seedResult = await staffingService.seedTempAgencyAndWorkers('org-1', 'facility-1');

    expect(seedResult.importedCount).toBe(200);
    expect(prisma.workerProfile.create).toHaveBeenCalledTimes(200);
  });

  it('evaluates Staff Gate Check-In status: GREEN for assigned outlet, RED for expired certs', async () => {
    // Valid worker with assigned outlet -> GREEN
    const validWorker = {
      id: 'w_1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      firstName: 'Alex',
      lastName: 'Mercer',
      pinCode: '100001',
      qrCodeIdentifier: 'QR-STADIUM-facility-1-100001',
      certFoodSafety: true,
      certAlcohol: true,
      certAlcoholExpiry: new Date('2028-01-01'),
      active: true,
    };
    prisma.workerProfile.findFirst.mockResolvedValueOnce(validWorker).mockResolvedValueOnce(validWorker);

    prisma.shiftPunch.create.mockResolvedValue({ id: 'p_101' });
    prisma.shiftPunch.findFirst.mockResolvedValue(null);

    const greenResult = await staffingService.kioskCheckIn('facility-1', '100001', 'STAND-104');
    expect(greenResult.status).toBe('GREEN');
    expect(greenResult.worker.assignedOutlet).toBe('STAND-104');

    // Worker with expired alcohol cert -> RED
    prisma.workerProfile.findFirst.mockResolvedValueOnce({
      id: 'w_13',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      firstName: 'John',
      lastName: 'Doe',
      pinCode: '100013',
      qrCodeIdentifier: 'QR-STADIUM-facility-1-100013',
      certFoodSafety: true,
      certAlcohol: true,
      certAlcoholExpiry: new Date('2025-01-01'), // Expired!
      active: true,
    });

    const redResult = await staffingService.kioskCheckIn('facility-1', '100013');
    expect(redResult.status).toBe('RED');
    expect(redResult.message).toContain('CHECK-IN BLOCKED');
  });
});
