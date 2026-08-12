# Stadium Wrangler hierarchical tenancy migration plan

Status: design and execution plan only. No database migration was run while producing these artifacts.

## Decision summary

The target hierarchy is:

`Organization -> Facility -> FacilityZone -> SubVenue -> Outlet -> Terminal`

An outlet always belongs to a facility and zone. `subVenueId` is nullable because general-public stands, carts, and markets live directly in a concourse, while clubs, suite groups, loge areas, commissaries, and banquet spaces naturally sit inside a sub-venue. A terminal always belongs to one outlet.

Tenant identity is stored redundantly on operational rows as `organizationId`, `facilityId`, and, where applicable, `zoneId`. Composite foreign keys ensure those values describe one valid ancestry chain. This denormalization is intentional: it makes RLS predicates indexable and prevents every operational query from walking four parent tables.

The visual model is in [stadium-hierarchy-erd.mmd](./stadium-hierarchy-erd.mmd). The target Prisma design is in [stadium-hierarchy-target-schema.prisma](./stadium-hierarchy-target-schema.prisma). The review-only RLS policy template is in [stadium-hierarchy-rls.sql](./stadium-hierarchy-rls.sql). Read-only production inventory queries are in [stadium-hierarchy-preflight.sql](./stadium-hierarchy-preflight.sql).

## Current-state audit

- `Organization` already exists and owns one or more `Venue` records.
- `Venue` is the current tenant root and represents the future facility.
- `FnbOperationUnit.stadiumZone` is free text; there is no normalized zone entity.
- `FnbOperationUnit` combines premium spaces, kitchens, stands, carts, bars, and pickup points in one table.
- `EventFnbReadiness.zoneId` currently references `FnbOperationUnit`, so the field is semantically an outlet/unit ID rather than a physical zone ID.
- `Profile` carries one nullable `venueId`; organization membership and facility/zone assignments are not first-class records.
- The NestJS API issues its own JWT and does not use Supabase Auth. Therefore `auth.uid()` is not the application identity source for RLS.
- Existing RLS is deliberately fail-closed for `anon` and `authenticated`; the Cloud Run API relies on controller filters plus a Prisma `venueId` extension. RLS does not currently provide automatic facility/zone filtering for the API path.
- The current runtime connection must be treated as potentially RLS-bypassing until it is replaced with a dedicated `NOBYPASSRLS` login. `FORCE ROW LEVEL SECURITY` does not constrain PostgreSQL superusers.

## Legacy-to-target mapping

| Current | Target | Backfill rule |
|---|---|---|
| `Organization` | `Organization` | Preserve IDs. |
| `Venue` | `Facility` | Preserve each `Venue.id` as `Facility.id`; copy organization, name, code, address, coordinates, timezone, and capacity. |
| `FnbOperationUnit.stadiumZone` | `FacilityZone` | Normalize trimmed, case-folded values per facility; create one `UNASSIGNED` zone for blank values. |
| Premium/commissary/banquet `FnbOperationUnit` | `SubVenue` plus `Outlet` when it transacts | Create a sub-venue for physical hospitality/production spaces; retain a separate outlet only when the unit serves, produces, or transacts. Flag ambiguous rows for manual review. |
| Stand/cart/bar/market/kiosk `FnbOperationUnit` | `Outlet` | Preserve the operation-unit ID as outlet ID where possible. |
| POS device/provider location | `Terminal` | Import only when a stable terminal/device identifier exists; do not fabricate terminals from aggregate POS connections. |
| `Profile` | `OrganizationMembership` + `ScopeAssignment` | Collapse profiles by user and organization; create a facility-wide scope (`zoneId = NULL`) for each active profile/venue membership. |
| `VenueEvent.venueId` | `VenueEvent.facilityId` | Copy the preserved facility ID; add organization ID from facility. |
| `EventFnbReadiness.zoneId` | `EventFnbReadiness.outletId` | Rename semantically after outlet mapping; add a new nullable physical `zoneId`. |
| `EventIssue.venueId/outletId` | `facilityId/zoneId/outletId` | Backfill facility from legacy venue and zone from mapped outlet. |

## Scope semantics

- Organization scope: `facilityId IS NULL`, `zoneId IS NULL`; intended for organization administrators after they explicitly select an organization.
- Facility scope: `facilityId IS NOT NULL`, `zoneId IS NULL`; intended for venue owners, facility administrators, and directors who can see all zones in that facility.
- Zone scope: both IDs are present; intended for zone/outlet operational leaders.
- `zoneId` may never be set without `facilityId`.
- A user may have multiple assignments, but every request has exactly one active organization/facility/zone scope. Switching scope requires server validation against active assignments and a new request context.
- Platform administrators still select an organization before accessing tenant rows; there is no unbounded default tenant query.

## RLS execution model

The mobile client continues to call the NestJS REST API. Supabase `anon`, `authenticated`, and service-role credentials remain absent from the Expo bundle.

1. The API verifies its JWT and revocable `Session` row.
2. Inside one Prisma interactive transaction, it calls `set_config('app.user_id', ..., true)`.
3. It reads the caller's active organization membership and scope assignment.
4. It rejects any requested facility/zone not present in those assignments.
5. It sets `app.organization_id`, `app.facility_id`, and `app.zone_id` with transaction-local `set_config` calls. Membership-management capability is derived inside PostgreSQL from the active membership; it is not accepted as a client or session setting.
6. All request queries use that same transaction client/connection. `SET LOCAL`-equivalent settings disappear automatically at commit or rollback and cannot leak through the Supabase pooler.
7. RLS compares indexed row columns with the transaction-local scope and independently requires an active membership plus a matching persisted `ScopeAssignment`. Facility or zone nullability implements the wider scopes described above; request settings can narrow access but cannot widen the user's stored assignments.

The policies target a `stadium_api` `NOLOGIN NOBYPASSRLS` group role. Production must use a separate generated-password login such as `stadium_api_runtime`, also `NOBYPASSRLS`, that is granted membership in that group. Migrations use a separate owner credential. Never use the Supabase `postgres` owner or service-role key as the Cloud Run runtime credential.

## Staged execution plan

### Gate 0 — inventory, backup, and role preparation

1. Capture row counts, null rates, duplicate codes, invalid tenant links, and distinct `stadiumZone` values.
2. Take and verify a restorable Supabase backup/PITR checkpoint.
3. Prepare the generated credentials for a `stadium_api_runtime LOGIN NOBYPASSRLS` role outside source control and store the password only in Secret Manager. Granting the policy group happens after Phase 1 creates it.
4. Confirm the Cloud Run secret can hold a second candidate `DATABASE_URL` without changing traffic.
5. Record baseline latency and error rates for event, outlet, inventory, transfer, checklist, and issue endpoints.

Approval gate: zero unexplained cross-venue references; backup restore procedure verified; candidate runtime credentials stored without changing production traffic.

### Phase 1 — additive hierarchy

1. Add `Facility`, `FacilityZone`, `SubVenue`, `Outlet`, `Terminal`, `OrganizationMembership`, and `ScopeAssignment`.
2. Add all foreign-key indexes and composite unique keys before backfill.
3. Add the SQL-only check `zoneId IS NULL OR facilityId IS NOT NULL` to `ScopeAssignment`.
4. Keep all legacy tables and columns unchanged.
5. Enable and force RLS on the new tables; keep Data API roles revoked.
6. Create the `stadium_api_runtime` login, grant it the migration-created `stadium_api` group role, and verify it cannot bypass a forced test policy.

Approval gate: Prisma schema validation passes; migration applies to an empty test database and a production-shaped clone.

### Phase 2 — deterministic backfill

1. Copy `Venue` to `Facility` using the same IDs.
2. Normalize zone text and create deterministic zone mappings. Empty values map to `UNASSIGNED`, never to a guessed concourse.
3. Classify each `FnbOperationUnit`; migrate clear outlet types automatically and emit ambiguous premium/production rows to a reconciliation report.
4. Backfill organization memberships and facility-wide scope assignments from active profiles with `userId` values.
5. Backfill `organizationId`, `facilityId`, and `zoneId` onto event and operational tables in bounded batches.
6. Add new foreign keys as `NOT VALID`, reconcile failures, then `VALIDATE CONSTRAINT` to reduce long blocking windows.

Approval gate: source/target counts reconcile, every target outlet has exactly one valid facility/zone ancestry, and every active administrator has at least one valid assignment.

### Phase 3 — dual-read/dual-write application release

1. Add hierarchy REST endpoints and response types using existing React Query conventions.
2. Make hierarchy writes populate both new and legacy representations while legacy clients remain active.
3. Extend request context from `venueId` to organization/facility/zone and keep the current Prisma tenant extension as an additional guard during transition.
4. Add structured logging for scope selection and RLS denials without logging PINs, JWTs, or database credentials.

Approval gate: shadow reads match legacy responses for representative facilities and events.

### Phase 4 — enforce runtime RLS

1. Deploy a no-traffic Cloud Run revision using the dedicated `stadium_api` credential.
2. Wrap each authenticated request's database work in one transaction and set only server-validated transaction-local scope values.
3. Apply RLS policies first to the new hierarchy, then to event execution, issues, checklists, inventory, counts, transfers, and other pilot-critical tables.
4. Test organization, facility, zone, and no-scope identities against SELECT/INSERT/UPDATE/DELETE.
5. Shift traffic gradually while monitoring RLS denials, latency, connection usage, and transaction duration.

Approval gate: no cross-scope reads or writes in automated tests; no production request uses the migration-owner credential.

### Phase 5 — cutover and contract

1. Make `Facility`/`FacilityZone`/`Outlet` the canonical API vocabulary.
2. Stop legacy writes and verify a full event setup-to-closeout cycle.
3. Rename or remove legacy `venueId`, `stadiumZone`, and `FnbOperationUnit` structures only in a later release after rollback retention expires.
4. Archive mapping/reconciliation tables after audit retention requirements are satisfied.

Approval gate: two successful controlled events and signed data reconciliation before destructive cleanup.

## Required validation matrix

| Identity | Expected visibility |
|---|---|
| Organization admin with organization scope | All facilities/zones in that organization; none in another organization. |
| Facility admin with facility scope | All zones/outlets in one facility; none in sibling facilities. |
| Zone manager with zone scope | Only assigned zone and its sub-venues/outlets/terminals. |
| Revoked membership | No tenant rows. |
| Valid user with no active scope | No tenant rows. |
| Spoofed `x-facility-id` or `x-zone-id` | Request rejected before scope settings are installed. |
| Cross-tenant object ID on update/delete | Zero rows affected or authorization error; target remains unchanged. |
| Insert carrying another facility/zone | Rejected by `WITH CHECK`. |
| Pooled connection reused after request | Previous request scope is absent. |

## Rollback strategy

- Phases 1–4 are additive and preserve legacy IDs/data.
- Before traffic shift, rollback is the prior Cloud Run revision and prior runtime secret.
- After traffic shift, stop writes, return traffic to the legacy revision, and replay only audited dual-written records if needed.
- Do not drop hierarchy tables during incident response; retain them for reconciliation.
- Destructive contract migrations receive their own backup and approval window and are never bundled with RLS activation.

## Commands for the approved implementation window

Run these only against a disposable/local database first, then the production-shaped staging clone:

```powershell
npm run api:prisma:generate
npm run api:prisma:migrate:status
npm --prefix packages/api test
npm run typecheck
npm run api:prisma:migrate:deploy
```

Before production, also run the Supabase security/performance advisors available for the project and inspect `EXPLAIN (ANALYZE, BUFFERS)` for facility- and zone-filtered hot queries. Exact production migration commands are intentionally not executed by this planning task.
