/**
 * Where the BEO and readiness entry points lead.
 *
 * These live outside the screens so they can be asserted without rendering a
 * whole tab: the rows and blockers that talk about BEOs kept falling through to
 * the opening/closing checklist, which is a task list and scores a different
 * readiness category entirely.
 */

export type WorkspaceView =
  | 'dashboard'
  | 'pipeline'
  | 'contacts'
  | 'events'
  | 'contracts'
  | 'insights'
  | 'templates';

const WORKSPACE_VIEWS: WorkspaceView[] = [
  'dashboard',
  'pipeline',
  'contacts',
  'events',
  'contracts',
  'insights',
  'templates',
];

/** Narrows a deep-link parameter to a view the CRM workspace actually renders. */
export function parseWorkspaceView(value: unknown): WorkspaceView | undefined {
  return typeof value === 'string' && (WORKSPACE_VIEWS as string[]).includes(value)
    ? (value as WorkspaceView)
    : undefined;
}

/**
 * The published event BEO report — the suite BEO list and each department's run
 * of service for one event. Operational BEO entry points lead here.
 */
export { EVENT_BEO_ROUTE, SUITE_BEO_REPORT_ROUTE, beoReportRoute } from './beo-report';

/**
 * The CRM workspace on its Events tab, where BEOs are drafted and converted to
 * contracts. `eventName` filters the list to one event — the fallback for a
 * suite order that carries no `crmBeoId`; a linked one uses `crmBeoRoute`.
 */
export function crmEventBeoRoute(eventName?: string): string {
  const query = new URLSearchParams({ crmView: 'events' });
  if (eventName) query.set('crmEvent', eventName);
  return `/(tabs)/guests?${query.toString()}`;
}

/**
 * One sales BEO in the CRM, by record id. A suite order linked to its `CrmBeo`
 * can route here exactly, rather than filtering the list by event name.
 */
export function crmBeoRoute(crmBeoId: string): string {
  const query = new URLSearchParams({ crmView: 'events', crmBeoId });
  return `/(tabs)/guests?${query.toString()}`;
}

/**
 * Destination for each readiness row on the home screen.
 *
 * The categories come from the readiness endpoint, and each row goes to the
 * screen holding the records that produced its score. `approvals` counts
 * unconfirmed `CrmBeo` rows, so that row belongs in the CRM — the published BEO
 * report is built from `SuiteBeoOrder`, a different table, and would show a
 * number's worth of records that are not the ones being scored. `setup` really
 * is checklist-backed.
 */
export const READINESS_ROW_ROUTES = {
  'Concessions & Stands': '/facility',
  'Luxury Suite BEOs': '/(tabs)/guests?crmView=events',
  'Commissary & Kitchens': '/checklist',
  'Staffing & Union Roster': '/staff',
} as const;

export type ReadinessRowLabel = keyof typeof READINESS_ROW_ROUTES;
