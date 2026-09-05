import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PunchType, PunchVerification } from '@prisma/client';
import { zonedDateBounds, zonedIsoDate } from '../../common/venue-time';
import { applyTenantSessionSettings } from '../../prisma/tenant-transaction';

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
  constructor(private readonly prisma: PrismaService) {}

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

  private async facilityTimeZone(facilityId: string): Promise<string | null> {
    const facility = await this.prisma.facility.findFirst({
      where: { id: facilityId },
      select: { timezone: true },
    });
    return facility?.timezone ?? null;
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
    const timeZone = await this.facilityTimeZone(facilityId);
    const businessDate = requestedBusinessDate ?? zonedIsoDate(timeZone, Date.now());
    const bounds = zonedDateBounds(timeZone, businessDate);
    const dayStart = new Date(bounds.start);
    const dayEnd = new Date(bounds.end);
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
    idempotencyKey?: string,
  ) {
    if (verifiedVia === 'supervisor_override' && !overrideReason?.trim()) {
      throw new BadRequestException('Supervisor overrides require a reason.');
    }
    return this.prisma.$transaction(async (tx) => {
      // Bind app.* GUCs for a future FORCE RLS runtime role. SET LOCAL cannot
      // leak across the connection pool because it is transaction-scoped.
      await applyTenantSessionSettings(tx, {
        organizationId,
        facilityId,
        venueId: facilityId,
      });
      // Serialize every worker's punch stream. A repeated QR/PIN scan either
      // returns its original punch or is rejected as an invalid next state.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift-punch-${facilityId}-${workerId}`}))`;
      if (idempotencyKey) {
        const existing = await tx.shiftPunch.findFirst({ where: { facilityId, workerId, idempotencyKey } });
        if (existing) return existing;
      }
      const worker = await tx.workerProfile.findFirst({
        where: { id: workerId, organizationId, facilityId, active: true },
        select: { id: true },
      });
      if (!worker) throw new NotFoundException('Active worker profile not found in this facility.');
      const previous = await tx.shiftPunch.findFirst({
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

      let resolvedZoneId = zoneId;
      if (outletId) {
        const outlet = await tx.outlet.findFirst({
          where: { id: outletId, facilityId },
          select: { id: true, zoneId: true },
        });
        if (!outlet) {
          throw new BadRequestException('Specified outlet does not belong to this facility.');
        }
        if (zoneId && outlet.zoneId && outlet.zoneId !== zoneId) {
          throw new BadRequestException('Specified outlet does not match the provided zone.');
        }
        if (!resolvedZoneId && outlet.zoneId) {
          resolvedZoneId = outlet.zoneId;
        }
      }
      if (resolvedZoneId) {
        const zone = await tx.facilityZone.findFirst({
          where: { id: resolvedZoneId, facilityId },
          select: { id: true },
        });
        if (!zone) {
          throw new BadRequestException('Specified zone does not belong to this facility.');
        }
      }

      return tx.shiftPunch.create({
        data: {
          organizationId,
          facilityId,
          workerId,
          punchType,
          verifiedVia,
          idempotencyKey: idempotencyKey ?? null,
          zoneId: resolvedZoneId ?? null,
          outletId: outletId ?? null,
          overrideReason: overrideReason ?? null,
        },
      });
    }, { isolationLevel: 'Serializable' });
  }

  async getMultiVenueComplianceOverview(organizationId: string) {
    const facilities = await this.prisma.facility.findMany({
      where: { organizationId, active: true },
      include: {
        unionRuleConfigs: { where: { active: true } },
      },
    });

    const violations = await this.prisma.unionComplianceViolation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { worker: true },
    });

    const openViolations = violations.filter((v) => !v.resolved);

    // Real certified-worker counts per facility — never invent demo numbers.
    const certifiedByFacility = await this.prisma.workerProfile.groupBy({
      by: ['facilityId'],
      where: {
        organizationId,
        active: true,
        certFoodSafety: true,
        certAlcohol: true,
        OR: [{ certAlcoholExpiry: null }, { certAlcoholExpiry: { gte: new Date() } }],
      },
      _count: { _all: true },
    });
    const certifiedCount = new Map(certifiedByFacility.map((row) => [row.facilityId, row._count._all]));

    const pendingRecertByFacility = await this.prisma.workerProfile.groupBy({
      by: ['facilityId'],
      where: {
        organizationId,
        active: true,
        certAlcohol: true,
        certAlcoholExpiry: {
          gte: new Date(),
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
      _count: { _all: true },
    });
    const pendingRecertCount = new Map(pendingRecertByFacility.map((row) => [row.facilityId, row._count._all]));

    const venueSummaries = facilities.map((fac) => {
      const facViolations = violations.filter((v) => v.facilityId === fac.id);
      const openCount = facViolations.filter((v) => !v.resolved).length;
      const penaltyTotal = facViolations.reduce((sum, v) => sum + (v.penaltyAmountCents ?? 0), 0);
      const score = Math.max(0, Math.min(100, 100 - openCount * 3));

      return {
        facilityId: fac.id,
        facilityName: fac.name,
        facilityCode: fac.code,
        healthScore: score,
        status: score >= 95 ? 'compliant' : score >= 85 ? 'watch' : 'action_required',
        activeUnionCba: fac.unionRuleConfigs[0]?.name ?? 'No active CBA configured',
        mealBreakThresholdHours: fac.unionRuleConfigs[0]?.maxContinuousWorkHours ?? 5.0,
        openViolationsCount: openCount,
        resolvedViolationsCount: facViolations.length - openCount,
        penaltyExposureCents: penaltyTotal,
        certifiedWorkersCount: certifiedCount.get(fac.id) ?? 0,
        pendingRecertificationsCount: pendingRecertCount.get(fac.id) ?? 0,
      };
    });

    const totalOpen = openViolations.length;
    const totalPenalty = violations.reduce((sum, v) => sum + (v.penaltyAmountCents ?? 0), 0);

    return {
      organizationId,
      overallHealthScore: venueSummaries.length
        ? Math.round(venueSummaries.reduce((sum, v) => sum + v.healthScore, 0) / venueSummaries.length)
        : 100,
      totalFacilitiesCount: facilities.length,
      totalOpenViolations: totalOpen,
      totalPenaltyExposureCents: totalPenalty,
      venueSummaries,
      recentViolations: violations.slice(0, 10).map((v) => ({
        id: v.id,
        facilityId: v.facilityId,
        workerName: v.worker ? `${v.worker.firstName} ${v.worker.lastName}` : 'Staff Member',
        violationType: v.violationType,
        penaltyPayCents: v.penaltyAmountCents ?? 2500,
        resolved: v.resolved,
        createdAt: v.createdAt,
      })),
    };
  }

  async getCrossVenueSchedulingConflicts(organizationId: string) {
    // Real cross-venue rest-window evaluation is not implemented yet. Return an
    // honest empty result instead of fabricated conflicts.
    return {
      organizationId,
      evaluatedAt: new Date().toISOString(),
      conflictsCount: 0,
      conflicts: [] as Array<Record<string, unknown>>,
      note: 'Cross-venue rest-window evaluation is not yet available for this organization.',
    };
  }

  async getMultiVenueCertificationStatus(organizationId: string) {
    const workers = await this.prisma.workerProfile.findMany({
      where: { organizationId, active: true },
      select: {
        certFoodSafety: true,
        certAlcohol: true,
        certAlcoholExpiry: true,
      },
    });
    const now = Date.now();
    const in30Days = now + 30 * 24 * 60 * 60 * 1000;

    const alcohol = { activeCertified: 0, expiringIn30Days: 0, expired: 0 };
    const food = { activeCertified: 0, expiringIn30Days: 0, expired: 0 };

    for (const worker of workers) {
      if (worker.certFoodSafety) food.activeCertified += 1;
      else food.expired += 1;

      if (!worker.certAlcohol) {
        alcohol.expired += 1;
        continue;
      }
      const expiry = worker.certAlcoholExpiry?.getTime();
      if (expiry != null && expiry < now) {
        alcohol.expired += 1;
      } else if (expiry != null && expiry <= in30Days) {
        alcohol.activeCertified += 1;
        alcohol.expiringIn30Days += 1;
      } else {
        alcohol.activeCertified += 1;
      }
    }

    const rate = (active: number, expired: number) => {
      const total = active + expired;
      return total === 0 ? 100 : Number(((active / total) * 100).toFixed(1));
    };

    return {
      organizationId,
      categories: [
        {
          name: 'TIPS / RBS Responsible Alcohol Service',
          activeCertified: alcohol.activeCertified,
          expiringIn30Days: alcohol.expiringIn30Days,
          expired: alcohol.expired,
          complianceRate: rate(alcohol.activeCertified, alcohol.expired),
        },
        {
          name: 'ServSafe Food Protection Manager / Food Handler',
          activeCertified: food.activeCertified,
          expiringIn30Days: food.expiringIn30Days,
          expired: food.expired,
          complianceRate: rate(food.activeCertified, food.expired),
        },
      ],
    };
  }
}
