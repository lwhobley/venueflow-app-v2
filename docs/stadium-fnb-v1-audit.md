# Stadium F&B v1 pilot audit

## Scope and method

Inspected the Prisma schema and migrations, NestJS venue scope/authorization, the Stadium controller, Inventory/Prep flows, Expo Router screens, React Query request layer, and the current Supabase RLS migration posture.

## Current strengths

- The API is server-mediated and the production path fail-closes Supabase Data API access for `anon` and `authenticated`.
- A Prisma tenant extension enforces `venueId` for the current direct venue-owned model set, and controllers use `VenueScope` rather than client-supplied venue IDs.
- Stadium foundations exist: events, F&B operation units (outlets/zones), event readiness, partners, an event plan response, and a facility screen.
- Bar inventory, prep-board, document, checklist, audit-log, and event-execution primitives are already present and reusable.

## Pilot blockers and priority

### P0 — implement in this pass

1. Add a pilot event lifecycle field with the required states and server-enforced transition rules. The legacy event status remains for compatibility while the new state drives pilot operations.
2. Add first-class `EventIssue` records, an append-only event audit trail, and authenticated report/acknowledge/resolve endpoints with outlet scoping.
3. Add tenant ownership fields (`organizationId`, `venueId`) to all new Stadium-pilot entities and enforce their values from the active venue scope. A venue's organization is the server-side source of truth.
4. Record critical Stadium creates, state changes, readiness updates, and issue actions in immutable audit records.

### P1 — explicitly deferred after this focused pass

- Backfill `organizationId` onto every legacy venue-owned model. The current repository has many mature restaurant/workforce models with only `venueId`; a safe backfill requires an organization migration, data migration, and a staged rollout rather than a broad untested rewrite.
- Complete granular workflow permissions and a member-management migration for the requested Stadium role taxonomy. This pass adds the requested role values and server-side venue-operation authorization, but does not yet alter existing workforce role-management UI.
- Persist forecasts, pars, recipes, labor plans, transfers, counts, and 86s in canonical event-owned tables. Event closeout actuals are now persisted, but upstream POS/payroll/inventory feeds remain manual or CSV-based.
- Expand the offline queue beyond event issues and readiness to every inventory/count/transfer surface, with per-operation conflict UI. The shared durable queue and replay path are now enabled for event issues/readiness.
- Product analytics provider and a Pilot Health UI. No analytics client is configured; pilot metrics will be designed against the new audit events rather than fabricated third-party integrations.
- Full demo data set and authenticated provider integrations. The pilot will use manual entry/CSV import paths until provider credentials and contracts are available.

## Design decisions for this pass

- Preserve existing visual components and workflows.
- Keep the existing `VenueEvent.status` enum for compatibility. Add `operationalState` for pilot workflow enforcement.
- Keep Supabase tables private to the NestJS API: RLS is enabled and `anon`/`authenticated` receive no grants. The Cloud Run API remains the only data path.
- Use immutable database triggers on event audit records. No application endpoint exposes update/delete operations for those records.

## Implementation order

1. Prisma schema + additive migration: organization, pilot state, issues, immutable audit record, indexes, RLS/revokes/triggers.
2. Server-side authorization and state-transition service with unit tests.
3. Stadium API endpoints for lifecycle, issues, audit feed, and summary.
4. React Query routes and a minimal Event Issues view in the existing F&B Operations screen.
5. Pilot runbook, demo-seed design, and validation commands.

## 2026-08-13 implementation update (priorities 1-3)

- Added `EventCloseout` with forecast/actual sales, attendance, labor, inventory variance, outlet/inventory/labor results, finalization, adjustment reasons, and audit events.
- Added a mobile closeout screen at `/event-closeout` linked from the event command center. Finalized records require an authorized adjustment reason before edits.
- Added `organizationId` to `VenueEvent` and `EventFnbReadiness`, tenant-scoped RLS policies, and idempotent `clientMutationId` handling for event issues.
- Added a durable SecureStore-backed offline write queue with replay on app activation. Event issue and readiness mutations enqueue on transient failures and replay without duplicating an issue.
- Added role-aware operational issue authorization, leadership/audit-only Pilot Health access, server-side issue filters, and audit-derived pilot metrics for active events, readiness, critical issues, closeouts, and 24-hour user activity.
- Added integration-readiness reporting for POS/reservations, recent POS activity, canonical inventory coverage, and the approved CSV/manual fallback path.
- Added an NFL game-day brief with load-in, gates, pregame, kickoff, halftime, and postgame phases plus department activation and safety controls.
- Added `EventPlanSnapshot` so generated forecasts, pars, labor, production, checklists, and data gaps are persisted against the event with tenant RLS.
- Added a visible mobile sync status indicator for pending offline writes and automatic retry messaging.
