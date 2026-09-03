# RLS cutover scripts

Operational helpers for moving the API from application-layer tenant isolation
to a **NOBYPASSRLS `stadium_api` runtime role** with forced policies. Read
`docs/rls-cutover-runbook.md` first — this directory is the executable part of it.

## Files

| File | Run as | Purpose |
|---|---|---|
| `phase0-roles.sql` | superuser (once per env) | Create `stadium_migrator` + `stadium_api` (LOGIN, NOBYPASSRLS, no DDL), grant runtime DML, and reassign ALL existing table/sequence/function ownership to `stadium_migrator` (required — see below). Idempotent. |
| `verify-tenant-isolation.sh` | anyone with both URLs | Phase-4 gate: seed two tenants, prove isolation **as `stadium_api`**, clean up. Exits non-zero on any failure. |

The `app_private.*` helpers and the RLS **policies** themselves are already in
the migration history (`20260903120000`, `20260903130000`) — coverage is 88/88
venue-scoped tenant tables. The auth bootstrap SECURITY DEFINER functions are in
`20260903140000` and already wired into `auth.guard.ts` — unconditionally, not
behind a cutover-only branch. Nothing here creates policies.

## Ordered procedure

1. **Provision roles** (superuser, once):
   ```bash
   psql "$DATABASE_DIRECT_URL" \
     -v db_name="$(psql "$DATABASE_DIRECT_URL" -tAc 'select current_database()')" \
     -v stadium_api_password="'<STRONG-SECRET>'" \
     -f scripts/rls-cutover/phase0-roles.sql
   ```
   This reassigns ownership of every existing table/sequence/`app_private`
   function to `stadium_migrator`. Not optional: the auth-bootstrap functions
   (`app_private.auth_lookup_session`/`auth_lookup_profiles`) rely on
   PostgreSQL's owner-exemption from (non-`FORCE`) RLS, which only applies once
   `stadium_migrator` actually owns `Session`/`User`/`Profile`/`Venue`. Verified
   locally: skipping this step makes every authenticated request fail with
   `permission denied for table X`.
2. **Confirm migrations are current** on the target DB (the policies and the
   auth-bootstrap functions must exist):
   ```bash
   npm run prisma:migrate:status -w @venue-wrangler/api   # against the direct URL
   ```
3. **Land the remaining code prerequisite** (see "Code work still required"
   below) — universal GUC binding needs to cover the rest of the app before the
   role switch, or those routes fail closed on legitimate traffic. The auth
   bootstrap deadlock (item that used to block 100% of traffic) is already
   fixed and merged.
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

## Code work status

### Done (this session, verified against a real NOBYPASSRLS role + the full app test suite)

- **Auth bootstrap deadlock — fixed.** `AuthGuard`'s Session/Profile/Venue
  lookups (which run before any tenant context exists) now route through the
  narrow `SECURITY DEFINER` functions in `20260903140000_auth_bootstrap_security_definer`,
  unconditionally. Without this, every authenticated request would 401 under
  `stadium_api` — `Session`/`User` carry RLS with zero policies (global, not
  tenant-owned), and `Profile`'s/`Venue`'s own policies need the very venueId
  this lookup exists to determine.
- **Workforce join-request bootstrap deadlock — fixed.** Same class of
  problem, different flow: `approve_join_request` updates the REQUESTER's
  `Profile` row from `venueId = NULL` to the target venue — exactly the row
  shape `profile_scope`'s policy can never match, regardless of who's
  calling, since it evaluates against the row's CURRENT (null) venueId.
  `request_join_workplace` / `approve_join_request` / `reject_join_request` /
  `cancel_join_request` (`20260614000000_workforce_signup`,
  `20260804150000_harden_workforce_join_membership`) already contained solid,
  narrow, already-tested authorization logic (advisory locks, explicit
  actor/role checks, `FOR UPDATE` locking) with a fixed, non-caller-controlled
  `search_path` — migration `20260903150000_workforce_join_bootstrap_security_definer`
  adds `SECURITY DEFINER` to all four (no logic changes). Verified end-to-end
  on a fresh cluster: submit → approve (Profile flips from `venueId = NULL` to
  the target venue, `membershipStatus = active`) → the standard
  already-approved/wrong-actor guards still fire correctly — all with zero
  GUCs bound, while direct table reads on `WorkplaceJoinRequest`/`Profile`
  stay fail-closed.
- **Universal GUC binding — mechanism built and rolled out to 18 of 35
  controllers, including a full sweep for unbound nested transactions.**
  `TenantRequestTransactionInterceptor`
  (`packages/api/src/prisma/tenant-request-transaction.interceptor.ts`) opens
  one GUC-bound transaction per request, and the tenant-isolation extension
  redirects every `this.prisma.<model>.<op>()` call anywhere downstream onto
  it — zero call-site changes required in controllers/services. Apply it with
  `@UseInterceptors(TenantRequestTransactionInterceptor)` per controller.
  Applied to: `guests`, `floor`, `insights`, `payroll`, `integrations`,
  `notifications/push`, `stadium` (concourse-inventory, event-menu, stadium,
  suite-hospitality, temp-staffing, union-compliance, stadium-realtime),
  `staff`, `reservations`, `crm`, `staff-requests`, `time-clock`.

  **Critical caveat that was NOT obvious from applying the decorator alone**,
  discovered by auditing (not assuming) every wrapped controller for its own
  explicit `$transaction()` calls: the interceptor only redirects direct model
  calls (`this.prisma.model.op()`); an explicit callback-form
  `this.prisma.$transaction(async (tx) => {...})` opens its OWN separate
  transaction on another connection and is NOT covered by the outer wrap —
  same as `withTenantTransaction`'s own doc already said, but easy to miss
  when a controller carries the interceptor and looks "done." Found and fixed
  **17 such unbound nested transactions across 6 controllers**
  (`guests`, `staff` ×3, `notifications/push`, `crm` ×2, `reservations` ×1,
  `stadium` ×9) by converting each to `withTenantTransaction(this.prisma, fn,
  { venueId })`, preserving every existing lock/logic/atomicity semantic —
  zero behavior changes beyond adding GUC binding. The (safe) ARRAY form,
  `this.prisma.$transaction([queryA, queryB])`, is unaffected — its members
  are individually redirected by the extension since each is already a
  constructed `PrismaPromise` before `$transaction([...])` sees it (see the
  interceptor's own doc); left as-is in `guests`/`reservations`/`crm`.

  **One remaining, explicitly documented gap**: `reservations.controller.ts`'s
  `ingest` route (a `@Public()` reservation-sync webhook) has 8 more
  standalone/independently-committed `reservationSyncEvent` writes outside its
  main transaction, by deliberate design (idempotency durability — a claim row
  must survive even if later processing rolls back). Only the core
  Reservation-writing transaction was converted; the rest still need the same
  treatment before cutover — see the `TODO(RLS cutover...)` comment at that
  call site.

  Two routes need `@SkipTenantTransaction()` (they await a blocking Expo push
  send): `staff-requests`'s `createStaffRequest`/`reviewStaffRequest` — their
  own writes were the bare/absent-transaction case above. `crm`'s `emailBeo`
  is skipped similarly (awaits `EmailService.sendOrThrow`).
  `stadium-realtime`'s `@Sse` streaming route is explicitly skipped too — a
  long-lived response must never carry this interceptor, since `next.handle()`
  won't resolve until the client disconnects, holding the transaction open
  indefinitely; see the interceptor's own doc for this whole category.

  Proven end-to-end (not just typechecked) via
  `guests-tenant-request-transaction.integration.spec.ts` and
  `staff-requests-tenant-transaction.integration.spec.ts` — full suite: 910
  unit + 26 integration, all green, re-run after every change.

### Still required before step 5 (owner review — apply module by module, gated by the test suite + the isolation gate)

- **Roll `TenantRequestTransactionInterceptor` out to the remaining
  controllers**, auditing each for BOTH external calls (per above) AND
  explicit nested `$transaction()` calls needing `withTenantTransaction`
  (the 17-site finding above means "no external call" is necessary but not
  sufficient — check for unbound nested transactions regardless). Track
  progress against `VENUE_SCOPED_MODELS` / `FACILITY_SCOPED_MODELS` in
  `packages/api/src/prisma/tenant-scope.ts`. Not yet done, and why: `chat`
  (S3), `documents` (S3), `bar-inventory` (AI parser), `app` / `app-staff`
  (bootstrap flows + AI staff-import parser — handle alongside the carve-out
  work below, not separately), `pos` (external POS + mostly `@Public()`
  webhooks — lower value), `scheduling` (AI scheduler), `operations/wrangler`
  (AI), `billing` / `app-billing` (Stripe), `auth` / `enterprise-sso*` (auth
  flows, mostly no tenant context bound anyway), `workforce` (join-request
  bootstrap is now fixed at the SQL-function layer above, but the controller
  itself still needs the interceptor + its OTHER routes audited), `support`
  (single `@Public()` route, not worth it), `health` (no meaningful DB
  access). For each: confirm no slow external call (AI, S3, Stripe, outbound
  webhook, **or a long-lived `@Sse`/streaming response**) sits in the request
  path — if one does, either `@SkipTenantTransaction()` that specific route
  (and check whether its own writes need converting to
  `withTenantTransaction`, the way `staff-requests` did) or leave the
  controller for later. Also grep the file for `this.prisma.\$transaction(`
  regardless — every unbound callback-form hit found so far was in a
  controller with NO external-call concern at all. Verify each addition with
  `npm run lint`, the full `npx vitest run` +
  `npx vitest run --config vitest.integration.config.ts` suites, and — for a
  meaningful slice — a real cross-tenant integration test through the actual
  HTTP pipeline (see `guests-tenant-request-transaction.integration.spec.ts`
  for the pattern).
- **Finish `reservations.controller.ts`'s `ingest` webhook** — the 8 remaining
  standalone/independently-committed writes noted above.
- **Bootstrap / pre-membership carve-outs beyond auth + workforce join.**
  `app_private.venue_matches()` denies a user with no active `Profile` at the
  venue, so flows that must run before membership exists need their own narrow
  `SECURITY DEFINER` function (never BYPASSRLS) — the auth and
  workforce-join fixes above are the template (find or add existing,
  well-tested, narrow SQL functions and add `SECURITY DEFINER`; don't invent
  new business logic in SQL). Remaining, in `app.controller.ts` /
  `app-staff.controller.ts` — deliberately NOT rushed this session, unlike
  the two fixes above, because they are materially harder and higher-stakes:
  - **`registerVenue`** — creates a brand-new Organization/Venue/Subscription
    for a user with no prior membership anywhere. Uses `runWithoutTenant(...)`
    for the app-layer ALS today, but its `$transaction` binds no GUCs; under
    RLS this is a genuine "create the very first row a brand-new tenant owns"
    case with no existing SQL function to extend (unlike workforce-join) — a
    new `SECURITY DEFINER` function needs careful design and review before
    being written, not a mechanical port. Subscription bootstrap happens
    inside this same flow, not separately.
  - **Invite redemption** (`joinByCode` / `redeemInvite` / `redeemMyInvite` /
    `redeemInviteForUser`, converging on the private `redeemInviteForUser`) —
    turns out NOT to be a simple insert: the user already has a Profile row
    (created earlier, `venueId = NULL`) and redemption UPDATEs it, hitting the
    exact same "row's current venueId is NULL, policy never matches" shape as
    the workforce-join fix. No existing SQL function to extend here either
    (the logic lives entirely in TypeScript) — writing a new one requires
    carefully replicating the security-critical invariants (email match for
    targeted invites, single-use claim via `updateMany({ usedBy: null })`,
    already-has-a-venue short-circuit) without duplicating the cosmetic parts
    (`syncTeamMemberCount`) that can stay in TypeScript. A subtly wrong
    `WITH CHECK`/function here is a privilege-escalation risk, not just a
    functional bug — do this with the same rigor as the two fixes above (a
    real end-to-end proof against a fresh cluster with zero GUCs, not just a
    typecheck), and get a second pair of eyes on the function body before
    merging.
