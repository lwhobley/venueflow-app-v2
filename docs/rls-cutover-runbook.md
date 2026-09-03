# PostgreSQL RLS cutover runbook

This is the operational path from **application-layer tenant isolation** (already live) to a **NOBYPASSRLS runtime role** with forced policies.

Do **not** run the full policy set in production until every checklist item below is green.

## Current state (2026-09-03)

| Control | Status |
|---------|--------|
| Prisma tenant extension (AND venueId / facilityId) | Live |
| AuthGuard binds live profile only | Live |
| Request tenant context carries userId / organizationId / facilityId / venueId | Live |
| `withTenantTransaction` + `SET LOCAL app.*` helper | Live (opt-in per write path) |
| Write paths binding GUCs | union punches, inventory transfer complete, temp roster import, suite BEO create/status/delivery |
| Phase-1 helpers SQL (`app_private.*`) | **Live** in migration `20260903120000_upgrade_app_private_helpers_and_tenant_rls` |
| `app_private` helper functions verified present | current_user_id/org/facility/venue/zone, scope_matches, venue_matches, can_manage_memberships, can_operate_scope |
| Migration chain applies clean to a fresh DB | **Yes** — fixed 2026-09-03 (see below); all 72 migration dirs apply end-to-end |
| stadium_api RLS **policy** coverage of tenant tables | **88 / 88** — completed by `20260903130000_complete_tenant_rls_policy_coverage` (was 24 / 88) |
| Isolation proven under a live `NOBYPASSRLS` role (local PG 18) | **Yes** — read isolation, fail-closed default, cross-tenant write rejection (see proof below) |
| Separate `stadium_migrator` vs `stadium_api` DB roles in prod | **Not cut over** (Phase 0 — superuser, prod) |
| Universal GUC binding across ALL app read/write paths | **Not done** — still opt-in; required before the role switch |
| Bootstrap carve-outs (Invite, WorkplaceJoinRequest, Subscription, PushToken) | **Open** — need reviewed SECURITY DEFINER path (venue_matches denies pre-membership) |
| `DATABASE_URL` switched to `stadium_api` in prod | **Not done** (Phase 0/rollout, prod) |
| Prod migration parity confirmed | **Unconfirmed** — run `prisma migrate status` against prod (owner) |

### What changed on 2026-09-03 (this session)

Two blocking defects were found by applying the real migration chain to a throwaway
PostgreSQL 18 cluster, and fixed:

1. **`20260903120000` was not deployable to any clean database.** It ran
   `ALTER TABLE`/`CREATE POLICY` against three relations that do not exist at HEAD:
   `"Zone"` (renamed to `"FacilityZone"` in `20260812120000`), `"ConcourseOutlet"`
   (the table is `"Outlet"`, already policied by `20260812120000`), and `"Table"`
   (no such model; the floor domain uses `TableState`/`TableAssignment`/…). Each
   errored with `relation "…" does not exist`, aborting the whole migration — so the
   migration had **never successfully applied to a clean DB**. Fixed by guarding each
   stale block on the legacy table's existence (no-op on current schema; the real
   tables keep the policies `20260812120000` already gives them). *Checksum note:* if
   any environment somehow recorded this migration as applied (only possible with a
   drifted legacy `Zone` table), `prisma migrate deploy` will flag the edit — reconcile
   with `prisma migrate resolve` there.

2. **64 of 88 venue-scoped tenant tables had RLS enabled but no `stadium_api`
   policy** → they would deny ALL access under the cutover role (fail-closed, ~73%
   of the tenant data surface). New migration `20260903130000_complete_tenant_rls_policy_coverage`
   adds a uniform `venue_matches("venueId")` policy to each, bringing coverage to 88/88.

### Local runtime proof (PostgreSQL 18, role `stadium_api` = `NOBYPASSRLS`)

Seeded two isolated tenants (venue A / venue B, distinct users + profiles) and ran, as
`stadium_api` with `set_config('app.user_id'/'app.venue_id', …)`:

| Assertion | Result |
|---|---|
| Control (bypass role) sees both tenants' `Reservation`/`AuditLog` rows | ✅ both |
| stadium_api as user A / venue A → sees only venue A rows | ✅ |
| stadium_api as user B / venue B → sees only venue B rows | ✅ |
| stadium_api with NO tenant GUCs → 0 rows (fail-closed) | ✅ |
| user A explicitly querying venue B rows → 0 rows | ✅ |
| user A INSERT into venue B → rejected by `WITH CHECK` | ✅ `violates row-level security policy` |
| user A INSERT into own venue A → succeeds | ✅ |
| Same assertions on a newly-covered table (`AuditLog`) | ✅ |

This proves the policy mechanism; it is **not** a substitute for the prod role switch,
universal GUC binding, or a load/queue/realtime runtime proof.

## Executable helpers

The steps below are scripted in `scripts/rls-cutover/` (see its README for the
ordered procedure):

- `scripts/rls-cutover/phase0-roles.sql` — Phase 0 role provisioning (idempotent).
- `scripts/rls-cutover/verify-tenant-isolation.sh` — the Phase 4 gate as an
  executable; seeds two tenants, asserts isolation as `stadium_api`, exits
  non-zero on any failure. Proven to PASS on a NOBYPASSRLS role and FAIL on a
  bypass role.

## Phase 0 — principals (one-time, as superuser)

Run `scripts/rls-cutover/phase0-roles.sql` (preferred — idempotent + posture
check), or equivalently:

```sql
-- Migrator: schema owner, used only by release jobs
CREATE ROLE stadium_migrator NOINHERIT;
-- API runtime: no bypass, no DDL
CREATE ROLE stadium_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE <db> TO stadium_api;
GRANT USAGE ON SCHEMA public TO stadium_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO stadium_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stadium_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stadium_api;
```

Migrations continue to use a migrator credential via a **Cloud Run Job / CI step**, never the API image.

## Phase 1 — helper functions

Apply the `app_private` helpers from `docs/stadium-hierarchy-rls.sql` (current_user_id, current_organization_id, current_facility_id, scope_matches).

## Phase 2 — wire write paths

Prefer:

```ts
import { withTenantTransaction } from '../prisma/tenant-transaction';

return withTenantTransaction(this.prisma, async (tx) => {
  // domain writes using tx
});
```

for high-risk modules (time clock, inventory, closeout, punches, SSO mapping).

AuthGuard already populates `enterTenant({ venueId, facilityId, organizationId, userId })`.

## Phase 3 — policies

1. Enable + FORCE RLS table by table, starting with hierarchy tables in the SQL artifact.
2. Extend the same pattern to every model in `VENUE_SCOPED_MODELS` and `FACILITY_SCOPED_MODELS`.
3. Keep `anon` / `authenticated` revoked (API-only data path).

## Phase 4 — verification gates

- [ ] Integration tests connect as `stadium_api` (not migrator).
- [ ] Cross-organization read returns empty / forbidden.
- [ ] Cross-facility write is rejected by policy even if application filter is removed in a deliberate fault-injection test.
- [ ] Public SSO bootstrap uses a narrow SECURITY DEFINER path, not BYPASSRLS.
- [ ] Pooler does not retain `app.*` settings across clients (only SET LOCAL inside transactions).

## Rollback

1. Point Cloud Run `DATABASE_URL` back to the previous role.
2. Do **not** set `TENANT_ISOLATION_ENFORCED=false` in production (startup will fail).
3. Roll the API revision if needed; Prisma extension isolation remains the backstop.
