# PostgreSQL RLS cutover runbook

This is the operational path from **application-layer tenant isolation** (already live) to a **NOBYPASSRLS runtime role** with forced policies.

Do **not** run the full policy set in production until every checklist item below is green.

## Current state (2026-08-16)

| Control | Status |
|---------|--------|
| Prisma tenant extension (AND venueId / facilityId) | Live |
| AuthGuard binds live profile only | Live |
| Request tenant context carries userId / organizationId / facilityId / venueId | Live |
| `withTenantTransaction` + `SET LOCAL app.*` helper | Live (opt-in per write path) |
| Separate `stadium_migrator` vs `stadium_api` DB roles | Not cut over |
| FORCE RLS on all tenant tables under `stadium_api` | Staged in `docs/stadium-hierarchy-rls.sql` |
| Negative cross-tenant integration tests on runtime role | Required before cutover |

## Phase 0 — principals (one-time, as superuser)

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
