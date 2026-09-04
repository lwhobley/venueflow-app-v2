import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { VmsAiService } from './vms-ai.service';

describe('VmsAiService', () => {
  let service: VmsAiService;
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    service = new VmsAiService();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) process.env.GEMINI_API_KEY = originalApiKey;
    else delete process.env.GEMINI_API_KEY;
  });

  it('matches candidate vendors with heuristic fallback when Gemini API key is absent', async () => {
    const candidates = [
      {
        vendorId: 'v-1',
        vendorName: 'Apex Stadium Staffing',
        vendorType: 'staffing_agency',
        rating: 4.8,
        billingMultiplier: 1.35,
        serviceType: 'Bartender',
        hourlyRateCents: 2800,
        overtimeRateCents: 4200,
        minimumNoticeHours: 12,
        activeStaffCount: 25,
      },
      {
        vendorId: 'v-2',
        vendorName: 'Budget Labor Co',
        vendorType: 'labor_contractor',
        rating: 3.2,
        billingMultiplier: 1.2,
        serviceType: 'Bartender',
        hourlyRateCents: 4500,
        overtimeRateCents: 6750,
        minimumNoticeHours: 48,
        activeStaffCount: 2,
      },
    ];

    const results = await service.matchVendorsForOrder(
      {
        roleRequired: 'Bartender',
        quantityRequested: 10,
        shiftDate: '2026-09-12',
        durationHours: 6.0,
        budgetCents: 200000,
        specialRequirements: 'TIPS certification required',
      },
      candidates,
    );

    expect(results).toHaveLength(2);
    // Apex should rank higher due to higher rating (4.8 vs 3.2) and within budget ($28/hr vs $45/hr)
    expect(results[0].vendorId).toBe('v-1');
    expect(results[0].fitScorePercent).toBeGreaterThan(results[1].fitScorePercent);
    expect(results[0].strengths.length).toBeGreaterThan(0);
  });

  it('parses natural language staffing prompt into structured order with fallback heuristic', async () => {
    const prompt = 'Need 6 bartenders for Saturday night 16:00 to 22:00';
    const parsed = await service.parseNaturalLanguageOrder(prompt);

    expect(parsed).toBeDefined();
    expect(parsed.roleRequired).toBe('Bartender');
    expect(parsed.quantityRequested).toBe(6);
    expect(parsed.durationHours).toBeGreaterThan(0);
    expect(parsed.estimatedBudgetCents).toBeGreaterThan(0);
  });

  it('generates event staffing demand forecast with role breakdowns', async () => {
    const forecast = await service.forecastStaffingDemand({
      name: 'Soccer Derby Championship',
      type: 'stadium_sports',
      expectedAttendance: 35000,
      hours: 4.0,
    });

    expect(forecast).toBeDefined();
    expect(forecast.expectedAttendance).toBe(35000);
    expect(forecast.recommendedRoles.length).toBeGreaterThanOrEqual(4);
    expect(forecast.totalEstimatedHeadcount).toBeGreaterThan(50);
    expect(forecast.totalEstimatedCostCents).toBeGreaterThan(0);
  });

  it('detects operational anomalies in time attendance records', () => {
    const anomalies = service.detectAttendanceAnomalies([
      {
        id: 'att-1',
        staffName: 'John Doe',
        hoursWorked: 6.5,
        breakMinutes: 10, // Meal break penalty (< 30m after 5h)
        clockIn: new Date(),
        clockOut: new Date(),
        isWithinGeofence: true,
        deviationFlags: [],
      },
      {
        id: 'att-2',
        staffName: 'Jane Smith',
        hoursWorked: 11.5, // Excessive overtime (> 10h)
        breakMinutes: 45,
        clockIn: new Date(),
        clockOut: new Date(),
        isWithinGeofence: false, // Geofence violation
        deviationFlags: [],
      },
    ]);

    expect(anomalies).toHaveLength(3);
    const flags = anomalies.map((a) => a.flag);
    expect(flags).toContain('meal_break_penalty');
    expect(flags).toContain('off_site_punch');
    expect(flags).toContain('excessive_overtime');
  });
});
