# Repository review remediation — September 5, 2026

Starting revision: `944c58bbd26feb565f4874013b116cb791c29133`, branch `main`.
No production deployment, production migration, commit, or push was performed.

## Findings and disposition

| Review finding | Repository change | Remaining evidence / restriction |
|---|---|---|
| VW-SEC-001 | Existing-account SSO linking endpoint now fails closed after administrator authorization. It cannot look up or reassign a global account. | Existing users cannot be linked through this endpoint until a verified, user-consented link workflow exists. Review previously provisioned identity links before rollout; do not assume historical links are trustworthy. Provider-scoped JIT for genuinely new users remains available. |
| VW-MOB-001 | Generate one secure operation ID per mutation invocation; React Query retries and offline replay retain that ID. Native Expo UUID fallback handles Hermes without Web Crypto. | Repeated identical new actions must remain separate transactions. |
| VW-MOB-002 | Preserve other owners' pending rows; filter queue display/retry/dismiss by owner and venue. A delayed/conflicted predecessor blocks later writes to the same resource. | Run shared-device/restart testing on iPhone and Android. |
| VW-OPS-001 | Serialize closeout writes on the event row, append a hash-linked immutable checkpoint for every save/finalization, and serialize authorized adjustments. No revision UPDATE/upsert remains in this flow. | Tested against PostgreSQL with the actual immutability trigger. Existing draft checkpoints are preserved, not rewritten. |
| VW-OPS-002 | Clock-out uses an atomic open-row update and returns terminal/winning results without recalculating amounts or writing a second audit event. | Broker/network-response-loss rehearsal remains required. |
| VW-API-001 | Explicit attempt header, five retries, durable five-second delayed retry queue, publisher confirmation before acknowledging original, and DLQ on terminal failure. Health becomes unavailable on channel/connection failure. | Validate against the deployed RabbitMQ topology. If delayed republish cannot be confirmed, close the connection instead of hot-looping unacked work. |
| VW-API-002 | Worker result storage initializes Redis independently; accepted cache writes use NX; completed results cannot regress to retrying. | Real Redis/RabbitMQ fault-injection tests still required. |
| VW-3D-001 | Camera interpolation runs only for explicit transitions, cancels on control interaction, and reset has its own command token. | Physical rotation/pinch/pan/reset checks. |
| VW-3D-002 | Own independent mesh materials and release shared originals; centralized highlight/disposal helpers have actual-asset tests. | Visual/device memory confirmation. |
| VW-3D-003 | Apply current highlights immediately when real or fallback geometry attaches. | Cold-start visual test. |
| VW-3D-004 | Bind upper deck to the real operational ID; remove nonexistent commissary mapping. Bunkers explicitly have no geometry and remain accessible through the directory/Operations Map. Suite balconies map to the suite operational zone. | Add surveyed bunker geometry only when an authoritative asset is available. No fake selectable geometry was added. |
| VW-3D-005 | Guard asynchronous loader results after disposal/fallback, dispose late results, cancel rendering/listeners, and render only when the scene/camera changes. | Repeated navigation, background/foreground, low-memory profiling. |
| VW-3D-006 | Remove contradictory parent height, overlay loading content, scroll error content, enlarge controls, respect reduced motion, and pause rendering for native background/route blur. | Narrow-screen, large-text, VoiceOver/TalkBack, device checks. |
| VW-3D-007 | Resolve the selected unit's actual owning zone for all map/directory handoffs. Fixed duplicate demo upper-outlet IDs and added uniqueness coverage. | Exercise each premium group and modal return path. |
| VW-3D-008 | Incident severity precedes alert counts and selection; selection never hides critical/attention states. | Validate eventual live operational feed semantics; current map remains demo data. |
| VW-3D-009 | DOM-local boundary, asynchronous/context-loss error reporting, native loading watchdog, explicit simplified-model status, and always-present Operations Map action. | WebView process termination and renderer failure injection on devices. |
| VW-TENANT-001 | Added read-only database preflight and retained existing RLS cutover instructions/tests. | Production runtime role, policy coverage, ownership, and real cross-tenant request evidence remain unverified. |
| VW-DB-001 | Added duplicate open-punch preflight; API CI now asserts the partial unique index. | Do not apply the existing index migration to conflicting production data without an approved reconciliation plan. |
| VW-QA-001 | Added asset/material/identity/queue/SSO/attendance/closeout regressions and a real PostgreSQL closeout test. Mobile CI exports web, iOS and Android bundles. | Bundles are not physical-device execution or App Store build evidence. |

## Validation commands

Validation completed locally:

- Unit suite: 113 files passed; 1,159 tests passed, two skipped.
- Isolated PostgreSQL integration suite: two files and six tests passed. This does not establish production RLS behavior.
- Application typecheck, API lint/typecheck, and API build passed.
- Production bundle exports passed for web, iOS, and Android, including the DOM renderer and GLB asset. No physical-device test or store submission was performed.
- Diff whitespace check passed. The disposable PostgreSQL server was stopped after testing.

From the repository root:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run
npm run api:build
npm run lint -w @venue-wrangler/api
git -c core.whitespace=cr-at-eol diff --check
$env:CI='1'
node node_modules/expo/bin/cli export --platform all --max-workers 2 --output-dir .expo/review-export-final
```

From `packages/api`:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
# TEST_DATABASE_URL must name an isolated disposable test database, never production.
node ../../node_modules/vitest/vitest.mjs run --config ../../vitest.integration.config.ts src/modules/stadium/closeout-persistence.integration.spec.ts src/prisma/tenant-isolation.integration.spec.ts
```

The database test helper uses `prisma db push --accept-data-loss`; its target must be disposable. Local validation used a dedicated PostgreSQL instance bound to loopback, not the application's database. The closeout test applies the real immutable-trigger function inside a transaction and rolls back its synthetic fixture and trigger.

## Dependency audit restriction

`npm audit --omit=dev --audit-level=high` reached the registry only after a network permission escalation. It reported stale installed qs/xmldom packages despite the repository's existing overrides, a recursive URI decoder advisory, and image-size/Metro advisories.

- Metro now resolves the URI decoder to a bounded native `decodeURIComponent` wrapper. Valid URL components retain normal decoding. Malformed components are retained literally instead of recursively repaired; tests cover this intentional behavior.
- Existing Metro hardening disables the affected ICNS/JXL/HEIF image parsers. No clean image-size release was available in the audited registry response. Scanner findings remain visible; this is a mitigation, not an upstream dependency fix.
- `npm install --ignore-scripts --no-fund --no-audit` was blocked by the permission reviewer citing the earlier read-only restriction. No workaround was used and the lockfile was not rewritten. Obtain approval to synchronize dependencies, then rerun audit, all tests, typechecks and bundles.

## Production release gates

1. Approve and complete dependency/lockfile synchronization; document remaining upstream advisories without suppressing the scanner.
2. Review historical SSO identity links, restrict unsafe existing links, and revoke affected sessions through an approved process if needed. No automatic production account changes were made.
3. With explicitly reviewed connection targets, run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/pilot-database-preflight.sql`. Use the actual runtime role for role/policy evidence and a read-only privileged session for whole-database duplicate/migration evidence. A tenant-scoped zero count does not prove global uniqueness.
4. Confirm migration parity with the existing Prisma status command and run the RLS cutover verification against staging before any production role change.
5. Deploy matching API/worker versions together; verify delayed retry queue declaration, confirmed republish, terminal cache results, restart after broker loss, and DLQ recovery. Do not claim sub-50ms load latency without measurement.
6. On physical iPhone and Android: cold launch, model load offline, rotate/pinch/pan/reset, all supported zone selections, directory/modal handoff, missing/corrupt model, renderer failure, retry, 2D fallback, route switching, background/foreground, reduced motion, large text, narrow layout, and low-memory behavior.
7. Rehearse event setup through closeout using a controlled venue/event. Keep the Operations Map as the operational default and fallback. Static 3D/demo data is not a live event command center.
