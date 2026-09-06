import { describe, expect, it, vi } from 'vitest';
import { EventBeoReportService, normalizeDepartment } from './event-beo-report.service';

/**
 * The report's value is that a department head can read their section top to
 * bottom and work it in order. These tests hold the two properties that makes
 * possible: every line lands in the right department, and every section is in
 * chronological order.
 */

const EVENT = {
  id: 'evt_1',
  title: 'Texans vs Colts',
  eventCode: 'HOU-2026-01',
  eventType: 'game',
  status: 'confirmed',
  startsAt: new Date('2026-09-13T18:00:00Z'),
  gatesOpenAt: new Date('2026-09-13T16:00:00Z'),
  endsAt: new Date('2026-09-13T21:30:00Z'),
  expectedGuests: 68000,
  opponentOrHeadliner: 'Colts',
  organizationId: 'org_1',
};

function suiteBeo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'beo_1',
    beoNumber: 'BEO-2026-001',
    hostName: 'Acme Corp',
    hostPhone: null,
    hostEmail: null,
    guestCount: 20,
    deliveryWindowStart: new Date('2026-09-13T16:30:00Z'),
    deliveryWindowEnd: new Date('2026-09-13T17:00:00Z'),
    specialInstructions: null,
    cateringLineItems: [
      { code: 'BF-1', name: 'Wagyu carving station', quantity: 2, unitPriceCents: 45000, category: 'entree' },
    ],
    status: 'confirmed_beo',
    totalCents: 90000,
    zone: { name: 'Suites 300' },
    subVenue: { code: 'S-312', name: 'Suite 312' },
    ...overrides,
  };
}

function buildService(data: {
  suiteBeos?: unknown[];
  workspaces?: unknown[];
  readiness?: unknown[];
}) {
  const prisma = {
    venueEvent: { findFirst: vi.fn().mockResolvedValue(EVENT) },
    venue: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'ven_1', name: 'NRG Stadium' }) },
    suiteBeoOrder: { findMany: vi.fn().mockResolvedValue(data.suiteBeos ?? []) },
    eventExecutionWorkspace: { findMany: vi.fn().mockResolvedValue(data.workspaces ?? []) },
    eventFnbReadiness: { findMany: vi.fn().mockResolvedValue(data.readiness ?? []) },
  };
  return new EventBeoReportService(prisma as never);
}

describe('normalizeDepartment', () => {
  it('folds the department names task templates actually use onto F&B departments', () => {
    expect(normalizeDepartment('Suites')).toBe('premium_hospitality');
    expect(normalizeDepartment('kitchen')).toBe('culinary_production');
    expect(normalizeDepartment('Beverage Operations')).toBe('beverage_operations');
    expect(normalizeDepartment('catering-banquets')).toBe('catering_banquets');
  });

  it('parks anything unrecognised in one section instead of inventing a department', () => {
    expect(normalizeDepartment('mascot wrangling')).toBe('unassigned');
    expect(normalizeDepartment('')).toBe('unassigned');
    expect(normalizeDepartment(null)).toBe('unassigned');
  });
});

describe('EventBeoReportService.buildReport', () => {
  it('lists suite BEOs chronologically and totals guests and revenue', async () => {
    const service = buildService({
      suiteBeos: [
        suiteBeo({ id: 'beo_a', beoNumber: 'BEO-A', deliveryWindowStart: new Date('2026-09-13T16:30:00Z') }),
        suiteBeo({
          id: 'beo_b',
          beoNumber: 'BEO-B',
          guestCount: 12,
          totalCents: 40000,
          deliveryWindowStart: new Date('2026-09-13T17:15:00Z'),
        }),
      ],
    });

    const report = await service.buildReport('ven_1', 'evt_1');

    expect(report.suites.rows.map((row) => row.beoNumber)).toEqual(['BEO-A', 'BEO-B']);
    expect(report.suites.beoCount).toBe(2);
    expect(report.suites.guestCount).toBe(32);
    expect(report.suites.revenueCents).toBe(130000);
  });

  it('puts every suite delivery on the premium hospitality timeline', async () => {
    const service = buildService({ suiteBeos: [suiteBeo()] });

    const report = await service.buildReport('ven_1', 'evt_1');
    const premium = report.departments.find((section) => section.code === 'premium_hospitality');

    expect(premium?.lines).toHaveLength(1);
    expect(premium?.lines[0]).toMatchObject({ kind: 'suite_delivery', reference: 'BEO-2026-001' });
  });

  it('orders each department chronologically, with untimed lines last', async () => {
    const service = buildService({
      workspaces: [
        {
          id: 'ws_1',
          tasks: [
            { id: 't_late', title: 'Late task', department: 'kitchen', dueAt: new Date('2026-09-13T15:00:00Z'), status: 'open', critical: false },
            { id: 't_none', title: 'Undated task', department: 'kitchen', dueAt: null, status: 'open', critical: false },
            { id: 't_early', title: 'Early task', department: 'kitchen', dueAt: new Date('2026-09-13T09:00:00Z'), status: 'done', critical: true },
          ],
          timeline: [],
          vendors: [],
        },
      ],
    });

    const report = await service.buildReport('ven_1', 'evt_1');
    const culinary = report.departments.find((section) => section.code === 'culinary_production');

    expect(culinary?.lines.map((line) => line.title)).toEqual(['Early task', 'Late task', 'Undated task']);
    expect(culinary?.openCount).toBe(2);
  });

  it('routes vendors, run of show and outlet readiness to their own sections', async () => {
    const service = buildService({
      workspaces: [
        {
          id: 'ws_1',
          tasks: [],
          timeline: [{ id: 'tl_1', title: 'Gates open', startsAt: new Date('2026-09-13T16:00:00Z'), status: 'pending' }],
          vendors: [{ id: 'v_1', name: 'Gulf Coast Seafood', dueAt: new Date('2026-09-13T12:00:00Z'), status: 'unconfirmed' }],
        },
      ],
      readiness: [
        {
          id: 'r_1',
          status: 'ready',
          notes: null,
          checkedAt: new Date('2026-09-13T14:00:00Z'),
          zone: { code: 'ST-104', name: 'Stand 104', department: 'concessions' },
        },
      ],
    });

    const report = await service.buildReport('ven_1', 'evt_1');
    const codes = report.departments.map((section) => section.code);

    expect(codes).toContain('vendor_partners');
    expect(codes).toContain('concessions');
    expect(codes).toContain('unassigned');
    expect(report.departments.find((s) => s.code === 'concessions')?.openCount).toBe(0);
  });

  it('keeps departments in the report’s reading order and omits empty ones', async () => {
    const service = buildService({
      suiteBeos: [suiteBeo()],
      workspaces: [
        {
          id: 'ws_1',
          tasks: [{ id: 't_1', title: 'Stage bars', department: 'bar', dueAt: null, status: 'open', critical: false }],
          timeline: [],
          vendors: [],
        },
      ],
    });

    const report = await service.buildReport('ven_1', 'evt_1');

    expect(report.departments.map((section) => section.code)).toEqual([
      'premium_hospitality',
      'beverage_operations',
    ]);
  });

  it('reports the gaps that make a published report incomplete', async () => {
    const service = buildService({});

    const report = await service.buildReport('ven_1', 'evt_1');

    expect(report.dataGaps).toContain('No suite BEOs are attached to this event.');
    expect(report.dataGaps).toContain(
      'This event has no execution workspace, so no departmental run of service exists yet.'
    );
  });

  it('drops malformed catering line items rather than rendering blanks', async () => {
    const service = buildService({
      suiteBeos: [
        suiteBeo({
          cateringLineItems: [
            { code: 'OK', name: 'Crab tower', quantity: 1, unitPriceCents: 100, category: 'appetizer' },
            { code: 'NO_NAME' },
            'not an object',
            null,
          ],
        }),
      ],
    });

    const report = await service.buildReport('ven_1', 'evt_1');

    expect(report.suites.rows[0].lineItems).toHaveLength(1);
    expect(report.suites.rows[0].lineItems[0].name).toBe('Crab tower');
  });
});
