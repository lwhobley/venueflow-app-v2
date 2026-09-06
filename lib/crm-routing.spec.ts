import { describe, expect, it } from 'vitest';
import { EVENT_BEO_ROUTE, READINESS_ROW_ROUTES, parseWorkspaceView } from './crm-routing';
import { SUITE_BEO_REPORT_ROUTE, beoReportRoute, parseReportDepartment } from './beo-report';

/**
 * BEO entry points kept landing on the opening/closing checklist, which is a
 * task list and has nothing to do with a banquet event order. They must reach
 * the published BEO report — the suite BEO list and each department's run of
 * service — not the checklist and not the CRM pipeline, which is where a BEO is
 * drafted rather than where service reads it.
 */
describe('BEO entry point routing', () => {
  it('sends the suite BEO readiness row to the published report, opened on suites', () => {
    const route = READINESS_ROW_ROUTES['Luxury Suite BEOs'];
    expect(route).not.toContain('/checklist');
    expect(route).not.toContain('/(tabs)/guests');
    expect(route).toContain('/stadium/beo-report');

    const department = new URLSearchParams(route.split('?')[1]).get('department');
    expect(parseReportDepartment(department)).toBe('premium_hospitality');
  });

  it('points every BEO entry point at the report route', () => {
    expect(EVENT_BEO_ROUTE).toBe('/stadium/beo-report');
    expect(SUITE_BEO_REPORT_ROUTE).toBe('/stadium/beo-report?department=premium_hospitality');
  });

  it('keeps the rows whose readiness category really is checklist-backed', () => {
    // `setup` scores prep items plus incomplete checklist items.
    expect(READINESS_ROW_ROUTES['Commissary & Kitchens']).toBe('/checklist');
    expect(READINESS_ROW_ROUTES['Staffing & Union Roster']).toBe('/staff');
    expect(READINESS_ROW_ROUTES['Concessions & Stands']).toBe('/facility');
  });

  it('builds an event- and department-scoped report link', () => {
    expect(beoReportRoute()).toBe('/stadium/beo-report');
    expect(beoReportRoute({ eventId: 'evt_1' })).toBe('/stadium/beo-report?eventId=evt_1');
    expect(beoReportRoute({ eventId: 'evt_1', department: 'culinary_production' })).toBe(
      '/stadium/beo-report?eventId=evt_1&department=culinary_production'
    );
  });

  it('ignores deep-link values the screens do not render', () => {
    expect(parseReportDepartment('premium_hospitality')).toBe('premium_hospitality');
    expect(parseReportDepartment('checklist')).toBeUndefined();
    expect(parseReportDepartment(undefined)).toBeUndefined();
    expect(parseWorkspaceView('events')).toBe('events');
    expect(parseWorkspaceView('checklist')).toBeUndefined();
  });
});
