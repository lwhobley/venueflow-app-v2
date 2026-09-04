import { Injectable, Logger } from '@nestjs/common';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../common/ai-json-parse';

export interface VendorMatchCandidate {
  vendorId: string;
  vendorName: string;
  vendorType: string;
  rating: number;
  billingMultiplier: number;
  serviceType: string;
  hourlyRateCents: number;
  overtimeRateCents: number;
  minimumNoticeHours: number;
  activeStaffCount: number;
}

export interface MatchedVendorResult {
  vendorId: string;
  vendorName: string;
  fitScorePercent: number;
  recommendedHourlyRateCents: number;
  reasoning: string;
  strengths: string[];
  riskFactors: string[];
}

export interface DemandForecastResult {
  eventType: string;
  expectedAttendance: number;
  recommendedRoles: Array<{
    role: string;
    headcount: number;
    recommendedDurationHours: number;
    estimatedCostCents: number;
    notes: string;
  }>;
  totalEstimatedHeadcount: number;
  totalEstimatedCostCents: number;
  confidenceScore: number;
}

export interface AnomalyReport {
  attendanceId: string;
  staffName: string;
  severity: 'low' | 'medium' | 'high';
  flag: string;
  description: string;
  suggestedAction: string;
}

export interface ParsedStaffingPrompt {
  title: string;
  roleRequired: string;
  quantityRequested: number;
  shiftDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  estimatedBudgetCents: number;
  specialRequirements?: string;
}

const DEFAULT_MODEL = 'gemini-flash-latest';

@Injectable()
export class VmsAiService {
  private readonly logger = new Logger(VmsAiService.name);

  /**
   * Smart Vendor Matching: Evaluates candidate staffing vendors against an order requisition
   * using Gemini 3.8 / Flash with heuristic fallback.
   */
  async matchVendorsForOrder(
    order: {
      roleRequired: string;
      quantityRequested: number;
      shiftDate: string;
      durationHours: number;
      budgetCents: number;
      specialRequirements?: string | null;
    },
    candidates: VendorMatchCandidate[],
  ): Promise<MatchedVendorResult[]> {
    if (candidates.length === 0) return [];

    const apiKey = resolveAiApiKey();
    if (apiKey) {
      try {
        const prompt = `You are an enterprise stadium workforce intelligence system.
Analyze this staffing order and candidate vendor profiles. Score each candidate (0-100 fit percentage) based on:
1. Role & skill alignment
2. Hourly rate vs requested budget
3. Historical vendor rating and reliability
4. Minimum notice hours compliance

Order:
- Role: ${order.roleRequired}
- Quantity Needed: ${order.quantityRequested}
- Date: ${order.shiftDate}
- Duration: ${order.durationHours} hours
- Total Budget: $${(order.budgetCents / 100).toFixed(2)}
- Special Requirements: ${order.specialRequirements || 'None'}

Candidates:
${JSON.stringify(candidates, null, 2)}

Return a strict JSON object with this shape:
{
  "matches": [
    {
      "vendorId": "string",
      "vendorName": "string",
      "fitScorePercent": number,
      "recommendedHourlyRateCents": number,
      "reasoning": "string",
      "strengths": ["string"],
      "riskFactors": ["string"]
    }
  ]
}`;

        const model = resolveAiModel(process.env.GEMINI_VMS_MODEL, DEFAULT_MODEL);
        const res = (await callAiJson({
          apiKey,
          model,
          prompt,
          feature: 'vms_vendor_matching',
        })) as any;

        const data = res.data as { matches?: MatchedVendorResult[] };
        if (Array.isArray(data?.matches) && data.matches.length > 0) {
          return data.matches.sort((a, b) => b.fitScorePercent - a.fitScorePercent);
        }
      } catch (err) {
        this.logger.warn(`AI matching failed, using heuristic fallback: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Heuristic Fallback
    return candidates
      .map((c) => {
        let score = 70;
        const strengths: string[] = [];
        const riskFactors: string[] = [];

        // Rating bonus
        score += Math.round((c.rating - 3.0) * 10);
        if (c.rating >= 4.5) strengths.push('Consistently top-rated tier 1 agency');

        // Rate check
        const hourlyBudgetPerWorker =
          order.durationHours > 0 && order.quantityRequested > 0 && order.budgetCents > 0
            ? Math.round(order.budgetCents / (order.durationHours * order.quantityRequested))
            : 3500;

        if (c.hourlyRateCents <= hourlyBudgetPerWorker) {
          score += 15;
          strengths.push('Within target hourly budget margin');
        } else {
          score -= 15;
          riskFactors.push('Quoted rate exceeds target budget ceiling');
        }

        // Capacity check
        if (c.activeStaffCount >= order.quantityRequested) {
          score += 10;
          strengths.push(`Adequate active workforce roster (${c.activeStaffCount} available)`);
        } else {
          score -= 10;
          riskFactors.push(`Roster limited (${c.activeStaffCount} active staff vs ${order.quantityRequested} requested)`);
        }

        score = Math.max(10, Math.min(99, score));

        return {
          vendorId: c.vendorId,
          vendorName: c.vendorName,
          fitScorePercent: score,
          recommendedHourlyRateCents: c.hourlyRateCents,
          reasoning: `Matched based on rate alignment ($${(c.hourlyRateCents / 100).toFixed(2)}/hr) and vendor score (${c.rating.toFixed(1)}/5.0).`,
          strengths,
          riskFactors,
        };
      })
      .sort((a, b) => b.fitScorePercent - a.fitScorePercent);
  }

  /**
   * Natural Language Order Requisition: Parses plain English staffing request
   * into a structured staffing order DTO.
   */
  async parseNaturalLanguageOrder(promptText: string): Promise<ParsedStaffingPrompt> {
    const apiKey = resolveAiApiKey();
    if (apiKey) {
      try {
        const prompt = `Parse this venue manager staffing requisition prompt into a structured order object.
Today's reference year is 2026.
Prompt: "${promptText}"

Return JSON matching:
{
  "title": "string (descriptive title)",
  "roleRequired": "string (e.g. Bartender, Concessions Cashier, Suite Attendant, Security, Cook)",
  "quantityRequested": number (default 5 if unspecified),
  "shiftDate": "YYYY-MM-DD",
  "startTime": "HH:mm (24h)",
  "endTime": "HH:mm (24h)",
  "durationHours": number,
  "estimatedBudgetCents": number (in cents, e.g. 50000 = $500.00),
  "specialRequirements": "string or null"
}`;

        const model = resolveAiModel(process.env.GEMINI_VMS_MODEL, DEFAULT_MODEL);
        const res = (await callAiJson({
          apiKey,
          model,
          prompt,
          feature: 'vms_natural_language_order',
        })) as any;

        const data = res.data as ParsedStaffingPrompt;
        if (data?.roleRequired && data?.quantityRequested > 0) {
          return data;
        }
      } catch (err) {
        this.logger.warn(`AI natural language parsing failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Heuristic extraction fallback
    const roleMatch = promptText.match(/\b(bartender|barback|cook|chef|cashier|security|attendant|server|dishwasher|porter)\w*/i);
    const qtyMatch = promptText.match(/\b(\d+)\b/);
    const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 4;
    const role = roleMatch ? roleMatch[1].charAt(0).toUpperCase() + roleMatch[1].slice(1).toLowerCase() : 'Event Staff';

    const today = new Date();
    const futureDate = new Date(today.getTime() + 2 * 86400 * 1000);
    const shiftDate = futureDate.toISOString().split('T')[0];

    return {
      title: `${quantity}x ${role} for Upcoming Shift`,
      roleRequired: role,
      quantityRequested: quantity,
      shiftDate,
      startTime: '16:00',
      endTime: '22:00',
      durationHours: 6.0,
      estimatedBudgetCents: quantity * 6 * 2800,
      specialRequirements: promptText,
    };
  }

  /**
   * Demand Forecasting: Predicts staffing requirements for an event based on attendance and event type.
   */
  async forecastStaffingDemand(event: {
    name: string;
    type: string;
    expectedAttendance: number;
    hours: number;
  }): Promise<DemandForecastResult> {
    const attendance = event.expectedAttendance || 15000;
    const duration = event.hours || 4;

    const apiKey = resolveAiApiKey();
    if (apiKey) {
      try {
        const prompt = `You are a high-volume sports stadium and arena workforce planning AI.
Forecast staffing requirements for:
- Event: ${event.name}
- Type: ${event.type}
- Expected Attendance: ${attendance} attendees
- Duration: ${duration} hours

Predict recommended roles, headcounts, hours, and estimated cost in cents (using industry standard $25-$45/hr).
Return strictly formatted JSON:
{
  "eventType": "${event.type}",
  "expectedAttendance": ${attendance},
  "recommendedRoles": [
    {
      "role": "string",
      "headcount": number,
      "recommendedDurationHours": number,
      "estimatedCostCents": number,
      "notes": "string"
    }
  ],
  "totalEstimatedHeadcount": number,
  "totalEstimatedCostCents": number,
  "confidenceScore": number (0.0 to 1.0)
}`;

        const model = resolveAiModel(process.env.GEMINI_VMS_MODEL, DEFAULT_MODEL);
        const res = (await callAiJson({
          apiKey,
          model,
          prompt,
          feature: 'vms_demand_forecast',
        })) as any;

        const data = res.data as DemandForecastResult;
        if (Array.isArray(data?.recommendedRoles) && data.recommendedRoles.length > 0) {
          return data;
        }
      } catch (err) {
        this.logger.warn(`AI forecasting failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Heuristic venue ratio modeling (e.g. 1 concessions staff per 150 fans, 1 security per 250 fans)
    const concessionsCount = Math.max(8, Math.round(attendance / 180));
    const bartendersCount = Math.max(4, Math.round(attendance / 400));
    const suiteAttendants = Math.max(6, Math.round(attendance / 600));
    const securityCount = Math.max(10, Math.round(attendance / 250));
    const culinaryPrep = Math.max(4, Math.round(attendance / 750));

    const roles = [
      {
        role: 'Concessions Cashier & Runner',
        headcount: concessionsCount,
        recommendedDurationHours: duration + 1,
        estimatedCostCents: concessionsCount * (duration + 1) * 2200,
        notes: 'Covers main concourse and upper bowl express stands.',
      },
      {
        role: 'Bartender',
        headcount: bartendersCount,
        recommendedDurationHours: duration + 1.5,
        estimatedCostCents: bartendersCount * (duration + 1.5) * 2800,
        notes: 'Club level and concourse craft cocktail bars.',
      },
      {
        role: 'Suite Attendant',
        headcount: suiteAttendants,
        recommendedDurationHours: duration + 2,
        estimatedCostCents: suiteAttendants * (duration + 2) * 3000,
        notes: 'Dedicated luxury suite catering and replenishment.',
      },
      {
        role: 'Event Security & Access Control',
        headcount: securityCount,
        recommendedDurationHours: duration + 2,
        estimatedCostCents: securityCount * (duration + 2) * 2600,
        notes: 'Gates, metal detectors, and backstage egress.',
      },
      {
        role: 'Culinary Prep & Kitchen Distro',
        headcount: culinaryPrep,
        recommendedDurationHours: duration + 3,
        estimatedCostCents: culinaryPrep * (duration + 3) * 2500,
        notes: 'Commissary kitchen prep and satellite galley distribution.',
      },
    ];

    const totalHeadcount = roles.reduce((sum, r) => sum + r.headcount, 0);
    const totalCost = roles.reduce((sum, r) => sum + r.estimatedCostCents, 0);

    return {
      eventType: event.type,
      expectedAttendance: attendance,
      recommendedRoles: roles,
      totalEstimatedHeadcount: totalHeadcount,
      totalEstimatedCostCents: totalCost,
      confidenceScore: 0.92,
    };
  }

  /**
   * Anomaly Detection: Detects anomalies in time attendance logs (ghost punches, meal break penalties, overtime).
   */
  detectAttendanceAnomalies(
    records: Array<{
      id: string;
      staffName: string;
      hoursWorked: number;
      breakMinutes: number;
      clockIn: Date;
      clockOut: Date | null;
      isWithinGeofence: boolean;
      deviationFlags: string[];
    }>,
  ): AnomalyReport[] {
    const anomalies: AnomalyReport[] = [];

    for (const rec of records) {
      // 1. Geofence violation
      if (!rec.isWithinGeofence) {
        anomalies.push({
          attendanceId: rec.id,
          staffName: rec.staffName,
          severity: 'high',
          flag: 'off_site_punch',
          description: 'Clock punch registered outside venue geofence boundary.',
          suggestedAction: 'Require manager GPS override or verify device location.',
        });
      }

      // 2. Meal break violation (> 5 hours without at least 30m break)
      if (rec.hoursWorked >= 5.0 && rec.breakMinutes < 30) {
        anomalies.push({
          attendanceId: rec.id,
          staffName: rec.staffName,
          severity: 'high',
          flag: 'meal_break_penalty',
          description: `Worked ${rec.hoursWorked.toFixed(1)} hours with only ${rec.breakMinutes}m break (statutory 30m required).`,
          suggestedAction: 'Apply 1-hour statutory meal penalty pay.',
        });
      }

      // 3. Excessive overtime (> 10 hours)
      if (rec.hoursWorked > 10.0) {
        anomalies.push({
          attendanceId: rec.id,
          staffName: rec.staffName,
          severity: 'medium',
          flag: 'excessive_overtime',
          description: `Shift exceeded 10 hours (${rec.hoursWorked.toFixed(1)}h total).`,
          suggestedAction: 'Review supervisor overtime pre-authorization.',
        });
      }

      // 4. Incomplete punch (> 12 hours clocked in without clock out)
      if (!rec.clockOut) {
        const elapsedHours = (Date.now() - new Date(rec.clockIn).getTime()) / (1000 * 3600);
        if (elapsedHours > 12) {
          anomalies.push({
            attendanceId: rec.id,
            staffName: rec.staffName,
            severity: 'high',
            flag: 'missing_clock_out',
            description: `Still clocked in after ${elapsedHours.toFixed(1)} hours.`,
            suggestedAction: 'Close punch with verified departure time.',
          });
        }
      }
    }

    return anomalies;
  }
}
