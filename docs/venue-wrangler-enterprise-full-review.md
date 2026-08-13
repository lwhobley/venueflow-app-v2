# Venue Wrangler Enterprise — Full System Review

**Review date:** August 13, 2026  
**Review posture:** Principal enterprise systems architecture, security, data integrity, stadium operations, and pilot readiness  
**Decision:** **NO-GO for a live NFL/stadium pilot in the current state**  
**Overall pilot-readiness score:** **3/10**

## 1. Executive summary

Venue Wrangler Enterprise has a credible stadium-domain foundation: a NestJS API, Expo client, Prisma/PostgreSQL model, organization/facility/zone hierarchy, enterprise SSO primitives, event state concepts, issue/readiness models, BEOs, stand sheets, transfers, staffing, queue infrastructure, and a passing unit-test/build baseline.

It is not yet safe to use as the operational or financial system of record during a live event. The highest-risk failures are not cosmetic:

1. **The deployed PostgreSQL runtime role bypasses RLS.** Tenant isolation currently depends primarily on application filters, while the container also performs migrations at API startup using a privileged database credential.
2. **Production high-volume writes are enabled, but shipped clients do not send the required idempotency header.** Clock-ins and negative inventory movements can return `503` before they reach RabbitMQ.
3. **The RabbitMQ producer and worker declare incompatible queue topology.** This can close the channel with `PRECONDITION_FAILED` depending on startup order.
4. **Queued and offline writes are not durably idempotent.** Redelivery, ambiguous network responses, concurrent flushes, account switching, and Redis loss can duplicate, lose, or reorder operational writes.
5. **Inventory, transfer, hawker, BEO, labor, and closeout records are not yet accounting-grade ledgers.** Several paths accept client totals, overwrite prior results, or fail conservation rules.
6. **“Live WebSocket” behavior is only polling plus an in-process `EventEmitter`.** It does not reach clients and cannot cross Cloud Run replicas.
7. **Temporary-staff PINs and QR values are predictable/plaintext, and punch/union logic is race-prone.** This is an access-control, payroll, and alcohol-compliance blocker.
8. **The event state override accepts any otherwise-illegal transition when a reason is present.** The main facility UI also skips required states, so normal transitions fail.
9. **Enterprise SSO can silently merge an assertion into an existing global user by email and lets broad operational administrators map groups to roles as high as `platform_admin`.**
10. **A Supabase service-role credential was pasted into this conversation.** It must be treated as exposed even though the repository scan found no tracked copy.

The correct immediate posture is to keep the product in controlled development/demo use, disable the high-volume queue flag, and complete the P0 remediation program below before admitting live game-day data.

## 2. Scope and evidence

### Code baselines

- Audited working tree: branch `desktop-web`, commit `b3924698a242ebd33f688748f437e30f9f08c47a`, including the current uncommitted stadium features.
- Production API image: source commit `49eec99d0b2971b095f85b6ba0bc1156a7bb696f`, matching the committed `main` baseline.
- The working tree contains uncommitted closeout, pilot-health, NFL-brief, integration-readiness, offline queue, plan-snapshot, and related changes. Those changes are **not** in the active production API revision.

### Production checks

- Cloud Run API: `stadium-wrangler-api`, latest revision `00025-cc4`.
- Cloud Run queue worker: `stadium-wrangler-queue-worker`, latest revision `00006-x52`.
- GKE: one Autopilot cluster hosting a single-replica RabbitMQ StatefulSet.
- Memorystore: one BASIC 1 GB Redis 7.2 instance, direct peering, transit encryption disabled.
- PostgreSQL runtime role, verified read-only: not superuser, but `BYPASSRLS=true` and a member of the intended API role.
- Tenant-table policy inventory, verified read-only: 91 tenant-like tables inspected; 67 legacy tenant tables have no policies and do not force RLS. The current bypass role can access them; the intended non-bypass role would deny them.
- Live migrations stop at `20260812233000_secure_stadium_operations`. `EventCloseout` and `EventPlanSnapshot` do not exist in production.
- Five production `/api/health` requests succeeded. Observed client-side elapsed times were 452 ms cold/first and 104–114 ms warm. This is an availability check, not a load test.

### Validation performed

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | Pass: 87 files, 932 tests; 2 skipped |
| `npm test -- --coverage` | Pass; 53.94% statements, 44.97% branches, 46.91% functions, 57.01% lines |
| `npm run api:build` | Pass |
| `npm run doctor -- --verbose` | Pass: 20/20 checks |
| `npm audit --omit=dev --workspace=@venue-wrangler/api --json` | Pass: 0 vulnerabilities |
| Root `npm audit --omit=dev --json` | Fail: 10 high transitive advisories in the Expo/Metro/React Native toolchain |
| `git diff --check` | Pass, with line-ending warnings |
| Browser sign-in at configured `127.0.0.1:8081` origin | Pass; reached `/home` with 0 console errors and 5 warnings |
| PostgreSQL integration tests | Not run locally: no Docker and no `TEST_DATABASE_URL`; CI is configured to run them |
| Queue/load/chaos tests | No harness exists; the stated sub-50 ms target is unverified |

## 3. Readiness scorecard

| Domain | Score | Pilot decision |
|---|---:|---|
| Tenant isolation / RLS | 2/10 | Blocked |
| Authentication / SSO / RBAC | 4/10 | Blocked pending scope hardening |
| High-volume queue / idempotency | 1/10 | Blocked; disable queue mode |
| Offline event operations | 1/10 | Blocked |
| Inventory / transfers / reconciliation | 2/10 | Blocked as financial truth |
| Premium hospitality / BEO | 4/10 | Demo only |
| Temporary staffing / union compliance | 2/10 | Blocked |
| Event state / issues / command center | 4/10 | Demo only |
| Closeout / finance | 2/10 | Blocked |
| Infrastructure resilience | 2/10 | Blocked for NFL scale |
| Mobile UX / role navigation | 4/10 | Major workflow friction |
| Automated quality baseline | 6/10 | Unit baseline good; integration coverage insufficient |

## 4. P0 launch blockers

### P0-01 — PostgreSQL RLS is bypassed in production

**Evidence**

- The live runtime role has `rolbypassrls=true`.
- Request execution never sets `app.user_id`, `app.organization_id`, `app.facility_id`, or `app.zone_id`, and never uses `SET LOCAL ROLE stadium_api`.
- `packages/api/src/prisma/tenant-scope.ts` provides only application-level venue/facility filtering. It does not establish PostgreSQL security context.
- Broad/background/public Prisma calls execute without tenant context.
- 67 tenant tables lack policies and do not force RLS. Switching to the intended role today would break those paths rather than safely isolate them.
- The API `Dockerfile` performs `prisma migrate deploy` at container startup and substitutes `DATABASE_DIRECT_URL`, requiring a migration-owner credential in every API instance.

**Consequence**

A missed application filter, vulnerable administrative query, background job, or server compromise can cross organization/facility boundaries. An API compromise also inherits schema-migration authority. This does not meet the stated multi-tenant or SOC 2 control objective.

**Required patch**

1. Create separate principals:
   - `stadium_migrator`: schema owner, no application login.
   - `stadium_api`: `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, no DDL.
   - narrowly scoped SSO-bootstrap role/RPC for public login initiation and ticket exchange.
2. Move `prisma migrate deploy` to a gated CI release job or one-off Cloud Run Job. Remove it from the API `CMD`.
3. Complete and force policies for every tenant table before switching credentials.
4. Bind every request to a transaction-scoped PostgreSQL context and make Prisma use that transaction client for the full request.
5. Add negative cross-organization, cross-facility, and cross-zone integration tests using the exact runtime role.

### P0-02 — High-volume mode rejects shipped client writes

**Evidence**

- Production has `HIGH_VOLUME_QUEUE_ENABLED=true`.
- `packages/api/src/async-write/async-write.service.ts:29-35` requires a 16–200 character `Idempotency-Key`.
- `packages/api/src/modules/time-clock/time-clock.controller.ts:246-250` and `packages/api/src/modules/bar-inventory/bar-inventory.controller.ts:398-404` pass a missing header as an empty string.
- `lib/api-client.ts:72-77` has no custom-header option, and `lib/api-client.ts:294-305` never generates or sends an idempotency key.
- The inventory movement hook at `lib/railway-hooks.ts:481` also sends none.

**Consequence**

Production clock-ins and queued negative inventory movements can return `503` before publish. The client then has no queue-result polling path to distinguish accepted, pending, completed, or failed writes.

**Immediate containment**

Set `HIGH_VOLUME_QUEUE_ENABLED=false` on both API and worker until P0-02 through P0-04 are fixed and integration-tested. This reduces throughput but restores synchronous correctness.

### P0-03 — RabbitMQ declarations are incompatible

**Evidence**

- Producer declaration at `packages/api/src/async-write/async-write.service.ts:21-25` includes a dead-letter exchange and routing key.
- Worker declaration at `packages/api/src/async-write/worker.ts:21-23` declares the same queue with only `{ durable: true }`.

**Consequence**

RabbitMQ treats the declarations as inequivalent and closes the second channel with `PRECONDITION_FAILED`. Startup order determines which component fails.

**Required patch**

Export one topology constant and one assertion routine shared by API and worker. Test API→worker and worker→API boot order against a real RabbitMQ instance.

### P0-04 — Queue delivery is neither loss-proof nor exactly-once

**Evidence**

- Redis is the source of idempotency truth, with 1-day queued and 7-day completed TTLs (`async-write.service.ts:31-39`).
- Redis reservation happens before Rabbit publish. A crash between `SET NX` and `publish` leaves a phantom accepted write.
- Ambiguous publisher-confirm failure deletes the Redis key, allowing a duplicate publish even if Rabbit accepted the first message.
- `BarInventoryMovement` has no message/idempotency key. A worker crash after PostgreSQL commit but before acknowledgement double-decrements inventory on redelivery.
- `worker.ts:24` parses outside the `try`; permanent failures are requeued forever, so the configured DLQ is effectively unused.
- Clock and inventory share one queue. `prefetch=50` permits reordering, and a synchronous physical count can be committed before older queued decrements.

**Required patch**

Add a PostgreSQL `AsyncWriteReceipt` unique on `(organization_id, kind, idempotency_key)` with payload hash, status, and result. Claim the receipt, apply the domain ledger mutation, and mark complete in one transaction. Duplicate deliveries return the stored result; reuse with a different hash is a conflict. Redis becomes an optional cache only. Add bounded retry queues, poison-message DLQ routing, queue lag metrics, and an ordered partition/barrier for inventory counts.

### P0-05 — The offline queue can lose, duplicate, or cross-tenant replay writes

**Evidence**

- `lib/offline-queue.ts:13-32` stores one whole queue under a global SecureStore key and silently ignores persistence failures. Web falls back to process memory.
- Each subscriber launches an asynchronous `load()`; it can overwrite a concurrent enqueue.
- Concurrent `flushOfflineQueue()` calls have no mutex and can send the same snapshot.
- Rows contain no user, organization, venue, facility, entity version, idempotency key, or next-attempt time.
- A logout or tenant switch can replay old writes with the new token and `X-Venue-Id`.
- Any `401` is treated as permanent and deletes the queued operation.
- Issue creation invents `clientMutationId` only after the initial request fails (`lib/railway-hooks.ts:678-692`), so commit-plus-lost-response creates a second issue on replay.
- Readiness is a blind upsert without a base version; an older offline `ready` write can overwrite a later safety-critical `blocked` state.
- Transfers, counts, 86s, checklist updates, outlet statuses, and kiosk punches are not on the offline engine.

**Required patch**

Use transactional SQLite rows on native and IndexedDB on web. Generate a cryptographic UUID before the first attempt; persist tenant/user ownership, entity key, sequence, payload hash, occurred-at, base version, attempts, and retry time. Enforce one sync worker, per-entity FIFO, durable idempotency server-side, compare-and-swap conflict responses, and a visible conflict/dead-letter screen. Never auto-resolve a blocked/readiness or food-safety conflict destructively.

### P0-06 — Inventory, stand sheets, transfers, and hawkers violate accounting invariants

**Stand sheets**

- `app/stadium/stand-sheet.tsx:39` initializes actual revenue to a hard-coded `$2,450`.
- The UI has no count-input controls and constructs submitted counts from `inventoryVariance`, which is normally empty before reconciliation (`:59-75`, `:139-157`).
- The backend permits repeated reconciliation/overwrite, silently ignores unknown item codes, defaults missing inputs to zero, and does not prevent negative conservation (`concourse-inventory.service.ts:115-189`).
- Financial detail is mutable JSON; `eventId` is optional and no constraint prevents multiple active sheets per outlet/event (`schema.prisma:2614-2643`).

**Transfers**

- `InventoryTransferRequest` uses raw outlet strings without foreign keys, line records, event requirement, or idempotency key (`schema.prisma:2645-2662`).
- Completion appends JSON to the latest destination stand sheet; it does not reserve/debit source stock and can complete when no sheet exists (`concourse-inventory.service.ts:199-254`).
- Concurrent completions can overwrite one another's JSON append.
- The UI sends `approved → completed`, while the API requires `approved → in_transit → completed` (`app/stadium/commissary.tsx:107-115`). The normal delivery action fails.

**Hawkers**

- The API has checkout/settle but no list endpoint; the UI forces sessions to `[]` and uses hard-coded settlement data.
- Over-returns are clamped rather than rejected, cash plus card is not reconciled to gross, and commission is calculated from theoretical item sales (`concourse-inventory.service.ts:273-318`).

**Required patch**

Introduce normalized immutable inventory and cash ledgers, integer base units/cents, tenant-composite foreign keys, event-required operational records, source reservation/debit/destination receipt, one-active-sheet constraints, compare-and-swap transitions, and exactly-once request IDs. Reconciliation must prove:

`count_in + received - transferred_out - waste - count_out = expected_units_sold`

and then compare expected sales to authoritative POS quantities/revenue without conflating tax, discount, comp, and price-mix variance.

### P0-07 — Closeout is mutable and can finalize empty/manual totals

**Evidence**

- The feature and migration are uncommitted and absent from production.
- DTO financial fields are optional; `laborHours` is not validated (`stadium.controller.ts:101-113`).
- The controller accepts client totals and overwrites one closeout row; it can finalize an empty record (`stadium.controller.ts:369-395`).
- An adjustment reason is required only while current status is exactly `finalized`. After the first `adjusted` write, later changes and status regression require no reason.
- A generic manager can finalize. No finance/director dual approval exists.
- The model has no immutable revisions, source IDs/checksums, previous hash, or database trigger (`schema.prisma:2203-2229`).
- UI uses raw cents, allows forecast editing, has no adjustment-reason workflow, and keeps save/finalize actions active after finalization.

**Required patch**

Build an immutable `EventCloseoutRevision` chain sourced from POS, payroll, inventory/stand-sheet, and BEO snapshot checksums. Require completeness, finance/director approval, integer labor minutes, reason and approver on every adjustment, and a database trigger rejecting update/delete of finalized revisions.

### P0-08 — Temporary-staff authentication and payroll compliance are unsafe

**Evidence**

- `schema.prisma:2757-2761` stores raw PIN/QR values and defaults food/alcohol certifications to true.
- `temp-staffing.service.ts:58-76` assigns sequential PINs from `100000` and embeds the PIN in the QR identifier.
- Alcohol eligibility checks expiry but ignores `certAlcohol === false` (`:110-115`).
- Kiosk QR and outlet data are hard-coded; entered PIN digits are visible; help text conflicts between four and six digits.
- Punch processing is read-then-create without a transaction, lock, version, or idempotency key (`union-compliance.service.ts:173-195`). Two kiosks can create duplicate IN punches.
- Union calculations use UTC business-day boundaries, reduce a shift to first IN/last OUT/one meal, miss late full meals, use current time for historical open shifts, and do not persist the defined violation model.
- The 4h45 warning broadcasts immediately at clock-in rather than being durably scheduled.

**Required patch**

Use cryptographically random six-digit PINs with Argon2id/pepper hash and a keyed lookup tag; use opaque QR tokens; default certifications to pending/false; authenticate kiosk devices; add credential/device lockout and a distributed limiter. Model transactional shift state and idempotent punches, facility-timezone sessions across midnight, all meal segments, versioned union rules, persisted violations, and durable warning jobs.

### P0-09 — “Live WebSocket” is not a networked realtime system

**Evidence**

- `suite-hospitality.gateway.ts:1-35` is an in-process Node `EventEmitter`, not a Nest WebSocket/SSE gateway.
- No client subscribes to it, and Cloud Run replicas do not share it.
- KDS polls every 5 seconds while labeling itself `LIVE WEBSOCKET`; suite attendant polls every 4 seconds.
- Poll failures erase the last-known orders rather than preserving stale data with a degraded indicator.

**Required patch**

Implement authenticated WebSocket or SSE channels scoped to organization/facility/zone/event, with Redis Pub/Sub or another shared adapter, a transactional outbox, monotonic event sequence, initial snapshot, gap detection/refetch, and stale-state UI. Until deployed and tested across two API replicas, label the screens as polling.

### P0-10 — Event-state controls allow illegal overrides and normal UI transitions fail

**Evidence**

- `event-state.ts:17-26` permits any otherwise-illegal transition when a nonempty reason is supplied, including `archived → live` or `closed → draft`.
- The helper does not know whether the caller is authorized to override.
- `app/(tabs)/facility.tsx:27,150` uses legacy `planning → ready` and `live → completed`, mapping to skipped `planning → pre_open` and `live → closed` without a reason.
- The API reads state and then updates without compare-and-swap; concurrent transitions can both pass stale validation.

**Required patch**

Use an explicit override-transition map, elevated role check, mandatory reason, state version, and conditioned update. Drive the UI from all eight canonical states: `draft → planning → approved → pre_open → live → closing → closed → archived`.

### P0-11 — Production does not contain the current stadium feature set

**Evidence**

- The deployed image is built from committed `main` at `49eec99`.
- Closeout, plan-snapshot, pilot-health, NFL-brief, integration-readiness, and offline work is uncommitted in the reviewed tree.
- Production migrations lack the two current local migrations and their tables.

**Consequence**

Any claim that the deployed pilot supports the current 7–10 feature set is inaccurate. Shipping the working tree immediately would also ship the blockers above.

**Required patch**

Do not deploy the working tree as-is. First split the work into reviewable migrations/features, add integration tests and rollback plans, remediate P0 controls, then deploy through one immutable release pipeline with a post-migration smoke test.

### P0-12 — SSO JIT account linking enables cross-organization account takeover

**Evidence**

- `User.email` is globally unique (`schema.prisma:386-409`).
- After only an administrator-configured domain suffix check, JIT provisioning finds and reuses the global User by email (`enterprise-sso.service.ts:209-243`).
- It creates the attacker's organization membership/profile/scope on that same global identity (`:251-281`).
- SSO administration is allowed by a broad admin helper that includes `manager` and `fnb_director` (`auth/roles.ts:4-6`; `enterprise-sso.service.ts:88-95`).
- Once linked, the guard accepts another active Profile belonging to that global User when its venue is selected (`auth.guard.ts:89-118,143-169`).

**Exploit path**

A manager in organization A configures an IdP and allowed domain matching a victim in organization B, signs an assertion for the victim's email, and causes JIT to reuse the victim's global user. The session can then select the victim's legitimate organization-B profile. This is a verified architectural exploit path, not merely a missing hardening control.

**Required patch**

Bind external identities exclusively to `(organizationId, providerId, issuer, immutableSubject)`. Never merge by email. If an email already exists, require a reauthenticated account-link ceremony plus explicit approval. Prove domain ownership rather than accepting a configured suffix. Consider organization-scoped principals so one compromised tenant cannot attach itself to another tenant's identity.

### P0-13 — SSO administrators can map identities above their own role ceiling

**Evidence**

- Managers and F&B directors can manage providers/mappings.
- Mapping DTOs accept any Prisma `Role`, including `platform_admin` (`enterprise-sso-admin.controller.ts:78-101,122-203`).
- Database SSO policies check scope matching but no target-role ceiling.

**Consequence**

An operational manager can configure an IdP group mapping that elevates their own account to a platform-wide role.

**Required patch**

Create a dedicated `sso.manage` capability limited to platform/organization administrators; enforce `targetRole <= actorRoleCeiling` in application code and a database procedure/trigger; require step-up authentication and immutable audit for provider, certificate, redirect, and mapping changes.

### P0-14 — A Supabase service-role credential has been exposed

The Supabase service-role token supplied earlier in this conversation must be treated as compromised. The repository scan found no tracked copy, but chat exposure alone is sufficient to require rotation.

**Required action**

Rotate/revoke the exposed service credential immediately, update Secret Manager and every workload that legitimately needs the replacement, redeploy, verify the old key is rejected, and review Supabase/PostgreSQL access logs from the time of exposure. Do not place the replacement in source, chat, Expo configuration, or any client bundle. Prefer a new Supabase secret key/runtime database role with the minimum privileges instead of another broadly privileged legacy service-role token.

## 5. P1 high-risk findings

### P1-01 — SSO synchronization retains stale scope and redirects lack client binding

- SAML response/assertion signature and `InResponseTo` checks, and OIDC state/nonce/PKCE controls, are positive.
- Login adds/updates the target `ScopeAssignment` but does not deactivate assignments removed by the identity provider (`:251-268`). Group narrowing therefore leaves stale privileges.
- Group mapping priority detects ambiguity, but entitlement replacement is not atomic with session issuance.
- `postLoginRedirectUri` accepts a general URL without an organization allowlist. A tenant admin can route the one-time login ticket fragment to an arbitrary origin.
- Under the intended non-bypass RLS role, public provider lookup/login-request/ticket paths cannot function: login request/ticket tables have no public bootstrap policies and provider policies require authenticated app context.

**Patch:** tag assignment provenance by provider/mapping, atomically replace/deactivate the complete provider-managed set at login, preserve separately tagged manual grants, and revoke sessions when effective scope narrows. Allow only pre-registered HTTPS origins/native schemes; bind the ticket to the redirect/client; expose public SSO through narrowly granted, audited security-definer functions or a dedicated auth principal.

### P1-02 — RBAC and zone scope are inconsistent

- Request scope contains venue/facility but no authoritative organization/zone context for PostgreSQL.
- Broad helpers such as `canManageVenue` permit manager roles without proving their assignment applies to the requested zone/outlet.
- Issue acknowledge/resolve paths validate broad role but not zone/outlet assignment.
- Suite and concourse list routes require a `zoneId:null` assignment when clients omit a zone; zone-only supervisors are blocked instead of receiving their assigned-zone union.
- Owner-user references are not consistently validated as active members of the same organization/facility.

**Patch:** resolve permitted scopes server-side from active assignments; filter facility-wide roles to all facility zones and zone roles to `zone_id IN (...)`; validate every referenced user/outlet/event using tenant-composite keys; add a centralized permission matrix with negative endpoint tests for every role.

### P1-03 — BEO lifecycle, finance, and delivery proof are not concurrency-safe

- `eventId` is optional and unlinked; KDS/runner clients request unfiltered facility history.
- Status and delivery transitions read then update unconditionally, so concurrent bumps can both succeed and create duplicate logs.
- Orders are created directly as confirmed with client-supplied totals. There is no draft approval, line-price recomputation, revision, tax/gratuity, invoice, payment, or refund ledger.
- Replenishment has no idempotency or acknowledge/fulfill path.
- A webhook is awaited after the database commit. Webhook failure returns an error even though the BEO already changed, so retry becomes ambiguous.
- Typed name/mock UI is presented as delivery proof.

**Patch:** require event scope; add a version/CAS transition and immutable status/outbox write in one transaction; recompute totals from authoritative line items; add draft/approval revisions and financial ledger; capture evidence artifact metadata/hash; implement replenishment lifecycle; deliver webhooks asynchronously from the outbox.

### P1-04 — Event issues lack SLA, realtime, and conflict controls

- EventIssue has useful tenant fields and a unique client mutation ID, but issue creation does not carry it on the first attempt.
- Acknowledge/resolve use stale read-then-update and can produce inconsistent status/timestamps under concurrency.
- Owner assignment is not fully tenant/scope validated.
- No acknowledgement deadline, resolution SLA, escalation timer, comments, attachments, push delivery, or persistent alert acknowledgement exists.
- Issue selection is derived from an overview that returns only future events; the event disappears at kickoff.
- `EventExecutionIncident` and `EventIssue` split the canonical live-issue workflow.
- The UI exposes no server-supported filters and the facility card does not surface the high/critical count it already receives.

**Patch:** make EventIssue canonical; use status-conditioned updates and idempotent create reread on unique conflict; add SLA timestamps/escalation jobs and audit entries; query active `pre_open/live/closing` events; show critical badges, filters, owner queue, and direct command-center actions.

### P1-05 — Pilot Health is expensive and can present misleading health

- It loads all nonarchived events plus readiness/issues/closeouts and aggregates them in application memory.
- Readiness combines historical and future events instead of a selected active event.
- Activity is capped at 200 rows and the returned array length is labeled as total activity.
- No Redis cache, invalidation, heartbeat/device freshness, polling/SSE, stale timestamp, or drilldown exists.

**Patch:** aggregate exact counts in SQL by active event; add event-scoped cache keys with mutation-driven invalidation; add device/outlet heartbeat and last-ingest age; expose generated-at/stale state and drilldowns. Do not cache authorization decisions or cross-tenant aggregate objects.

### P1-06 — Infrastructure has single points of failure and excessive workload authority

- API active revision: 1 CPU, 256 MiB, concurrency 80, effective max instances 1. Prisma production pool defaults to 3. This is a likely NFL-load bottleneck.
- Worker: one minimum instance, concurrency 1, 512 MiB, prefetch 50, same small Prisma pool.
- RabbitMQ: one classic-queue replica, one RWO disk, plaintext AMQP, floating management image tag, no PDB, anti-affinity, quorum queue, TLS, backup validation, or network policy.
- Redis: BASIC single-node tier and transit encryption disabled. Redis loss removes current idempotency/status state.
- Both workloads use the default compute service account. It has `run.admin` and `iam.serviceAccountUser`, so an API/worker compromise can administer Cloud Run and attach service accounts.
- API is publicly invokable; worker is correctly private.

**Patch:** create least-privilege per-workload service accounts; remove Cloud Run admin and service-account-user roles; use Secret Manager accessor only for named secrets. Run a three-node RabbitMQ quorum cluster with TLS/pinned image/PDB/anti-affinity/backups, or adopt a managed broker. Move Redis to HA with in-transit encryption. Right-size and autoscale API from tested p95/p99, not guesses.

### P1-07 — Queue implementation does not batch, recover, or prove latency

- Worker applies one PostgreSQL write/transaction per delivery; no batch write exists.
- Prefetch 50 can flood a connection pool of 3 and loses per-item ordering.
- API acceptance still performs multiple database reads plus Redis and a channel-wide `waitForConfirms()`.
- Producer/worker have no robust reconnect state machine, publish backpressure handling, graceful shutdown, or broker-aware readiness.
- Worker health returns 200 even after AMQP dies.
- Queue worker boots the full application context, including scheduled-job providers.
- No k6/Artillery/chaos harness substantiates the requested `<50 ms` latency. Even the warm health probe measured 104–114 ms from the audit client.

**Patch:** separate queues/worker pools by domain; use bounded micro-batches while preserving partition order; use publisher callbacks and backpressure; implement reconnect and readiness; isolate worker modules; instrument accept latency, end-to-end latency, queue lag, redelivery, duplicate suppression, and DLQ. Gate launch on p95/p99 plus zero-loss/zero-duplicate invariants.

### P1-08 — Inventory alerts and movement quantities can be wrong

- Synchronous inventory writes emit low-stock/large-loss alerts; worker writes do not.
- Both paths clamp on-hand to zero but record the full requested negative quantity. Example: on-hand 2, requested -10 records ten consumed while stock changes by two.

**Patch:** persist `requested_quantity` and `applied_quantity`, enforce an explicit insufficient-stock policy, and create alerts/outbox events in the same transaction as the movement.

### P1-09 — Union and labor calculations will not scale

- A 500-worker report performs roughly 1,500 queries.
- Time boundaries ignore facility timezone/cross-midnight shifts.
- No robust meal-start/meal-end/checkout UX exists.
- Global in-memory `300/min/IP` throttling can block thousands of workers behind stadium NAT while remaining inconsistent across Cloud Run instances.

**Patch:** batch-fetch workers, punches, assignments, and union configs; calculate versioned sessions in facility timezone; add required punch actions; use a Redis-backed limiter keyed separately by kiosk device, credential, and authenticated subject, with brute-force protection distinct from operational throughput.

### P1-10 — Integration readiness is self-declared

- POS and reservation “connected” state can be written directly by the client without an authenticated provider handshake or successful ingest.
- Integration Readiness trusts those stored labels.
- Enterprise webhook handling only creates `pending_manual_export`; no worker, CSV download endpoint, or exported/failed lifecycle exists.

**Patch:** use server-owned `configured → authenticated → healthy/stale/error` states based on signed ingest/heartbeat; show last successful ingest and lag; implement audited CSV import/export jobs until provider auth exists; label unavailable providers honestly.

### P1-11 — Two outlet taxonomies divide the operational truth

- `FnbOperationUnit` powers EventIssue, EventFnbReadiness, and NFL activation.
- Canonical hierarchical `Outlet` powers stand sheets and newer facility operations.
- Hierarchical Facility CRUD/onboarding is incomplete; much of the structure depends on migration/bootstrap data.

**Patch:** standardize `Organization → Facility → FacilityZone → SubVenue → Outlet → Terminal` for every module. Migrate legacy IDs through an explicit mapping table and transitional compatibility view, then retire `FnbOperationUnit` as an independent operational root.

### P1-12 — NFL orchestration is a static brief, not a live phase controller

- Halftime is hard-coded to kickoff plus two hours.
- No persistent current phase, official clock/run-of-show input, delay, overtime, fourth-quarter drain, alcohol cutoff, audit override, or role action exists.
- Any generic `game` event qualifies as NFL.

**Patch:** add versioned `EventGamePhase` state, approved run of show, manual override reason/audit, delay/overtime controls, Q4 drain, alcohol cutoff, current issues/readiness, and one-tap role-appropriate actions. CSV/manual timing is acceptable until an authenticated game-clock provider exists.

### P1-13 — Authentication lockout and session lifetime need privileged-user hardening

- Login records `lockedUntil`, but the successful credential path does not reject a currently locked account (`auth.controller.ts:170-223,866-893`). Rate limiting only partially mitigates the six-digit credential space.
- JWT/session lifetime is 30 days for PIN and SSO sessions (`auth.module.ts:10-19`; `auth.controller.ts:801-836`).
- JWT verification does not explicitly pin algorithm, issuer, or audience (`auth.guard.ts:56-60`).
- Role/scope/PIN changes do not consistently revoke all affected sessions.

**Patch:** atomically enforce lockout before password/PIN verification; use generic timing-safe responses; shorten privileged access tokens and rotate refresh sessions; require MFA/passkey or enterprise SSO for administrators; revoke on credential/role/scope change; pin algorithm, issuer, and audience and use environment-specific rotating asymmetric keys.

### P1-14 — New venue onboarding does not populate the canonical hierarchy

- The hierarchy migration backfilled only venues existing at migration time.
- Current registration creates Organization, Venue, Subscription, and Profile but not Facility, default zone, OrganizationMembership, or ScopeAssignment (`app.controller.ts:278-400`).

**Consequence:** post-migration venues are incomplete for canonical RLS/SSO scope and force continued reliance on legacy Profile authorization.

**Patch:** create Organization, Venue/Facility, default zone, membership, scope assignment, profile, and subscription atomically; test immediate use under the non-owner runtime role.

### P1-15 — Tenant ancestry and security audit coverage are incomplete

- EventIssue, VenueEvent, and EventCloseout independently store organization/venue/event IDs without composite ancestry foreign keys. A privileged import or code bug can persist inconsistent tenants and fool policies that trust denormalized columns.
- `EventAuditLog` is immutable, but provider, mapping, identity, membership, scope, PIN, and session changes lack a complete immutable organization security log.

**Patch:** add composite ancestor unique keys/foreign keys and derive tenant IDs server-side; add an append-only security audit record containing actor, session, request ID, scope, reason, and before/after hashes; reject update/delete with database triggers and export to tamper-evident retention.

### P1-16 — Auth guard and venue interceptor can resolve different active venues

- The guard selects the header/JWT venue and binds it to tenant context.
- When the header is absent, `VenueScopeInterceptor` independently queries and chooses the oldest profile rather than consuming the guard's resolved venue (`venue-scope.interceptor.ts:40-75`).

**Patch:** resolve identity and complete scope exactly once in the guard; store immutable resolved IDs on the request; prohibit downstream fallback venue selection.

## 6. Accounting discrepancy register

| Area | Current discrepancy | Financial effect | Required control |
|---|---|---|---|
| Stand-sheet revenue | UI starts at hard-coded $2,450 | False actual revenue | Authoritative POS import/manual attestation with source ID |
| Count reconciliation | Missing values default/derive from empty variance | False sold/waste/shrink quantities | Required normalized count lines and conservation checks |
| Transfer | Destination append without source debit | Inventory is created | Double-entry inventory ledger and exactly-once receipt |
| Concurrent restock | JSON read/modify/write | One receipt can disappear | Normalized immutable ledger lines |
| Queued decrement | Requested -10 may apply -2 but records -10 | Usage/shrink overstated | Requested versus applied quantity |
| Hawker settlement | Theoretical gross; cash/card not tied | Unexplained cash variance/commission | Collected tender ledger and finance variance approval |
| BEO total | Client supplies confirmed total | Price/tax/gratuity manipulation | Server-side line pricing and versioned invoice |
| Closeout | Optional/manual totals overwrite one row | Empty or rewritten P&L | Immutable sourced closeout revisions and approval |
| Labor | UTC/partial punch pairing | Under/overstated hours and penalties | Facility-timezone shift session ledger |
| Integration status | User can mark source “connected” | Unsupported trust in stale/manual data | Health based on signed ingest/heartbeat |

## 7. Mobile and event-day UX review

### Authenticated browser result

Sign-in succeeded at the configured local origin and routed to `/home`. The browser reported zero errors and five nonblocking Expo/web deprecation warnings. A second dev server on port 8082 failed CORS because the production allowlist permits only local port 8081; this is expected from `cors-origin.ts` but creates avoidable developer confusion.

### High-friction findings

1. **Mixed product model.** The main navigation still exposes `Legacy floor`, `Legacy reservations`, CRM, general chat, restaurant-oriented service cards, covers/VIPs/seated counts, and “Clear table 3” next to stadium F&B.
2. **Hidden stadium workflows.** No discoverable links were found for KDS, suite attendant, stand sheet, commissary, staff kiosk, or labor dashboard. They behave like prototype routes rather than one role-based game-day product.
3. **Facility state mismatch.** The visible facility control uses legacy statuses and cannot follow the server state machine normally.
4. **Empty pilot context.** The authenticated pilot venue showed 0 zones and no scheduled stadium events, while the home card claimed 100% readiness. Empty data must be `Not configured`, not `100% ready`.
5. **Unsafe poll UX.** KDS/runner erase last-known data on transient failure and claim WebSocket synchronization despite polling.
6. **Mobile density.** The stand sheet is an eight-column non-scrollable table; the kiosk forces a side-by-side layout; many controls are not optimized for gloved/one-handed game-day use.
7. **Role mismatch.** The same broad tab set is shown instead of a role-specific Game Day hub for director, concourse supervisor, chef, warehouse, suite manager, finance, or auditor.
8. **Accessibility/branding.** The turf sign-in screen uses low-contrast dark text and transparent inputs on a visually busy background; the supplied full logo retains a white rectangle. Post-login screens revert to a mostly white restaurant-era command surface. Branding identifiers remain inconsistent: package name `venueflow-app`, iOS bundle `com.stadiumwrangler.app`, Android package `com.venuewrangler.app`, and stadium-named assets under the current Venue Wrangler Enterprise brand.
9. **Action legality.** Suite attendant can offer delivery in states the API rejects; commissary skips `in_transit`; KDS and active-event selectors are not reliably event/zone scoped.

### Required navigation model

Add one role-filtered **Game Day** entry point without redesigning the established visual system. It should expose only authorized and currently actionable modules:

- Command Center
- Event phase and readiness
- My assigned zones/outlets
- Issues and alerts
- Checklists / opening
- Inventory transfers / counts / 86s
- KDS / runner / premium delivery
- Commissary / production
- Staff kiosk / labor exceptions
- Closeout, only for authorized finance/director roles
- Sync queue/conflicts and data freshness

## 8. Positive controls worth preserving

- The full unit suite and TypeScript/API builds pass.
- API production dependency audit reports zero known vulnerabilities.
- Expo Doctor reports the installed SDK package set as compatible.
- Composite tenant hierarchy constraints exist on several newer operational models.
- Newer stadium-operation migrations enable and force RLS on their tables.
- `EventAuditLog` has a database trigger blocking update/delete.
- EventIssue already has a useful `(organizationId, clientMutationId)` uniqueness concept.
- SAML requires signed response/assertion and `InResponseTo`; OIDC includes state, nonce, and PKCE.
- Session lookup supports server-side revocation rather than trusting a long-lived JWT alone.
- Money is generally modeled as integer cents.
- The queue worker is private and has minimum instances/always-allocated CPU.
- BEO and event state transition maps exist and should be tightened rather than replaced.

## 9. Actionable patch proposals

The snippets below are implementation designs, **not changes applied by this review**. They show the minimum shape of the first patches; each requires integration tests before deployment.

### Patch A — restore safe production behavior immediately

```diff
# Cloud Run API and worker environment
- HIGH_VOLUME_QUEUE_ENABLED=true
+ HIGH_VOLUME_QUEUE_ENABLED=false
```

Re-enable only after P0-02 through P0-04 pass real Redis/Rabbit/PostgreSQL integration tests.

### Patch B — allow stable client idempotency headers

```diff
 type RequestOptions = {
   method?: "GET" | "POST" | "PATCH" | "DELETE";
   body?: unknown;
   signal?: AbortSignal;
   timeoutMs?: number;
+  headers?: Record<string, string>;
 };

 headers: {
   Accept: "application/json, text/csv;q=0.9, text/plain;q=0.8",
   ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
   ...(token ? { Authorization: `Bearer ${token}` } : {}),
   ...(venueId ? { "X-Venue-Id": venueId } : {}),
+  ...options.headers,
 },
```

Generate the UUID before the first attempt, store it with the mutation, and reuse it for every retry. Do not generate it inside `apiRequest`.

### Patch C — share Rabbit topology

```diff
+export const HIGH_VOLUME_QUEUE = 'stadium.high-volume-writes.v1';
+export const HIGH_VOLUME_QUEUE_OPTIONS = {
+  durable: true,
+  deadLetterExchange: 'stadium.writes.dlx',
+  deadLetterRoutingKey: 'failed',
+} as const;

-await channel.assertQueue(QUEUE, { durable: true, deadLetterExchange: 'stadium.writes.dlx', deadLetterRoutingKey: 'failed' });
+await channel.assertQueue(HIGH_VOLUME_QUEUE, HIGH_VOLUME_QUEUE_OPTIONS);

-await channel.assertQueue('stadium.high-volume-writes.v1', { durable: true });
+await channel.assertQueue(HIGH_VOLUME_QUEUE, HIGH_VOLUME_QUEUE_OPTIONS);
```

### Patch D — make PostgreSQL the idempotency authority

```sql
CREATE TABLE async_write_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','completed','failed_permanent')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, kind, idempotency_key)
);
```

The worker must insert/claim the receipt and apply the domain ledger in the same PostgreSQL transaction. A matching duplicate is acknowledged from the stored result; a different hash is a conflict and dead-lettered.

### Patch E — reject arbitrary event-state jumps

```diff
-export function assertEventTransition(from, to, reason?) {
+export function assertEventTransition(from, to, options: {
+  reason?: string | null;
+  canOverride: boolean;
+}) {
   if (from === to) return;
   const permitted = TRANSITIONS[from].includes(to);
-  if (!permitted && !reason?.trim()) throw ...;
+  const overridePermitted = OVERRIDE_TRANSITIONS[from]?.includes(to) ?? false;
+  if (!permitted && (!overridePermitted || !options.canOverride)) {
+    throw new BadRequestException(`Transition ${from} -> ${to} is not permitted.`);
+  }
+  if ((!permitted || isPostApprovalRollback(from, to)) && !options.reason?.trim()) {
+    throw new BadRequestException('An audited reason is required.');
+  }
 }
```

Persist `stateVersion` and update with `WHERE id = ? AND state_version = ?`; return `409` when another operator won the transition.

### Patch F — request-bound RLS context

```sql
ALTER ROLE stadium_api NOBYPASSRLS NOSUPERUSER;
REVOKE CREATE ON SCHEMA public FROM stadium_api;
ALTER TABLE event_issue FORCE ROW LEVEL SECURITY;
-- Repeat with explicit policies for every tenant table before credential cutover.
```

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SET LOCAL ROLE stadium_api`;
  await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.facility_id', ${facilityId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.zone_ids', ${zoneIds.join(',')}, true)`;
  return requestContext.run({ prisma: tx }, next);
});
```

Every repository/service must obtain Prisma from the request context; otherwise `SET LOCAL` will not govern its queries. Public SSO bootstrap requires a separate, narrowly granted path rather than a bypass role.

### Patch G — immutable financial revisions

```sql
CREATE TABLE event_closeout_revisions (
  event_id text NOT NULL,
  version integer NOT NULL,
  organization_id text NOT NULL,
  venue_id text NOT NULL,
  payload jsonb NOT NULL,
  source_checksums jsonb NOT NULL,
  adjustment_reason text,
  approved_by_user_id text NOT NULL,
  previous_hash text,
  revision_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, version),
  UNIQUE (revision_hash)
);
```

Add triggers that reject `UPDATE` and `DELETE`; derive totals server-side and require a new revision for every adjustment.

## 10. Remediation execution plan

### Phase 0 — containment, 0–48 hours

1. Disable high-volume queue mode.
2. Freeze production closeout/reconciliation claims; label current modules demo-only.
3. Remove migration execution from API startup and rotate to separate runtime/migrator database credentials.
4. Replace the default compute service account on both workloads with least-privilege identities.
5. Prevent new production temp-staff PIN issuance until hashing/randomization and certification defaults are fixed.
6. Capture a database backup and migration inventory before further schema work.

### Phase 1 — security and durable write foundation

1. Complete RLS policies and runtime-role integration tests.
2. Add request-bound organization/facility/zone context.
3. Implement durable idempotency receipts/outbox and shared Rabbit topology.
4. Replace the offline queue with a transactional, tenant-bound engine and conflict UI.
5. Add queue/DLQ/broker/Redis/PostgreSQL readiness and metrics.
6. Correct SSO account linking, assignment replacement, and redirect allowlisting.

### Phase 2 — accounting and compliance foundation

1. Normalize inventory, transfer, stand-sheet, hawker, BEO, punch, and closeout ledgers.
2. Add conservation/checksum/immutability constraints and finance approval.
3. Secure temp-staff credentials and make punches/union rules idempotent and timezone-correct.
4. Standardize the canonical facility-zone-outlet hierarchy.

### Phase 3 — live event operations

1. Implement authenticated cross-replica realtime transport with outbox/sequence recovery.
2. Repair canonical event states and issue SLA/escalation.
3. Add persistent NFL phase/run-of-show controls.
4. Create a role-based Game Day hub and expose only legal actions for assigned scope.
5. Make Pilot Health event-scoped, cached, fresh, and drillable.

### Phase 4 — verification and pilot rehearsal

1. PostgreSQL integration tests with the exact non-bypass runtime role.
2. Rabbit startup-order, redelivery, Redis-outage, poison-message, DLQ, and ambiguity tests.
3. Offline restart, concurrent flush, account switch, ordering, and safety-conflict tests.
4. Accounting property tests for inventory/cash conservation and immutable closeout.
5. Timezone/midnight/meal/punch concurrency tests.
6. Two-replica realtime reconnect and sequence-gap tests.
7. Mobile E2E per role on iOS and Android.
8. NFL-shaped load/soak/chaos test, including thousands of kiosk users behind one NAT.

## 11. Pilot acceptance gates

Do not begin a live controlled pilot until all are true:

- [ ] Runtime PostgreSQL role is `NOBYPASSRLS`, has no DDL, and cross-tenant negative tests pass.
- [ ] API containers no longer run migrations.
- [ ] Queue topology boots in either order and durable receipt tests prove no lost/duplicate write.
- [ ] Offline writes survive restart and account switch without cross-tenant replay; conflicts are visible and non-destructive.
- [ ] Transfer/stand/hawker/closeout conservation and immutability tests pass.
- [ ] Temp-staff credentials are random/hashed; certification defaults and alcohol assignment checks are correct.
- [ ] Punch and union calculations pass concurrency, timezone, midnight, and meal tests.
- [ ] Event-state transitions use role-aware CAS and the mobile UI follows every canonical state.
- [ ] High/critical issues have durable SLA/escalation and visible event-command alerts.
- [ ] Realtime works across at least two API replicas and recovers sequence gaps.
- [ ] RabbitMQ/Redis no longer have an unmitigated single-node failure mode.
- [ ] Workload identities are least privilege.
- [ ] Production and source commits/migrations are identical and traceable.
- [ ] Load test meets approved p95/p99 SLOs with zero lost/duplicate financial, inventory, or labor writes.
- [ ] Stadium operations, finance, food safety, alcohol compliance, security, and IT each sign the rehearsal results.

## 12. Final architecture verdict

The application should be treated as a promising stadium-operations prototype with several strong control primitives, not yet as an enterprise event-day platform. The fastest safe route is not a UI rewrite. It is to make tenant context enforceable in PostgreSQL, establish durable/idempotent ledgers, then connect the existing screens to one canonical event/zone/outlet model and a real realtime/offline transport.

Once the P0 foundation is complete, the current feature set can support a controlled rehearsal. Until then, a live NFL event risks cross-tenant exposure, rejected clock/inventory writes, duplicate or lost updates, incorrect payroll/inventory/revenue results, and misleading “live/ready” operational status.

## 13. Exact local validation commands

```powershell
npm run typecheck
npm test
npm test -- --coverage
npm run api:build
npm run doctor -- --verbose
npm audit --omit=dev --workspace=@venue-wrangler/api --json
npm audit --omit=dev --json
git diff --check
```

Production inspection used read-only `gcloud run services describe`, `gcloud projects get-iam-policy`, `gcloud redis instances describe`, `gcloud container clusters list`, PostgreSQL catalog queries, and five unauthenticated `GET /api/health` requests. Secret values were never printed into this artifact. Browser verification used a local Expo web server and Playwright against `http://127.0.0.1:8081`; no application mutations were performed.
