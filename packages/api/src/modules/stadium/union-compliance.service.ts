import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SuiteHospitalityGateway } from './suite-hospitality.gateway';
import { PunchType, PunchVerification } from '@prisma/client';

export interface ShiftSummary {
  workerId: string;
  unionMemberId?: string;
  workerName: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  mealPenaltyPayCents: number;
  violations: Array<{ type: string; notes: string; penaltyCents: number }>;
}

@Injectable()
export class UnionComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wsGateway: SuiteHospitalityGateway,
  ) {}

  async getUnionRuleConfig(facilityId: string) {
    const config = await this.prisma.unionRuleConfig.findFirst({
      where: { facilityId, active: true },
      orderBy: { createdAt: 'desc' },
    });

    if (config) return config;

    // Fallback default config
    return {
      id: 'default_config',
      maxContinuousWorkHours: 5.0,
      mandatoryMealBreakMinutes: 30,
      mealBreakWindowHours: 5.0,
      overtimeThresholdHours: 8.0,
      dailyDoubleTimeThreshold: 12.0,
      premiumPayMultiplier: 1.5,
      mealPenaltyPayCents: 2500,
    };
  }

  async calculateWorkerShiftSummary(workerId: string, facilityId: string, requestedBusinessDate?: string): Promise<ShiftSummary> {
    const worker = await this.prisma.workerProfile.findFirst({
      where: { id: workerId, facilityId },
      include: { agency: true },
    });
    if (!worker) throw new NotFoundException('Worker profile not found.');

    if (requestedBusinessDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedBusinessDate)) {
      throw new BadRequestException('businessDate must use YYYY-MM-DD format.');
    }
    const businessDate = requestedBusinessDate ?? new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${businessDate}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const punches = await this.prisma.shiftPunch.findMany({
      where: { workerId, facilityId, timestamp: { gte: dayStart, lt: dayEnd } },
      orderBy: { timestamp: 'asc' },
    });

    const config = await this.getUnionRuleConfig(facilityId);

    let inTime: Date | null = null;
    let outTime: Date | null = null;
    let mealStart: Date | null = null;
    let mealEnd: Date | null = null;

    for (const p of punches) {
      if (p.punchType === 'IN' && !inTime) inTime = new Date(p.timestamp);
      if (p.punchType === 'OUT') outTime = new Date(p.timestamp);
      if (p.punchType === 'MEAL_START') mealStart = new Date(p.timestamp);
      if (p.punchType === 'MEAL_END') mealEnd = new Date(p.timestamp);
    }

    if (!inTime) {
      return {
        workerId,
        unionMemberId: worker.unionMemberId ?? undefined,
        workerName: `${worker.firstName} ${worker.lastName}`,
        regularHours: 0,
        overtimeHours: 0,
        doubleTimeHours: 0,
        mealPenaltyPayCents: 0,
        violations: [],
      };
    }

    const end = outTime ?? new Date();
    const grossMinutes = (end.getTime() - inTime.getTime()) / (1000 * 60);

    let mealDurationMinutes = 0;
    if (mealStart && mealEnd) {
      mealDurationMinutes = (mealEnd.getTime() - mealStart.getTime()) / (1000 * 60);
    }

    const netWorkHours = Math.max(0, (grossMinutes - mealDurationMinutes) / 60.0);

    // Calculate hours split: Regular (<=8h), OT (8-12h), DT (>12h)
    let regularHours = 0;
    let overtimeHours = 0;
    let doubleTimeHours = 0;

    if (netWorkHours <= config.overtimeThresholdHours) {
      regularHours = netWorkHours;
    } else if (netWorkHours <= config.dailyDoubleTimeThreshold) {
      regularHours = config.overtimeThresholdHours;
      overtimeHours = netWorkHours - config.overtimeThresholdHours;
    } else {
      regularHours = config.overtimeThresholdHours;
      overtimeHours = config.dailyDoubleTimeThreshold - config.overtimeThresholdHours;
      doubleTimeHours = netWorkHours - config.dailyDoubleTimeThreshold;
    }

    // Evaluate Union Meal Break Compliance
    const violations: Array<{ type: string; notes: string; penaltyCents: number }> = [];
    let mealPenaltyPayCents = 0;

    const hoursWorkedBeforeMeal = mealStart
      ? (mealStart.getTime() - inTime.getTime()) / (1000 * 60 * 60)
      : (end.getTime() - inTime.getTime()) / (1000 * 60 * 60);

    if (hoursWorkedBeforeMeal > config.mealBreakWindowHours && (!mealDurationMinutes || mealDurationMinutes < config.mandatoryMealBreakMinutes)) {
      mealPenaltyPayCents = config.mealPenaltyPayCents;
      violations.push({
        type: 'missed_meal_break',
        notes: `Worked ${hoursWorkedBeforeMeal.toFixed(1)} consecutive hours without mandatory 30-minute meal break by Hour ${config.mealBreakWindowHours}`,
        penaltyCents: config.mealPenaltyPayCents,
      });
    }

    return {
      workerId,
      unionMemberId: worker.unionMemberId ?? undefined,
      workerName: `${worker.firstName} ${worker.lastName}`,
      regularHours: Number(regularHours.toFixed(2)),
      overtimeHours: Number(overtimeHours.toFixed(2)),
      doubleTimeHours: Number(doubleTimeHours.toFixed(2)),
      mealPenaltyPayCents,
      violations,
    };
  }

  async listFacilityShiftSummaries(facilityId: string, businessDate?: string): Promise<ShiftSummary[]> {
    const workers = await this.prisma.workerProfile.findMany({
      where: { facilityId, active: true },
      select: { id: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    });
    return Promise.all(workers.map((worker) => this.calculateWorkerShiftSummary(worker.id, facilityId, businessDate)));
  }

  async recordPunch(
    organizationId: string,
    facilityId: string,
    workerId: string,
    punchType: PunchType,
    verifiedVia: PunchVerification,
    zoneId?: string,
    outletId?: string,
    overrideReason?: string,
  ) {
    const worker = await this.prisma.workerProfile.findFirst({
      where: { id: workerId, organizationId, facilityId, active: true },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Active worker profile not found in this facility.');
    if (verifiedVia === 'supervisor_override' && !overrideReason?.trim()) {
      throw new BadRequestException('Supervisor overrides require a reason.');
    }
    const previous = await this.prisma.shiftPunch.findFirst({
      where: { workerId, facilityId },
      orderBy: { timestamp: 'desc' },
      select: { punchType: true },
    });
    const allowed: Record<PunchType | 'NONE', PunchType[]> = {
      NONE: ['IN'], IN: ['MEAL_START', 'OUT'], MEAL_START: ['MEAL_END'], MEAL_END: ['OUT'], OUT: ['IN'],
    };
    if (!allowed[previous?.punchType ?? 'NONE'].includes(punchType)) {
      throw new BadRequestException(`Invalid punch transition from ${previous?.punchType ?? 'no punch'} to ${punchType}.`);
    }
    const punch = await this.prisma.shiftPunch.create({
      data: {
        organizationId,
        facilityId,
        workerId,
        punchType,
        verifiedVia,
        zoneId: zoneId ?? null,
        outletId: outletId ?? null,
        overrideReason: overrideReason ?? null,
      },
    });

    // Check if worker is approaching 5h meal threshold and broadcast 15-min warning
    if (punchType === 'IN') {
      const config = await this.getUnionRuleConfig(facilityId);
      const warningMinutes = config.mealBreakWindowHours * 60 - 15; // 4h45m
      this.wsGateway.broadcastBeoUpdate(facilityId, zoneId ?? 'global', {
        type: 'union_break_warning',
        workerId,
        warningMinutes,
        message: `Union worker approaching 5-hour mandatory meal break limit. Schedule break within 15 minutes.`,
      });
    }

    return punch;
  }
}
