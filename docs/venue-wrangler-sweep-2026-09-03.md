# Venue Wrangler — Full Repository Sweep

**Sweep date:** 2026-09-03
**Working tree:** branch `main`, HEAD `8ea6678`, clean
**Posture:** Static, evidence-based, audit-only. No code was modified, no production service, database, or secret was accessed.
**Method:** Recursive inspection of source, config, migrations, CI, and docs; targeted trace of the security-critical paths; cross-check against the prior principal review (`docs/venue-wrangler-enterprise-full-review.md`, 2026-08-13, which rendered a NO-GO).

> **Scope caveat (read first).** This is a code-and-config audit. Runtime-only facts — the production PostgreSQL role's `BYPASSRLS` bit, live RabbitMQ topology, Cloud Run env, load behavior, and whether the deployed image matches this tree — cannot be confirmed from the repository and are marked **Needs Verification** with the exact check required. Where I write "Verified," it means verified *in code*, not in production.

---

## 1. Overall Verdict

| Dimension | Rating |
|---|---|
| **Production readiness** | **CONDITIONALLY READY** |
| **Security posture** | **Medium** (was Critical in Aug; most P0s remediated in code) |
| **Functional completeness** | **~90%** — the feature surface is broad and wired; the residual 10% is runtime-verification and the RLS role cutover, not missing code |
| **RLS / tenant isolation** | **Partially Working** — app-layer isolation is live and strong; database FORCE-RLS under a non-bypass role is staged but **not cut over** |
| **API reliability / efficiency** | **Likely Working** — durable idempotency, advisory locks, timeouts, DLQ present |
| **AI feature readiness** | **Verified (code)** — server-only key, per-venue budget, token pre-counting, tenant-scoped |
| **Test coverage confidence** | **Medium** — 89 spec files, 24 with cross-tenant/forbidden assertions, ~54% statement coverage (per prior run); coverage gate in CI |

**Findings by severity:** Critical 0 · High 3 · Medium 6 · Low 5 · Informational 4 · Needs Verification 7

### Top 10 release risks
1. **RLS role cutover incomplete** — runtime role still bypasses RLS; tenant isolation depends on the app-layer Prisma extension + manual filters (defense-in-depth DB policies staged, not enforced). *(High / Needs Verification)*
2. **Deployed-image drift** — prior review found production several migrations behind this tree (`EventCloseout`, `EventPlanSnapshot` absent in prod). Confirm prod is redeployed from HEAD. *(Needs Verification)*
3. **Live "realtime" is polling + in-process gateway** — verify the suite-hospitality WebSocket gateway crosses Cloud Run replicas or is documented as single-replica. *(Needs Verification)*
4. **Transitive high-severity npm advisories** in the Expo/Metro build chain (dev/build only; documented exceptions). *(Medium)*
5. **GUC binding is opt-in per write path** — `withTenantTransaction` covers only a subset of writes; universal binding is required before the NOBYPASSRLS cutover. *(Medium)*
6. **Enterprise SSO group→role mapping** can reach high roles; confirm who may configure mappings and that merges require verified email (verified-email gate is present). *(Medium / Needs Verification)*
7. **Queue producer/worker topology parity** — both must call the shared `assertQueueTopology`; verify at boot on prod. *(Needs Verification)*
8. **Coverage depth** — ~54% statements; branch coverage lower. Critical financial/closeout ledgers need targeted tests. *(Medium)*
9. **Load/queue behavior unproven** — no load harness; sub-50ms write target unverified. *(Needs Verification)*
10. **`as any` (57 sites)** and a handful of runtime casts in mappers — low individually, worth a typed pass. *(Low)*

**Plain-English risk:** This is a genuinely well-engineered, security-conscious codebase that has clearly been through at least one hard audit and remediated most of it. The remaining gate to a *live game-day pilot* is operational, not architectural: finish the database RLS role cutover (so isolation is enforced by Postgres, not just the app), confirm the deployed image matches this tree, and prove the queue/realtime paths at replica scale. For non-game-day / controlled use, it is in good shape.

---

## 2. Repository Map

### Architecture
```
Expo Router mobile/web client (app/, components/, lib/)
  → lib/api-client.ts + lib/railway-hooks.ts (React Query, Bearer from SecureStore, Idempotency-Key)
  → NestJS API (packages/api) — 36 controllers, global AuthGuard + ValidationPipe(whitelist,forbidNonWhitelisted)
      → AuthGuard: HS256 JWT + revocable Session row (timing-safe token-hash) → live Profile → tenant context
      → Prisma tenant-isolation extension (AND venueId/facilityId) + manual where-filters
      → PrismaService (pooled) → PostgreSQL (Supabase-hosted; Data/GraphQL API locked down, RLS enabled, privs revoked)
      → RabbitMQ high-volume write queue (durable + DLX/DLQ) → worker (advisory locks, AsyncWriteReceipt idempotency)
      → External: Gemini (AI), Stripe + RevenueCat (billing), Resend (email), AWS S3 (docs/chat images), Sentry
  → Response / AllExceptionsFilter (no stack/secret leakage) / Sentry
```

- **App routes:** 55 (`(auth)` flows, `(tabs)` main app, stadium ops, billing, chat, event command center).
- **API modules:** app, auth (+ enterprise SSO), billing, chat, crm, documents, floor, guests, insights, integrations, operations (+ wrangler engine), payroll, pos, reservations, scheduling, stadium (suites/stands/temp-staffing/union), staff, time-clock, workforce.
- **DB:** 74 ordered Prisma migrations (`20260605…init` → `20260903…upgrade_app_private_helpers_and_tenant_rls`). Multiple dedicated hardening migrations (tenant integrity guards, supabase data-API lockdown, FK indexes, AI usage RLS, secure worker credentials, immutable closeout ledger).
- **CI:** 6 workflows — `api-ci` (typecheck/lint, unit+coverage gate, **integration tests against real Postgres**, build, **RLS-coverage migration lint**, migrate-deploy, health smoke), `mobile-ci`, `codeql`, `dependency-audit`, `database-backup`, `branch-api-parity`, Cloudflare Pages deploy.
- **Docs:** unusually complete — `rls-cutover-runbook.md`, `tenant-isolation.md`, `production-operations.md`, `pilot-runbook.md`, `enterprise-sso.md`, `security-dependency-exceptions.md`, ERDs, target schemas.
- **Files skipped (and why):** `node_modules`, `package-lock.json` (648 KB generated), Prisma-generated client, i18n namespace bodies (translation strings, scanned not line-read), binary assets/screenshots/PDF, `dist`. Migration SQL sampled at the security-critical files rather than all 74 line-by-line.

---

## 3. Full Sweep Findings

| ID | Severity | Area | File / Object | Status | Finding | Evidence | Impact | Recommended Fix | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| VW-SWEEP-001 | High | RLS / Tenant | runtime DB role | Needs Verification | RLS policies + `app_private.*` helpers staged, but the runtime role likely still bypasses RLS; enforcement is app-layer. | `docs/rls-cutover-runbook.md` "stadium_api NOBYPASSRLS — Not cut over"; latest migration comment "prepares for … cutover" | If a query path ever misses a filter and the extension is bypassed, no DB backstop. | Complete Phase 0–N of the runbook: split `stadium_migrator`/`stadium_api`, FORCE RLS, run negative cross-tenant tests on the runtime role. | Yes (game-day) |
| VW-SWEEP-002 | High | Deployment | prod image | Needs Verification | Prior review found prod several migrations behind tree. | prior review §2 "Live migrations stop at 20260812233000" | New tables/logic absent in prod. | Redeploy from HEAD; assert `prisma migrate status` clean in prod. | Yes |
| VW-SWEEP-003 | High | Reliability / Realtime | `stadium/suite-hospitality.gateway.ts`, `stadium-realtime.controller.ts` | Needs Verification | Realtime historically polling + in-process EventEmitter; gateway now exists. | gateway file present; prior review §"Live WebSocket" | Cross-replica events may not fan out on Cloud Run. | Confirm a shared broker (Redis pub/sub) backs the gateway, or pin single replica + document. | Yes (if realtime is game-day-critical) |
| VW-SWEEP-004 | Medium | Tenant | `prisma/tenant-transaction.ts` | Partially Working | `SET LOCAL app.*` GUCs bound only in opt-in write paths (union punches, transfers, roster import, suite BEO). | runbook "Write paths binding GUCs" list | FORCE-RLS cutover would break unbound paths. | Bind GUCs universally (extension-level or a Nest interceptor wrapping every request in `withTenantTransaction`) before cutover. | Pre-cutover |
| VW-SWEEP-005 | Medium | Dependencies | root `package.json` lockfile | Needs Improvement | ~10 high transitive advisories in Expo/Metro/RN toolchain (build/dev only). | prior `npm audit` fail; `docs/security-dependency-exceptions.md` | Build-chain risk, not runtime. | Track upstream fixes; keep documented exceptions current; ensure they never ship to device runtime. | No |
| VW-SWEEP-006 | Medium | Auth / SSO | `auth/enterprise-sso.service.ts`, `enterprise-sso-admin.controller.ts` | Needs Verification | Verified-email gate present (`email_verified === true`); group→role mapping can reach elevated roles. | service line 174 rejects unverified email; admin controller exists | Over-broad admin could self-escalate via mapping. | Confirm only owner/platform_admin may edit mappings; add audit + a ceiling so mappings cannot grant `platform_admin`. | No |
| VW-SWEEP-007 | Medium | Testing | coverage | Needs Improvement | ~54% statements / ~45% branches (prior run). | prior review coverage table; CI coverage gate | Financial/closeout branches under-tested. | Add negative cross-tenant + ledger-conservation tests; raise branch gate. | No |
| VW-SWEEP-008 | Medium | Reliability | `async-write/queue-topology.ts`, `worker.ts` | Likely Working | Shared topology asserts durable exchange+queue with DLX/DLQ. | queue-topology lines 10–23 | Prior PRECONDITION_FAILED risk. | Verify both producer and worker call `assertQueueTopology` at boot in prod. | Pre-pilot verify |
| VW-SWEEP-009 | Medium | AI | `common/ai-json-parse.ts` | Verified (code) | Per-venue monthly budget via advisory-locked reservations + token pre-count; fails closed on metering error. | budget reservation + `countInputTokens`; env `AI_MONTHLY_VENUE_BUDGET_USD` etc. | — | None; consider per-user (not only per-venue) rate limit. | No |
| VW-SWEEP-010 | Low | Type safety | 57 `as any` in API | Needs Improvement | Runtime casts, concentrated in mappers/raw-SQL glue. | `grep "as any"` = 57 | Local unsoundness. | Type-narrow hotspots (mappers, `$queryRaw` rows). | No |
| VW-SWEEP-011 | Low | Secrets | `certs/certificate.pem` | Healthy | Committed cert is the **public** EAS Update code-signing certificate; `.gitignore` ignores `*.pem` but explicitly whitelists this one with a comment; private key excluded. | file `BEGIN CERTIFICATE`, 0 private-key blocks; `app.json` `codeSigningCertificate`; `.gitignore` `!certs/certificate.pem` | None — correct. | No action. | No |
| VW-SWEEP-012 | Low | Hygiene | repo-wide | Healthy | 0 real TODO/FIXME/HACK (7 hits are Spanish "todo" in i18n), 0 `console.log` in prod code, 0 `@ts-ignore/@ts-nocheck`, 0 `dangerouslySetInnerHTML`. | grep sweeps | — | No action. | No |
| VW-SWEEP-013 | Low | Frontend | `lib/auth-store.ts` | Verified | Tokens in `expo-secure-store` (encrypted), never AsyncStorage/localStorage. | auth-store lines 32–34 | — | No action. | No |
| VW-SWEEP-014 | Low | Config | `main.ts` CORS | Verified | Fail-closed CORS allowlist; helmet; body limits per-path; tokens never accepted from query string. | main.ts `enableCors` + `isAllowedOrigin`; auth.guard `getBearerToken` comment | — | No action. | No |
| VW-SWEEP-015 | Informational | Webhooks | `common/webhook-auth.ts`, `billing.controller.ts` | Verified | Stripe HMAC-SHA256 recompute, constant-time compare, timestamp/replay tolerance; raw body captured only for the webhook path. | webhook-auth lines 36–63; main.ts rawBody verify | — | — | No |
| VW-SWEEP-016 | Informational | Auth | `auth/auth.guard.ts` | Verified | Session-backed JWT with timing-safe token-hash; privilege claims re-read from live Profile; tenant context derived only from live membership, never from header/JWT. | auth.guard full read | — | — | No |
| VW-SWEEP-017 | Informational | DB access | migration `20260805120000_lock_down_supabase_data_api` | Verified | RLS enabled on all public tables; privileges revoked from PUBLIC/anon/authenticated — Supabase Data/GraphQL surface closed. | migration body | — | — | No |
| VW-SWEEP-018 | Informational | Stadium | `stadium/temp-staffing.service.ts` | Verified | Worker PIN/QR now PBKDF2-hashed (random salt), `randomInt` PIN, `randomBytes` QR, timing-safe compare, lookup tags. | service lines 61–70 | Resolves prior P0 #7. | — | No |

---

## 4. Functional Feature Matrix (representative)

| Feature | Roles | UI Entry | Backend/Data | Expected | Status | Evidence | Test Requirement | Priority |
|---|---|---|---|---|---|---|---|---|
| Auth / venue onboarding | all | `(auth)/*` | auth.controller, Session, Profile | Sign-in, invite accept, create/join venue | Verified (code) | 12 auth routes + auth.guard + advisory-locked register | E2E happy + expired/invalid invite | P0 |
| Tenant switching (multi-venue) | all | header `x-venue-id` | AuthGuard live-membership lookup | Only active memberships resolve | Verified (code) | guard rejects header venue without active profile | Cross-venue negative | P0 |
| Scheduling + AI scheduler | mgr/admin | `(tabs)/schedule` | scheduling-assignment, ai-scheduler | Build/publish shifts, AI suggest | Likely Working | module + AI budget guard | Conflict/overlap tests | P1 |
| Time clock / punches | staff+ | `(tabs)/clock` | time-clock, async-write queue | Clock in/out idempotent | Likely Working | Idempotency-Key + AsyncWriteReceipt + open-state unique | Redelivery/dup test | P0 |
| Bar inventory + AI parse | mgr | `(tabs)/bar-stock` | bar-inventory, parser | Movements conserve; AI parse | Likely Working | advisory lock on movement; parser budget-gated | Negative-stock conservation | P1 |
| Reservations / floor | host/mgr | `(tabs)/guests`, floor | reservations, floor.service | Holds, sync, table state | Likely Working | advisory locks on holds/sync | Double-book race | P1 |
| Chat + images (S3) | all | `(tabs)/chat`, `chat/[id]` | chat, s3-image, media-access | Tenant-scoped media | Verified (code) | media-access.service + inline-disposition fix (HEAD commit) | Cross-tenant media fetch | P1 |
| Documents (S3) | mgr | `(tabs)/documents` | documents, s3-document | Upload/download authorized | Likely Working | VenueDocument scoped model | Signed-URL TTL + authz | P1 |
| Stadium: suites/stands/BEO | ops | `stadium/*` | suite-hospitality, stand-sheet, event-menu | Game-day ops | Partially Working | GUCs bound here; realtime caveat VW-003 | Replica fan-out | P0 (pilot) |
| Temp staffing / union | ops/admin | `stadium/staff-kiosk` | temp-staffing, union-compliance | Secure PIN, punch, rules | Verified (code) | hashed creds, advisory-locked punches | Union-rule edge cases | P0 (pilot) |
| Event closeout ledger | mgr/admin | `event-closeout` | EventCloseout + immutable revision ledger | Accounting-grade | Likely Working | migration `immutable_closeout_revision_ledger` | Conservation + tamper | P0 (pilot) |
| Billing (Stripe/RevenueCat) | owner | `billing*`, `settings/billing` | billing.controller, subscription.guard | Subscribe, gate features | Verified (code) | webhook sig verify; subscription guard | Webhook replay + downgrade | P1 |
| Enterprise SSO | admin | (web) | enterprise-sso.* | OIDC login, group→role | Partially Working | verified-email gate; mapping caveat VW-006 | Escalation-ceiling test | P1 |

---

## 5. Security & RLS Matrix (summary)

| Resource | Tenant Scope | Auth | Role | RLS/Policy | Validation | Cross-Tenant Risk | Status |
|---|---|---|---|---|---|---|---|
| Venue-scoped models (65) | `venueId` | AuthGuard | per-controller | app-extension AND + staged DB policy | ValidationPipe whitelist | Low (app) / DB backstop pending | Partially Working |
| Facility-scoped models (17) | `facilityId` | AuthGuard | operator checks | staged | whitelist | Low, `null`-wildcard handled at call sites | Partially Working |
| Supabase Data/GraphQL API | n/a | closed | n/a | RLS on + privs revoked | n/a | Closed | Verified |
| S3 buckets (docs/chat) | metadata → venue | AuthGuard + media-access | mgr for docs | app | MIME/size (image-bytes/document-bytes) | Low | Likely Working |
| Stripe webhook | n/a | HMAC sig | n/a | n/a | replay window | Low | Verified |
| AI usage events | `venueId` | AuthGuard | n/a | dedicated RLS migration | budget guard | Low | Verified (code) |

**Prioritized security work:** (1) RLS role cutover (VW-001, VW-004); (2) confirm SSO mapping ceiling (VW-006); (3) keep dependency exceptions current (VW-005). No committed secrets, no client-exposed privileged keys (only `EXPO_PUBLIC_API_URL / _BILLING_ENABLED / _INTRO_ASSET_BASE`), AI/Stripe/AWS keys all server-side.

---

## 6. Performance & Reliability Plan
- **Pooling:** `PrismaService` sets conservative `connection_limit`/`pool_timeout` (prod pool size 3) — sensible for Cloud Run; watch for pool exhaustion under concurrency (VW-009).
- **Idempotency/locks:** advisory-locked critical sections (budget, holds, punches, admin-count, floor plan) + durable `AsyncWriteReceipt` — good. Verify offline-queue flush + receipt dedupe end-to-end (VW-008).
- **FK indexes:** dedicated `add_fk_indexes` / `index_foreign_keys` migrations — good.
- **Realtime:** confirm cross-replica fan-out (VW-003).
- **AI cost:** bounded (budget + token pre-count + max output tokens + timeouts). Add per-user rate limiting.
- **Load:** no harness — build one before asserting throughput targets (VW-009).

## 7. Test & Verification Plan (staging)
1. **Build gate:** `npm run typecheck`, `npm test -- --coverage`, `npm run api:build`, `npm run doctor`. Expect pass (prior baseline passed).
2. **Cross-tenant negative:** as tenant A, attempt to read/mutate B's reservation/document/chat via injected IDs and `x-venue-id`. Expect 403/empty. *Failure signal:* any B data returned.
3. **RLS runtime role:** on the `stadium_api` (non-bypass) role with GUCs unset, `SELECT` a tenant table. Expect 0 rows / denied. *Failure signal:* rows returned → cutover not safe.
4. **Idempotency:** replay a clock-in with the same `Idempotency-Key`; expect one row. Kill worker mid-flush; expect no dup/loss.
5. **Queue topology:** cold-boot worker before producer and vice-versa; expect no `PRECONDITION_FAILED`.
6. **Stripe webhook:** replay a captured event past the tolerance window → rejected; valid within window → processed once.
7. **SSO:** map a group to a role as a non-owner admin → expect denied / capped below `platform_admin`.
8. **AI budget:** drive a venue past `AI_MONTHLY_VENUE_BUDGET_USD` → expect 429, no provider call.
9. **Realtime:** two replicas, one client each; emit on replica A → expect delivery to B (or documented single-replica).

## 8. Remediation Roadmap

| Priority | IDs | Work Item | Area | Effort | Validation | Blocker |
|---|---|---|---|---|---|---|
| 1 Containment | — | Confirm prod redeployed from HEAD; `migrate status` clean | Deploy | S | VW-002 test | Yes |
| 2 Release blocker (pilot) | 001,004 | Complete RLS role cutover per runbook; bind GUCs universally | DB/Tenant | L | Test 3 | Yes |
| 2 Release blocker (pilot) | 003,008 | Prove realtime fan-out + queue topology at replica scale | Reliability | M | Tests 5,9 | Yes |
| 3 High | 006 | SSO mapping ceiling + audit | Auth | S | Test 7 | No |
| 3 High | 007 | Cross-tenant + ledger conservation tests; raise branch gate | Testing | M | Test 2,4 | No |
| 4 Perf/Reliability | 009 | Build load/queue harness; validate pool sizing | Perf | M | Test 8, load | No |
| 5 Maintainability | 005,010 | Track dep advisories; type-narrow `as any` hotspots | Deps/Types | M | typecheck | No |

## 9. Final Go / No-Go

**CONDITIONAL GO.**

- **Blockers before a live stadium/game-day pilot:** VW-002 (image parity), VW-001+VW-004 (RLS cutover + universal GUC binding), VW-003+VW-008 (realtime/queue at replica scale).
- **Minimum changes:** finish the documented RLS cutover and confirm production runs the cut-over role; universalize tenant GUC binding; redeploy prod from HEAD; verify queue/realtime on ≥2 replicas.
- **Required staging validation after fixes:** Tests 1–9 above, especially the runtime-role RLS negative test.
- **Highest-risk areas for owner review:** database role/RLS enforcement, enterprise SSO role mapping authority, and game-day realtime/queue durability.
- **Recommended order:** (1) prove prod parity → (2) RLS cutover + GUCs → (3) realtime/queue proof → (4) SSO ceiling → (5) coverage + load hardening.

**Bottom line:** For controlled/demo/non-game-day use, the codebase is in strong, well-hardened shape and most of the prior audit's P0s are resolved in code. For a *live* pilot, the gate is finishing the database-level RLS enforcement and proving the deployed runtime — operational tasks that require production access this repo-only sweep cannot perform.

---

## 10. Addendum — RLS cutover work performed (2026-09-03)

Executed against a throwaway local **PostgreSQL 18** cluster with a real
`stadium_api` `NOBYPASSRLS` role (no production system touched).

| ID | Severity | Finding | Status |
|---|---|---|---|
| VW-SWEEP-019 | **High** | Migration `20260903120000` referenced three non-existent relations — `"Zone"` (now `FacilityZone`), `"ConcourseOutlet"` (now `Outlet`), `"Table"` (no such model). It aborted with `relation "…" does not exist` on any clean DB, so it had never applied to a fresh database. | **Fixed** — stale blocks guarded on legacy-table existence; full 72-dir chain now applies clean end-to-end (verified). |
| VW-SWEEP-020 | **High** | 64 of 88 venue-scoped tenant tables had RLS enabled but **no `stadium_api` policy** → deny-all under the cutover role (~73% of the tenant data surface fails closed). | **Fixed** — new migration `20260903130000_complete_tenant_rls_policy_coverage` adds `venue_matches("venueId")` to all 64; coverage now **88/88** (verified). |
| VW-SWEEP-021 | Medium | Pre-membership / self-service flows (`Invite`, `WorkplaceJoinRequest`, `Subscription`, `PushToken`) will fail closed under `venue_matches()` after cutover. | **Open** — needs a reviewed `SECURITY DEFINER` bootstrap path before the role switch. |
| VW-SWEEP-022 | Medium | Universal GUC binding is still opt-in per write path; non-transactional reads won't carry `app.*` GUCs under the cutover role. | **Open** — app-wide change; must land before the role switch. |

**Runtime proof (local):** read isolation, fail-closed default, and cross-tenant
`WITH CHECK` rejection all verified as `stadium_api` on `Reservation` and on a
newly-covered table (`AuditLog`). See `docs/rls-cutover-runbook.md` → *Local runtime proof*.

**Still owner-run (cannot be done from a repo session):** Phase-0 role creation +
`GRANT`s, switching prod `DATABASE_URL` to `stadium_api`, and confirming prod
migration parity (`prisma migrate status` against the prod direct URL). These need
production credentials and are out of scope for a static/local session.

## 11. Addendum 2 — universal GUC binding + a severe auth bootstrap finding (2026-09-03, same day)

This pass installed `node_modules` and ran the **real NestJS app** — full unit
suite (910 tests) and full integration suite (24 tests, real HTTP through real
`AuthGuard`/interceptors/controllers) against a local PostgreSQL 18 instance,
not just raw SQL. That surfaced a materially more severe finding than VW-021's
narrow framing suggested.

| ID | Severity | Finding | Status |
|---|---|---|---|
| VW-SWEEP-023 | **Critical** | `AuthGuard`'s first two queries (`Session` lookup, then the `Profile` lookup that DISCOVERS venueId) run before any tenant context exists. `Session`/`User` carry RLS with **zero** stadium_api policies (global, not tenant-owned); `Profile`'s own policy needs `app.venue_id` already bound. Verified directly: `stadium_api` with no GUCs reading a real `Session` row returned 0 rows. **Every authenticated request would 401 under the cutover role** — not a narrow onboarding-flow gap, all traffic. | **Fixed** — migration `20260903140000_auth_bootstrap_security_definer` adds two narrow, parameterized `SECURITY DEFINER` functions; `auth.guard.ts` now calls them unconditionally (one code path). Verified end-to-end on a fresh cluster: bootstrap RPCs return correct data with zero GUCs while direct table reads on the same tables stay fail-closed, and post-bootstrap policy isolation is unaffected. |
| VW-SWEEP-024 | High | `phase0-roles.sql` never reassigned existing table/function ownership to `stadium_migrator`, and never granted it `USAGE` on `app_private` (locked to `PUBLIC` before that role existed). Without both, VW-023's fix 403s with `permission denied for table X` / `permission denied for schema app_private` on any real (non-superuser-owned) database — invisible on a hand-patched test DB, only surfaced by rebuilding from scratch. | **Fixed** — script now reassigns all table/sequence/`app_private`-function ownership and grants schema `USAGE`; re-verified end-to-end on three successive from-scratch rebuilds. |
| VW-SWEEP-025 | Medium | `setupTestDb()` (used by every `*.integration.spec.ts`) runs `prisma db push` only — never the raw migration SQL — so once `AuthGuard` depended on the new RPCs unconditionally, every db-push test database 500'd on its first authenticated request (`app.e2e.integration.spec.ts` went 3/3 red). | **Fixed** — `setupTestDb()` now also creates the two bootstrap functions after `db push`; confirmed the same suite back to green. |
| VW-SWEEP-026 | Low | `phase0-roles.sql`'s original `CREATE ROLE … PASSWORD :'var'` inside a `DO $$ … $$` block never worked — psql does not substitute `:'var'` inside a dollar-quoted body. | **Fixed** — rewritten with the standard `\gexec` idiom; confirmed working on three from-scratch reruns. |
| VW-SWEEP-027 | Medium | Universal GUC binding (VW-022) needed an actual mechanism, not just a plan. | **Mechanism delivered**: `TenantRequestTransactionInterceptor` opens one GUC-bound transaction per request; the tenant-isolation Prisma extension redirects every model call anywhere downstream onto it — zero call-site changes. Deliberately not global (pool-exhaustion risk for routes with slow external calls mid-handler — AI/S3/Stripe against a pool of 3); applied to `GuestsController` as the first real-controller slice, proven via a new cross-tenant HTTP integration test. Rollout to the rest of `VENUE_SCOPED_MODELS` is tracked in `scripts/rls-cutover/README.md`, still open. |
| VW-SWEEP-028 | Low | `npm run lint -w @venue-wrangler/api` (the exact CI Typecheck step) was broken on `main` at the start of this session: `async-write/worker.ts` called `enterTenant` (void, single-arg) where `runWithTenant` (runs `fn`, returns its result) was needed, and `union-compliance.service.ts` referenced Prisma models (`concourseOutlet`/`zone`) renamed to `outlet`/`facilityZone` before the file was written. | **Fixed independently** by another session mid-work (commits `8787b3a`/`c94cf64`/`fca2a05`/`6f3d5c6`); confirmed `npm run lint` exits 0 on the merged result. |

**Regression gate for this addendum:** `npm run lint -w @venue-wrangler/api` (0
errors), `npx vitest run` (910 passed, 2 skipped), `npx vitest run --config
vitest.integration.config.ts` (24 passed) — all against a local PostgreSQL 18
instance, re-run after every change in this pass.

**Updated release-risk picture:** VW-023 alone would have made the RLS cutover
an outage, not a security hardening step — it is now fixed and independently
verified, and the runbook's Phase-0 script is fixed alongside it (VW-024). The
remaining pre-cutover gate is narrower than before: finish the
`TenantRequestTransactionInterceptor` rollout across the rest of the app
(VW-027) and the non-auth bootstrap carve-outs (VW-021: Invite,
WorkplaceJoinRequest, Subscription, PushToken).
