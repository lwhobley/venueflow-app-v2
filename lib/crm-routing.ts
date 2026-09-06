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

/** The CRM workspace opened on its Events tab — the event BEO list. */
export const EVENT_BEO_ROUTE = '/(tabs)/guests?crmView=events';

/**
 * Destination for each readiness row on the home screen. The categories come
 * from the readiness endpoint: `approvals` scores unconfirmed CRM BEOs, so that
 * row belongs on the BEO list, while `setup` really is checklist-backed.
 */
export const READINESS_ROW_ROUTES = {
  'Concessions & Stands': '/facility',
  'Luxury Suite BEOs': EVENT_BEO_ROUTE,
  'Commissary & Kitchens': '/checklist',
  'Staffing & Union Roster': '/staff',
} as const;

export type ReadinessRowLabel = keyof typeof READINESS_ROW_ROUTES;
