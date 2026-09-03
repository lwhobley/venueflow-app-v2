# RLS cutover scripts

Operational helpers for moving the API from application-layer tenant isolation
to a **NOBYPASSRLS `stadium_api` runtime role** with forced policies. Read
`docs/rls-cutover-runbook.md` first — this directory is the executable part of it.

## Files

| File | Run as | Purpose |
|---|---|---|
| `phase0-roles.sql` | superuser (once per env) | Create `stadium_migrator` + `stadium_api` (LOGIN, NOBYPASSRLS, no DDL) and grant runtime DML. Idempotent. |
| `verify-tenant-isolation.sh` | anyone with both URLs | Phase-4 gate: seed two tenants, prove isolation **as `stadium_api`**, clean up. Exits non-zero on any failure. |

The `app_private.*` helpers and the RLS **policies** themselves are already in
the migration history (`20260903120000`, `20260903130000`) — coverage is 88/88
venue-scoped tenant tables. Nothing here creates policies.

## Ordered procedure

1. **Provision roles** (superuser, once):
   ```bash
   psql "$DATABASE_DIRECT_URL" \
     -v db_name="$(psql "$DATABASE_DIRECT_URL" -tAc 'select current_database()')" \
     -v stadium_api_password="'<STRONG-SECRET>'" \
     -f scripts/rls-cutover/phase0-roles.sql
   ```
2. **Confirm migrations are current** on the target DB (the policies must exist):
   ```bash
   npm run prisma:migrate:status -w @venue-wrangler/api   # against the direct URL
   ```
3. **Land the two code prerequisites** (see "Code work still required" below) —
   universal GUC binding and the bootstrap carve-outs. Do NOT skip; without them
   the runtime role fails closed on legitimate traffic.
4. **Run the gate** against a staging clone before touching prod:
   ```bash
   ADMIN_URL='postgresql://<superuser>@host:5432/db' \
   API_URL='postgresql://stadium_api@host:5432/db' \
   scripts/rls-cutover/verify-tenant-isolation.sh
   ```
   Require `RESULT: PASS`. (Sanity: pointing `API_URL` at a bypass role prints
   `RESULT: FAIL` — the gate is discriminating, not a rubber stamp.)
5. **Cut over**: change the API's `DATABASE_URL` to the `stadium_api` role.
   Migrations keep running under `stadium_migrator` via the CI/Cloud Run Job,
   never the API image.
6. **Rollback**: point `DATABASE_URL` back to the previous role. Do NOT set
   `TENANT_ISOLATION_ENFORCED=false` in production (startup fails by design); the
   Prisma tenant extension remains the app-layer backstop.

## Code work still required before step 5 (owner review — not auto-merged)

These change request/DB behavior and must be reviewed + tested against a DB, not
merged blind:

- **Universal GUC binding.** Today `withTenantTransaction` (`SET LOCAL app.*` via
  `set_config(..., true)`) is applied opt-in per write path. Under the cutover
  role, **every** query must run inside a transaction carrying the `app.*` GUCs,
  or RLS returns zero rows. Recommended path (matches the current architecture
  and Supabase's session pooler + small pool): expand `withTenantTransaction`
  coverage module-by-module — reads included — gated each step by the harness
  above, rather than a big-bang per-query transaction wrapper (which risks pool
  exhaustion at `DATABASE_POOL_SIZE=3`). Track remaining modules against
  `VENUE_SCOPED_MODELS` / `FACILITY_SCOPED_MODELS` in
  `packages/api/src/prisma/tenant-scope.ts`.
- **Bootstrap / pre-membership carve-outs.** `app_private.venue_matches()`
  denies a user with no active `Profile` at the venue, so flows that must run
  before membership exists need a narrow `SECURITY DEFINER` function (never
  BYPASSRLS). Known cases: `Invite` acceptance, `WorkplaceJoinRequest` creation,
  `Subscription` bootstrap, `PushToken` registration. Audit for others by
  finding any read/write that must succeed before the requester has a venue
  Profile (AuthGuard only binds tenant context when an active venued Profile
  exists).
