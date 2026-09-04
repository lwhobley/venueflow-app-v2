# Feature Re-Review (Round 2) — Department Access, Rosters & Kitchen Tickets

**Review date:** 2026-09-03
**Trigger:** Remediation commit `d46099c` ("fix(security): remediate department access, roster IDOR, and kitchen tickets (F-01 to F-19)") — 1,383 insertions across 12 files, zero migrations.
**Baseline:** Round-1 review, `docs/feature-review-department-access-rosters-kitchen-tickets-2026-09-03.md`
**Method:** Independent re-verification of each Round-1 finding against the actual post-fix code — not commit-message trust. Where a fix's correctness depended on a behavior rather than a code shape, I proved it empirically with a temporary probe spec against the real functions (removed afterward). Typecheck + full unit suite re-run.

---

## 1. Executive Outcome

**`CONDITIONAL — FIXES REQUIRED`** (upgraded from `NOT READY`)

This is a genuinely strong remediation pass. **16 of 19 findings are fully fixed and independently verified**, including all four roster Criticals (F-03/F-04/F-05/F-06) and the concurrency, CSV-injection, validation, and audit findings. `canAccessResource` is now actually wired into the kitchen-ticket controller, which was the single biggest structural gap in Round 1. 22 new security-focused tests were added, and they are real negative tests, not snapshots.

It is not yet `READY FOR STAGING` because the F-01 fix introduced a **new Critical issue of its own**: the department boundary for kitchen tickets is now computed by substring-matching **client-controlled free text** (`serviceAreaName`, `notes`), with a **permissive default**. I empirically confirmed four distinct failure modes, including a Culinary user being granted view access to an operationally-Concessions ticket — the exact invariant the fix was written to protect. F-02 (no department dimension in RLS) remains untouched, so there is still no database backstop when this application-layer logic is wrong — and it is currently wrong.

---

## 2. Findings Table

### 2a. Round-1 findings — verification results

| ID | R1 Severity | Status | Verification Evidence |
|---|---|---|---|
| F-01 | Critical | **Partially fixed — new Critical raised (see R2-01)** | `canAccessResource` is now genuinely called: `kitchen-distro-fulfillment.controller.ts:151` (`assertTicketAccess`) and `:199` (per-area filtering in `listTickets`, memoized via an `areaDecisions` map — no N+1). Every mutation route now passes a specific action verb. The *plumbing* is correct. The *input* to it is not (R2-01). |
| F-02 | Critical | **NOT FIXED** | Remediation commit contains **zero migration files** (`git show --stat d46099c` → 0 `migration.sql`). Repo-wide grep confirms the only department-referencing policies are on `DepartmentMembership` itself, still scoped `scope_matches(organizationId, facilityId, NULL)`. No resource policy has a department predicate. No DB backstop exists. |
| F-03 | Critical | **Fixed** | New `assertCanAccessDepartmentRoster` helper (admin bypass, else active `DepartmentMembership` required) called in `getRoster` (`daily-roster.service.ts:231`) and `exportRosterCsv` (post-fetch, pre-serialize). Both now take `actorUserId`. |
| F-04 | Critical | **Fixed** | `submitRoster` converted to a params object and now calls `assertCanAccessDepartmentRoster` before the status update. |
| F-05 | Critical | **Fixed** | `approveRoster` now requires `status === 'submitted'` (`:410`); `closeRoster` requires `status === 'approved'` (`:471`). Skip-ahead transitions rejected. |
| F-06 | Critical | **Fixed** | `updateWorker` pre-verifies `findFirst({ where: { id: workerId, rosterId: roster.id } })` (`:338`); `adjustClosedRoster` does the same per entry and throws `Worker … does not belong to this roster` (`:536-540`). Minor residual note in §2c. |
| F-07 | High | **Fixed** | All six transitions converted to `updateMany({ where: { id, status: ticket.status } })` + `count === 0 → ConflictException`. Verified the where-clause genuinely pins the pre-read status (`:515-524`, `:589`, `:680`, `:762`, `:848`, `:931`). |
| F-08 | High | **Fixed** | `adjustClosedRoster` roster update now uses `where: { id: rosterId, version: roster.version }` — real optimistic lock. |
| F-09 | High | **Fixed** | `reopenTicket` added (`service:897`, route `POST :id/reopen`), requires a reason, restricts source states to `cancelled`/`picked_up`, gated on the new `'reopen'` action which requires manager rank. |
| F-10 | High | **Fixed** | `sanitizeCsvCell` (`daily-roster.service.ts:19-26`) prefixes `=`, `+`, `-`, `@`, tab, CR with `'` and quote-escapes; applied to **every** cell including numerics and the `[REDACTED]` sentinel. |
| F-11 | Medium | **Fixed** | `ResourceAction` extended with `acknowledge/start/hold/fire/ready/pickup/cancel/reopen`. Rank logic differentiates: `cancel`/`reopen` grouped with `approve`/`close` at manager rank (`access-control.helper.ts:167`); `fire`/`ready`/`acknowledge` at operator level. Covered by two new controller tests. |
| F-12 | Medium | **Fixed** | 30-day override cap (bypassable only by `allAccess`/`platform_admin`/`owner`), and `zoneId` now validated against the facility before the override is written. |
| F-13 | Medium | **Fixed** | `WorkerAdjustmentDto` class added with `@IsArray() @ValidateNested({ each: true }) @Type(() => WorkerAdjustmentDto)` — nested array entries are now actually validated. |
| F-14 | Medium | **Partially fixed** | DTO layer fixed (`@IsIn(VALID_ATTENDANCE_STATUSES)` on all three DTOs). The **database half is not** — still `attendanceStatus TEXT` with no enum/CHECK, because no migration was added. Direct DB writes and any future non-DTO code path remain unconstrained. |
| F-15 | Medium | **Fixed** | Silent `.catch(() => undefined)` replaced with `.catch(err => this.logger.warn(...))` across both services. Meets the stated minimum (the stronger in-transaction option was not taken — acceptable, noted). |
| F-16 | Medium | **Fixed** | `CreateKitchenTicketDto` service interface no longer declares `organizationId`/`facilityId`; the service derives both from the authenticated scope. Latent mass-assignment surface removed. |
| F-17 | Low | **Fixed** | `cancelTicket` now returns early when already `cancelled` (`:831-833`) — no duplicate cancellation history. |
| F-18 | Low | **Fixed** | No `any` casts remain in the kitchen service. |
| F-19 | Low | **Substantially fixed** | 22 net-new tests (939 → 961). New `kitchen-distro-fulfillment.controller.spec.ts` has real negative security tests (Culinary denied Concessions view *and* fire; list filtering; rank-gated cancel/reopen). Gap: no test covers the derivation failure modes in R2-01. |

**Score: 16 fully fixed, 2 partially fixed (F-01, F-14), 1 not fixed (F-02).**

### 2b. New findings raised by this round

| Severity | Area | File / Line | Finding | Exploit or Failure Scenario | Required Fix | Verification Test |
|---|---|---|---|---|---|---|
| **Critical** (R2-01) | Kitchen tickets — trust boundary | `kitchen-distro-fulfillment.service.ts:21-51` (`deriveTicketOperationalArea`), consumed at `controller.ts:144,196` | The department security boundary is derived by substring-matching two **client-supplied** free-text fields (`serviceAreaName`, `notes` — both settable via `CreateTicketDto`), with a **permissive fallback** (`return 'distro'`). Nothing is persisted; the classification is recomputed from mutable text on every read. I proved four failure modes empirically against the real functions: **(1) Permissive fallback leak** — `{serviceAreaName: 'Section 120 Prep'}` → derives `distro`; `evaluateAccessRules` with `activeDepartmentCodes: ['culinary']` returns **allowed = true**. An operationally-Concessions ticket is visible to Culinary — the exact invariant F-01 existed to protect. **(2) Substring collisions** — `'Dessert Cart - Club Level'` → `concession` (matched "cart"); `'Standard Prep Line'` → `concession` (matched "stand" inside "Standard"). Both are realistic names in this domain. **(3) BEO precedence bug** — `{serviceAreaName: 'Suite 204', beoId: 'beo-123'}` → `catering`, and a **Suites member is denied access to their own suite's ticket** (`allowed = false`). `SuiteBeoOrder` is a first-class model here, so BEO-linked suite tickets are the normal path, not an edge case. **(4) Notes-driven reclassification** — `{serviceAreaName: 'Suite 204', notes: 'deliver via concession corridor'}` → `concession`. | Mislabeled or unlabeled tickets cross the Suites/Clubs/Catering/Concessions/Culinary boundary in both directions: data leaks to departments that shouldn't see it, and owning departments lose access to their own tickets. Mitigating factor: the `create` path is partially self-limiting (a Concessions-only user cannot create a `distro`-derived ticket, since `distro` isn't in their baseline), so scenario (1) requires the ticket to be created by an admin, `operations`, `culinary`, or `catering` member — a routine occurrence. Scenarios (2)–(4) are unconditional correctness bugs affecting any creator. | Stop deriving authorization input from free text. Add a persisted, server-validated `operationalAreaType` (and ideally `departmentId`) column to `KitchenFulfillmentTicket`, set at creation from the authenticated creator's department and/or a validated `serviceAreaId` → area mapping (the `DepartmentAreaRule` table already exists for exactly this and is currently unused by tickets). Make the fallback **deny**, not `distro`. Keep keyword derivation only as a migration aid for legacy rows, never as the live authorization input. | Test each probe case as an assertion: neutral-named concessions ticket must NOT be viewable by a culinary-only user; a BEO-linked suite ticket must remain viewable by Suites; `notes` must not affect classification; unknown/unmappable area must deny rather than default. |
| Medium (R2-02) | Kitchen tickets — RLS gap consequence | migrations (none added) | F-02 unchanged means R2-01 has no database backstop. In Round 1 this was "no backstop for a control that doesn't exist"; now it is "no backstop for a control that exists and is demonstrably bypassable." The risk is materially higher than it was, even though the code did not change. | Any residual gap in the derivation logic is directly exploitable with no second line of defense. | Ship the persisted `operationalAreaType`/`departmentId` column from R2-01, then extend the ticket RLS policy to include it (an `app_private` helper joining `DepartmentMembership`/`DepartmentAreaRule`, mirroring the existing `scope_matches` pattern). | Negative RLS test under the `stadium_api` role: two department contexts at the same facility/zone; confirm one cannot `SELECT` the other's ticket rows. |
| Low (R2-03) | Rosters — TOCTOU window | `daily-roster.service.ts:536` vs `:578` | In `adjustClosedRoster`, the worker-ownership check (`findFirst … rosterId`) runs **outside** the transaction; the update runs inside it. | Practically negligible — no code path mutates a worker's `rosterId`, so the verified relationship cannot change between check and use. Flagged for completeness only. | Move the ownership check inside the `$transaction` callback, or add `rosterId` to the update's `where`. | Existing F-06 test suffices once the check is relocated. |

### 2c. Carried-forward items

- **F-14 (DB half)** and **F-02** both require the same thing the remediation commit did not include: **a migration**. Any further hardening of this feature at the database layer is blocked on that.

---

## 3. Security Validation

| Area | Round 1 | Round 2 |
|---|---|---|
| Tenant/organization/venue isolation | Pass | **Pass** (unchanged) |
| Department/service-area isolation — rosters | Fail | **Pass** — membership enforced on list, get, export, submit, and all mutations |
| Department/service-area isolation — kitchen tickets | Fail | **Fail** — enforcement now exists but is driven by spoofable/ambiguous input (R2-01) |
| Culinary-vs-Concessions separation | Fail | **Fail** — correct when the name contains a classifying keyword; bypassed by the permissive `distro` fallback (proven) |
| Manager/director/admin department-limited authority | Partial | **Pass** |
| API authorization + IDOR | Fail | **Pass** — F-03/F-04/F-06 all closed and verified |
| RLS (SELECT/INSERT/UPDATE/DELETE) | Pass tenant / Fail department | **Unchanged** — still no department dimension |
| Sensitive-data redaction / payroll | Partial | **Pass** — redaction logic was already correct; the endpoints reaching it are now authorized |
| Kitchen-ticket state machine & concurrency | Fail | **Pass** — CAS on all six transitions, `reopen` added with rank gating |
| Roster rollover, approval, history, export | Partial/Fail | **Pass** — state machine enforced, optimistic locking, CSV injection neutralized |
| Audit-log integrity | Partial | **Pass (minimum bar)** — failures now logged rather than swallowed |
| Realtime broadcast targeting | Needs Verification | **Still Needs Verification** — `broadcastDistroPickupUpdate` is called on every mutation with `facilityId`/`zoneId` only; not re-traced this round. Given R2-01, assume it carries the same classification weakness until tested. |

---

## 4. Syntax and Logic Results

- `npm run lint -w @venue-wrangler/api` (`tsc --noEmit`): **0 errors**.
- `npx vitest run`: **961 passed, 2 skipped, 0 failed** (88 files) — up from 939/87.
- No migrations added, so no migration-ordering, enum, or schema-drift risk introduced this round.
- No `@ts-ignore`/`@ts-nocheck`; the Round-1 `any` cast is gone.
- New tests are meaningful negative security tests (Culinary denied both *view* and *fire* on Concessions; list filtering; rank-gated cancel/reopen) — they assert policy outcomes, not implementation details. They do not, however, cover the derivation inputs those outcomes depend on, which is why R2-01 survived a green suite.

---

## 5. Required Remediation Plan

| Priority | IDs | Work Item | Effort | Risk if Unfixed | Test Before Release |
|---|---|---|---|---|---|
| 1 | R2-01 | Persist a server-validated `operationalAreaType`/`departmentId` on `KitchenFulfillmentTicket`, set at creation from the creator's department and/or a validated `serviceAreaId` (use the existing, currently-unused `DepartmentAreaRule`). Make the unmappable case **deny**. Demote keyword matching to a one-time backfill for existing rows. | M (needs a migration + backfill) | Cross-department ticket leakage and owning-department lockout, both proven, with no DB backstop | The four probe assertions in R2-01 |
| 2 | F-02, R2-02, F-14 (DB half) | In the same migration: add the department predicate to the ticket RLS policy, and convert `attendanceStatus` to an enum/CHECK | M | No second line of defense; unconstrained status values via non-DTO paths | Negative RLS test under `stadium_api`; migration + type-generation check |
| 3 | Realtime (§3) | Audit `SuiteHospitalityGateway.broadcastDistroPickupUpdate` targeting for the same classification weakness | S (audit) | Realtime push may leak cross-department updates even once REST is correct | Subscribe as Concessions-only, fire a Suites ticket update, assert no event received |
| 4 | R2-03 | Move the worker-ownership check inside the transaction | XS | Negligible today | Existing F-06 test |

---

## 6. Final Gate

**`CONDITIONAL — FIXES REQUIRED`**

The remediation closed every roster Critical and every concurrency, validation, injection, and audit finding, with real negative tests behind them — that is substantive, well-executed work, and the roster feature is in good shape.

The blocker is narrow and specific: **kitchen-ticket department authorization is enforced against attacker-influenceable, ambiguity-prone free text with a permissive default.** Priority-1 and Priority-2 above must land before staging with real venue data. Both fit in a single migration plus a modest service change, and the `DepartmentAreaRule` table needed to do it properly already exists — it was simply never connected to tickets.

Rosters, in isolation, would pass. Kitchen tickets do not yet.

---

## 7. Round 3 — Remediation of R2-01 / F-02 (2026-09-03)

**Scope:** implement the R2-01 persisted-area fix, the F-02 database backstop, and the migration both require.

### 7.1 What changed

| Area | Change |
|---|---|
| Schema | `KitchenFulfillmentTicket.operationalAreaType` (`OperationalAreaType`, **NOT NULL**) + index `(facilityId, operationalAreaType, status)`. |
| Service | New `resolveOperationalArea()` resolves the area **server-side** from `serviceAreaId` → `Outlet`/`FnbOperationUnit`.`department` (a server-owned column), constrained by `FNB_DEPARTMENT_AREA_CONSTRAINTS`. An unresolvable `serviceAreaId` is a `BadRequest`, not a silent ignore. A `declaredArea` is accepted only if it is within the permitted set for that department. With no `serviceAreaId`, `operationalAreaType` is **required** — there is no fallback. `deriveTicketOperationalArea` is retained but marked *legacy, backfill only, not for authorization*. |
| Controller | `assertTicketAccess` and `listTickets` now read the **persisted column**, never free text. Create resolves → authorizes → persists. BEO tickets default to `'suite'`, fixing the Round-2 BEO precedence bug. |
| Authorization source of truth | `BASELINE_DEPARTMENT_AREAS` exported from `access-control.helper.ts` and consumed by all three layers (app check, `DepartmentsService.ensureDepartmentAreaRules()` materialization, migration backfill). |
| RLS (F-02) | Migration `20260903190000` adds `app_private.department_area_allows(org, facility, area)` (`SECURITY DEFINER`, `search_path = ''`) and rewrites the four kitchen-ticket + history policies to `scope_matches(...) AND department_area_allows(...)`. Ticket history joins through to its parent ticket's area. |
| Client | `app/stadium/distro-pickup.tsx` gained a required operational-area picker on the create modal. |

### 7.2 Systemic defect found while proving the fix

The first end-to-end isolation probe returned **zero rows for every user**, including correctly scoped ones. Isolating the two ANDed predicates showed both `scope_matches()` and `department_area_allows()` returning `false` even under a superuser session with the GUCs bound.

Root cause: **every `app_private` authorization helper is `SECURITY DEFINER`, so it executes as its owner (`stadium_migrator`), and the authorization-source tables had `FORCE ROW LEVEL SECURITY`.** `FORCE` makes RLS apply to the table owner too, so each helper's own lookups were themselves filtered to nothing. Proven directly:

```
SET ROLE stadium_migrator;
SELECT count(*) FROM "OrganizationMembership";  -->  0
```

Consequence: this was **not** limited to the new department dimension. `scope_matches()` backs the policies on the great majority of tenant tables, so under the intended cutover role the entire RLS layer was silently **deny-everything** — a total functional break that no prior test caught, because the isolation gate only ever asserted that *cross-tenant* reads return zero rows, which a deny-everything policy satisfies trivially.

Fix (Part 4 of the migration): drop **owner-side `FORCE` only**, on exactly the eight tables an authorization helper reads (`OrganizationMembership`, `ScopeAssignment`, `DepartmentMembership`, `DepartmentAreaRule`, `UserAreaOverride`, `Profile`, `Session`, `Venue`). `ENABLE ROW LEVEL SECURITY` stays on all of them. This does not widen the real trust boundary: the runtime connects as `stadium_api`, which is `NOBYPASSRLS` and not the table owner, so `ENABLE` alone keeps it fully policed. `FORCE` only ever constrained the migration role, which holds DDL and could disable RLS at will — so it bought nothing against the actual threat while breaking authorization outright.

### 7.3 Verification

Rebuilt from an **empty database**: 78 migrations applied clean → `phase0-roles.sql` → seeded two departments at one facility (`culinary` grants `culinary,kitchen,distro,suite,club,catering,shared`; `concessions` grants `concession,shared`) with a `concession` ticket and a `suite` ticket. Probed as the real `NOBYPASSRLS` `stadium_api` role:

| Probe | Result |
|---|---|
| Culinary user sees | `t_suite(suite)` only — `t_con` correctly denied |
| Concessions user sees | `t_con(concession)` only — `t_suite` correctly denied |
| Helper truth table (concessions user) | `scope_matches = t`, `allows('concession') = t`, `allows('suite') = f` |
| Same user, `app.organization_id` switched to another org | `0` rows |
| No GUCs bound at all | `0` rows (fail-closed) |
| `FORCE` flags on the eight helper-source tables after rebuild | `ENABLE = t`, `FORCE = f` on all eight |

Tests: **978 passed, 2 skipped, 89 files, 0 failures** (baseline 961/88). `tsc --noEmit` exit 0. New permanent regression coverage:

- `department-area-rule-drift.spec.ts` — parses the migration's own backfill `VALUES` list and asserts it matches `BASELINE_DEPARTMENT_AREAS` exactly, so the SQL copy cannot drift from the TypeScript constant.
- Four `R2-01` controller cases, each of which **fails under the old name-derived classifier**: neutral-named concession ticket hidden from culinary-only staff; BEO suite ticket visible to Suites despite a catering-sounding name; `notes` inert for classification; mutation of an out-of-department neutrally-named ticket forbidden.

### 7.4 Revised gate

**R2-01: fixed and verified. F-02: fixed and verified. R2-02: closed by F-02.**

Still open, unchanged by this pass: **R2-03** (roster TOCTOU, Low), **F-14 database half** (`attendanceStatus` enum/CHECK), and the realtime gateway broadcast audit.

One item now warrants owner attention that did not exist before this round: because the RLS layer was previously deny-everything under `stadium_api`, **no environment has ever run a full workload against working policies.** The isolation gate must be re-run — and extended with positive-visibility assertions, not only cross-tenant-denial ones — before the cutover flips `DATABASE_URL` to `stadium_api`.
