import { describe, expect, it } from 'vitest';
import { READINESS_ROW_ROUTES, parseWorkspaceView } from './crm-routing';

/**
 * BEO entry points kept landing on the opening/closing checklist, which is a
 * task list and has nothing to do with a banquet event order. These assertions
 * pin each row to the screen that actually holds the data it scores.
 */
describe('BEO entry point routing', () => {
  it('sends the suite BEO readiness row to the BEO list, never to the checklist', () => {
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

  it('ignores a deep-link view the CRM workspace does not render', () => {
    expect(parseWorkspaceView('events')).toBe('events');
    expect(parseWorkspaceView('checklist')).toBeUndefined();
    expect(parseWorkspaceView(undefined)).toBeUndefined();
  });
});
