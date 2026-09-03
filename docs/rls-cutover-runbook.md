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
| Migration chain applies clean to a fresh DB | **Yes** — fixed 2026-09-03; all 74 migration dirs apply end-to-end |
| stadium_api RLS **policy** coverage of tenant tables | **88 / 88** — completed by `20260903130000_complete_tenant_rls_policy_coverage` (was 24 / 88) |
| Auth bootstrap (Session/Profile/Venue lookups before any tenant context exists) | **Fixed** — `20260903140000_auth_bootstrap_security_definer` + `auth.guard.ts` now route through narrow SECURITY DEFINER RPCs. Without this, EVERY authenticated request 401'd under stadium_api (Session/User carry RLS with zero policies — see below). |
| Workforce join-request bootstrap (approve_join_request updates a `venueId = NULL` Profile row) | **Fixed** — `20260903150000_workforce_join_bootstrap_security_definer` adds `SECURITY DEFINER` to the 4 existing, already-tested `request_join_workplace`/`approve_join_request`/`reject_join_request`/`cancel_join_request` functions (no logic changes). Verified end-to-end: submit → approve → Profile flips from NULL to the target venue, with zero GUCs bound. |
| Universal GUC binding for ordinary (non-explicitly-transactional) reads/writes | **Mechanism live, rolled out to 18 of 35 controllers** — see `scripts/rls-cutover/README.md` for the full list and reasoning. `TenantRequestTransactionInterceptor` (prisma/tenant-request-transaction.interceptor.ts) wraps a request in one GUC-bound transaction and the tenant-isolation extension redirects every model call onto it — zero call-site changes. Deliberately NOT global — see the interceptor's own doc for why (holding a pool connection during a slow AI/S3/Stripe call, or a long-lived `@Sse` stream). |
| Nested `$transaction()` calls inside interceptor-wrapped controllers | **Audited and fixed for all 18 wrapped controllers** — an explicit callback-form `$transaction()` is NOT redirected by the outer interceptor (only direct model calls are). Found and fixed 17 unbound instances across 6 controllers (guests, staff ×3, push, crm ×2, reservations ×1, stadium ×9) via `withTenantTransaction`. One documented remaining gap: `reservations.controller.ts`'s `ingest` webhook has 8 more standalone writes by deliberate independent-commit design — see the `TODO(RLS cutover...)` comment there. |
| Isolation proven under a live `NOBYPASSRLS` role (local PG 18) | **Yes**, at three layers: raw SQL (`scripts/rls-cutover/verify-tenant-isolation.sh`), the Prisma extension directly (`tenant-isolation.integration.spec.ts`), and the full HTTP pipeline through real controllers (`guests-tenant-request-transaction.integration.spec.ts`, `staff-requests-tenant-transaction.integration.spec.ts`). |
| Separate `stadium_migrator` vs `stadium_api` DB roles in prod | **Not cut over** (Phase 0 — superuser, prod). `phase0-roles.sql` now also reassigns ALL existing table/sequence/function ownership to `stadium_migrator` — required for the auth-bootstrap SECURITY DEFINER functions to work (see below), not optional. |
| Bootstrap carve-outs beyond auth + workforce join (Invite redemption, `registerVenue`/Subscription bootstrap) | **Still open, deliberately not rushed** — both are materially harder than the two fixes above: no existing SQL function to extend (unlike workforce-join), and Invite redemption is an UPDATE on a pre-existing `venueId = NULL` Profile row (same shape as the workforce-join bug) requiring careful replication of security-critical invariants, not a mechanical port. See `scripts/rls-cutover/README.md` for the detailed design notes. PushToken registration turned out NOT to be a bootstrap case at all (it requires an existing venue Profile) — it just needed the same nested-transaction GUC-binding fix as everything else, now done. |
| `DATABASE_URL` switched to `stadium_api` in prod | **Not done** (Phase 0/rollout, prod) |
| Prod migration parity confirmed | **Unconfirmed** — run `prisma migrate status` against prod (owner) |
| Full test suite against local PG 18 | **910 unit + 26 integration, all green** — re-verified after every change in this session |

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

### Follow-up work (same day): universal GUC binding + the auth bootstrap deadlock

Two more things were found and fixed by continuing to drive this against a real
NOBYPASSRLS role and the real app (not just SQL) — `npm ci` + a local PostgreSQL 18
cluster made it possible to run the ACTUAL NestJS app and its full 910-unit /
24-integration test suite, not just raw SQL, for this pass.

**1. The auth bootstrap deadlock (severe — would have broken 100% of authenticated
traffic).** `AuthGuard`'s very first two queries — look up the `Session` row by id,
then the requester's `Profile` (which is what DISCOVERS the venueId) — run before any
tenant context exists, so no `app.venue_id` GUC can be bound yet. `Session` and `User`
carry RLS (enabled blanket by `20260805120000`) with **zero** stadium_api policies
(they're global, not tenant-owned — see `VENUE_SCOPED_MODELS` in `tenant-scope.ts`),
and under PostgreSQL, RLS enabled + no matching policy denies ALL rows to a
non-bypass role. `Profile`'s own policy also needs `app.venue_id` already bound —
exactly what this lookup exists to determine. Verified directly: as `stadium_api`
with zero GUCs, `SELECT * FROM "Session"` returned 0 rows for an existing session.
This is much bigger than the narrower bootstrap items already listed above — it's
not one onboarding flow, it's every request.

Fixed with migration `20260903140000_auth_bootstrap_security_definer`: two narrow,
parameterized `SECURITY DEFINER` functions (`app_private.auth_lookup_session`,
`app_private.auth_lookup_profiles`, the latter also joining `Venue` since AuthGuard's
`profileSelect` needs it and `Venue` has the identical chicken-and-egg problem) that
run with their OWNER's privileges. Since `Session`/`User`/`Profile`/`Venue` carry
`ENABLE` (not `FORCE`) RLS, PostgreSQL already exempts the table OWNER — so once
`stadium_migrator` owns these tables (see the `phase0-roles.sql` fix below), the
functions read correctly with **no GUC required** and **no `BYPASSRLS` on any LOGIN
role**. `auth.guard.ts` now calls these unconditionally (one code path, not a
cutover-only branch — SECURITY DEFINER works identically under today's bypass role).
Verified end-to-end on a fully fresh cluster: migrations → `phase0-roles.sql` →
seed → bootstrap RPCs return correct data with zero GUCs → direct table reads on
the same tables stay fail-closed → once GUCs are bound, ordinary policy isolation
still holds.

Two bugs surfaced and fixed while proving this on a *fresh* database (both were
invisible on the hand-patched DB used earlier the same day):
- **`phase0-roles.sql` never reassigned table/function ownership to
  `stadium_migrator`.** Real deploys' tables are owned by whatever the migration
  credential is today (typically `postgres`), not `stadium_migrator` — the role
  the script creates fresh. Without an explicit reassignment, the owner-exemption
  above doesn't apply and the bootstrap functions 403 with `permission denied for
  table X`. Fixed: the script now reassigns every table/sequence/function in
  `public`/`app_private` to `stadium_migrator`, idempotently.
- **`stadium_migrator` was never granted `USAGE` on the `app_private` schema.**
  That schema was explicitly locked to `PUBLIC` (`REVOKE ALL … FROM PUBLIC`) when
  created, before `stadium_migrator` existed. A `SECURITY DEFINER` function calling
  ANOTHER function in the same schema (e.g. `venue_matches()` calling
  `current_venue_id()`) still needs schema-level `USAGE` for whichever role it
  executes as, regardless of ownership — this failed with `permission denied for
  schema app_private` until the grant was added.
- Also fixed, unrelated to ownership: the script's original `CREATE ROLE …
  PASSWORD :'var'` inside a `DO $$ … $$` block never worked — psql does not
  substitute `:'var'` inside a dollar-quoted body, only in ordinary top-level SQL.
  Rewritten using the standard `\gexec` idiom.

**2. `setupTestDb()` (used by every `*.integration.spec.ts`) needed the same
functions.** It runs `prisma db push` (schema sync only) — never the raw SQL in
`prisma/migrations/*.sql` — so once `AuthGuard` started calling the bootstrap RPCs
unconditionally, every db-push test database 500'd on its first authenticated
request. Fixed by having `setupTestDb()` also create the two functions after
`db push` (see its own doc comment on why the migration file isn't executed
directly). This is genuinely load-bearing for CI, not cosmetic — confirmed by
watching `app.e2e.integration.spec.ts` go from 3 failures to 0 after the fix.

**3. Universal GUC binding**, i.e. making item 1 above ("Prisma tenant extension")
actually enforce at the database layer for ordinary reads/writes, not just the
opt-in `withTenantTransaction` write paths. Mechanism: `TenantRequestTransactionInterceptor`
opens one transaction per request with GUCs bound via `applyTenantSessionSettings`,
and the tenant-isolation Prisma extension (`tenant-isolation.extension.ts`)
redirects every `this.prisma.<model>.<op>()` call anywhere downstream onto that
SAME transaction — no call-site changes anywhere in the app. The redirect target
must be a transaction from the **unextended** base client
(`PrismaService.runRawTenantTransaction`, exposed through a Proxy special-case) —
redirecting to an already-extended transaction would re-enter the same extension
hook on itself and recurse forever.

Deliberately **not** global (`APP_INTERCEPTOR`): it holds one pool connection open
for the whole request, and a route with a slow external call mid-handler (AI, S3,
Stripe, an outbound webhook) would hold that connection idle for the call's
duration against a production pool of 3 — see the interceptor's own doc for the
full reasoning and the `@SkipTenantTransaction()` escape hatch. Applied to
`GuestsController` as the first real-controller slice (no external calls in its
request path); rollout to the rest of `VENUE_SCOPED_MODELS`/`FACILITY_SCOPED_MODELS`
owners is the next chunk of this work — see `scripts/rls-cutover/README.md`.

Proven at three independent layers, not just one: `scripts/rls-cutover/verify-tenant-isolation.sh`
(raw SQL under a real `stadium_api` role), `tenant-isolation.integration.spec.ts`
(the extension directly), and the new `guests-tenant-request-transaction.integration.spec.ts`
(real HTTP → real `AuthGuard` → real interceptor → real `GuestsController`, two
seeded tenants, cross-tenant read/write assertions) — including
`GuestsController.listGuests`'s array-form `$transaction([...])` batch, which is the
one case flagged as a caveat in the interceptor's own doc comment (array-form
members are redirected individually rather than batched, since each is already a
constructed `PrismaPromise` by the time `$transaction([...])` sees them — fine for
this read-only batch, worth checking before reusing on a multi-write batch).

**Also fixed in passing, unrelated to RLS:** `npm run lint -w @venue-wrangler/api`
(the exact CI Typecheck step) was broken on `main` at the start of this session —
`async-write/worker.ts` called `enterTenant(context, fn)` (a void, single-argument,
guard/interceptor-only binder) as if it were `runWithTenant(context, fn)` (runs `fn`
and returns its result — the correct one for a background worker), and
`union-compliance.service.ts` called `tx.concourseOutlet`/`tx.zone`, Prisma models
that don't exist (`Outlet`/`FacilityZone` after the schema rename, before this file
was written). Another session fixed these independently mid-session; see git history
around `6f3d5c6`/`8787b3a`/`c94cf64`/`fca2a05`.

Full regression gate for everything in this section: `npm run lint -w @venue-wrangler/api`
(0 errors), `npx vitest run` (910 passed, 2 skipped), and
`npx vitest run --config vitest.integration.config.ts` (24 passed) — all green
against a local PostgreSQL 18 instance, re-run after every change.

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
