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
 * of service for one event. BEO entry points lead here rather than to the CRM
 * pipeline, which is where a BEO is drafted, not where service reads it.
 */
export { EVENT_BEO_ROUTE, SUITE_BEO_REPORT_ROUTE, beoReportRoute } from './beo-report';

/**
 * Destination for each readiness row on the home screen. The categories come
 * from the readiness endpoint: `approvals` scores unconfirmed BEOs, so that row
 * belongs on the published BEO report opened on the suites section, while
 * `setup` really is checklist-backed.
 */
export const READINESS_ROW_ROUTES = {
  'Concessions & Stands': '/facility',
  'Luxury Suite BEOs': '/stadium/beo-report?department=premium_hospitality',
  'Commissary & Kitchens': '/checklist',
  'Staffing & Union Roster': '/staff',
} as const;

export type ReadinessRowLabel = keyof typeof READINESS_ROW_ROUTES;
