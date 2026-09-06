import { describe, expect, it } from 'vitest';
import {
  EVENT_BEO_ROUTE,
  READINESS_ROW_ROUTES,
  crmBeoRoute,
  crmEventBeoRoute,
  parseWorkspaceView,
} from './crm-routing';
import { SUITE_BEO_REPORT_ROUTE, beoReportRoute, parseReportDepartment } from './beo-report';

/**
 * There are two BEO records with no relation between them: `CrmBeo`, the sales
 * document drafted in the CRM, and `SuiteBeoOrder`, the operational suite order
 * the published report is built from. Each entry point has to lead to the one
 * holding the records it is talking about — and never to the opening/closing
 * checklist, which is a task list and has nothing to do with either.
 */
describe('BEO entry point routing', () => {
  it('sends the suite BEO readiness row to the CRM, which holds the rows it scores', () => {
    // `approvals` counts unconfirmed CrmBeo rows, so the report — built from
    // SuiteBeoOrder — would show a different set of records than the number.
    const route = READINESS_ROW_ROUTES['Luxury Suite BEOs'];
    expect(route).not.toContain('/checklist');
    expect(route).toContain('/(tabs)/guests');
    expect(parseWorkspaceView(new URLSearchParams(route.split('?')[1]).get('crmView'))).toBe('events');
  });

  it('keeps the rows whose readiness category really is checklist-backed', () => {
    // `setup` scores prep items plus incomplete checklist items.
    expect(READINESS_ROW_ROUTES['Commissary & Kitchens']).toBe('/checklist');
    expect(READINESS_ROW_ROUTES['Staffing & Union Roster']).toBe('/staff');
    expect(READINESS_ROW_ROUTES['Concessions & Stands']).toBe('/facility');
  });

  it('points the operational BEO entry points at the published report', () => {
    expect(EVENT_BEO_ROUTE).toBe('/stadium/beo-report');
    expect(SUITE_BEO_REPORT_ROUTE).toBe('/stadium/beo-report?department=premium_hospitality');
  });

  it('builds an event- and department-scoped report link', () => {
    expect(beoReportRoute()).toBe('/stadium/beo-report');
    expect(beoReportRoute({ eventId: 'evt_1' })).toBe('/stadium/beo-report?eventId=evt_1');
    expect(beoReportRoute({ eventId: 'evt_1', department: 'culinary_production' })).toBe(
      '/stadium/beo-report?eventId=evt_1&department=culinary_production'
    );
  });

  it('links a suite row to its own sales BEO record when one is linked', () => {
    const params = new URLSearchParams(crmBeoRoute('crm_1').split('?')[1]);
    expect(params.get('crmView')).toBe('events');
    expect(params.get('crmBeoId')).toBe('crm_1');
    // An exact record link never also carries a name filter to compete with it.
    expect(params.get('crmEvent')).toBeNull();
  });

  it('falls back to filtering the CRM by event name for an unlinked suite row', () => {
    expect(crmEventBeoRoute()).toBe('/(tabs)/guests?crmView=events');

    const route = crmEventBeoRoute('Texans vs Colts');
    const params = new URLSearchParams(route.split('?')[1]);
    expect(params.get('crmView')).toBe('events');
    expect(params.get('crmEvent')).toBe('Texans vs Colts');
  });

  it('ignores deep-link values the screens do not render', () => {
    expect(parseReportDepartment('premium_hospitality')).toBe('premium_hospitality');
    expect(parseReportDepartment('checklist')).toBeUndefined();
    expect(parseReportDepartment(undefined)).toBeUndefined();
    expect(parseWorkspaceView('events')).toBe('events');
    expect(parseWorkspaceView('checklist')).toBeUndefined();
  });
});
