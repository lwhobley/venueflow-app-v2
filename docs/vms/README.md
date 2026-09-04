# Vendor Management System — user and operator guide

The VMS handles multi-agency staffing for stadium and arena operations: vendor
directory, worker roster, requisitions and bids, assignments, time & attendance,
payroll export, and inventory sync.

- **API reference:** [`openapi.yaml`](./openapi.yaml) — 53 documented endpoints.
  Import it into Postman, Insomnia or Bruno as-is.
- **Integration setup:** [`integration-guides.md`](./integration-guides.md) —
  Yellow Dog, ADP, Gusto.
- **Operator console:** *Stadium → Vendor Management* in the app.

> **Not included:** video walkthroughs. The step-by-step flows below are written
> to stand alone without them, but if your rollout plan calls for video, that is
> still outstanding.

---

## Glossary

| Term | Meaning here |
| --- | --- |
| **Vendor** | A staffing agency, labour contractor, supplier, security firm or cleaning crew. Identified by a `code` that is unique per venue. |
| **Staff member / worker** | An individual who can be scheduled. May be internal or supplied by a vendor. |
| **Requisition / staffing order** | A request for *N* workers in a role, on a date, for a shift window. |
| **Fulfillment / bid** | A vendor's offer against an order: headcount and hourly rate. |
| **Assignment** | The link between a named worker and an order. Without it, nobody is expected on the shift, and a no-show cannot be attributed to a person. |
| **Punch** | One clock-in/clock-out pair, stored as an attendance record. |
| **Deviation flag** | A marker on an attendance record: `no_show`, `off_site_punch`, `meal_break_penalty`, `overtime`, `double_time`, `unfilled_shift`, `geofence_unconfigured`. |
| **Scorecard** | Per-vendor fulfillment rate, on-time rate, no-show count and total billed. |

---

## Roles and what each can do

| | Venue Admin / Owner / Manager | Other venue members |
| --- | --- | --- |
| Vendors, staff, orders, analytics, audit | Full access | No access (`403`) |
| Clock a worker in/out | Yes, without a credential | Only with the worker's PIN or badge |
| Notification preferences | Own preferences | Own preferences |

The venue is taken from the caller's token, never from a request parameter, so
there is no way to address another venue's data by changing an ID.

---

## Setting up a new venue

1. **Add vendors.** *Vendors → New vendor*, or bulk import:

   ```
   POST /v1/vms/vendors/import
   { "csv": "name,code,contactEmail\nApex Staffing,APEX,ops@apex.test\n" }
   ```

   Required columns are `name` and `code`; optional are `vendorType`,
   `contactName`, `contactEmail`, `contactPhone`. Codes already in use are
   skipped and reported, so re-running the same file is safe.

2. **Add rate cards.** For each vendor, add one service per role
   (`POST /vendors/{id}/services`) with an hourly rate, overtime rate and
   minimum notice. Vendor matching and bid comparison both read these.

3. **Import the roster.** *Staff → Import*, columns: `firstName`, `lastName`,
   `email`, `phone`, `skills` (semicolon-separated), `hourlyRateCents`,
   `vendorCode`, `badgeNumber`. Duplicates are detected on name + email.

4. **Set worker credentials.** Give each worker a PIN or a badge number.
   Without one, that worker cannot be clocked in by anyone but a manager. PINs
   are stored as scrypt hashes and are never returned by any endpoint — if a
   worker forgets theirs, set a new one.

5. **Set the venue's coordinates.** Geofencing needs `latitude`/`longitude` on
   the facility. Until they are set, every punch is flagged
   `geofence_unconfigured` and location is not enforced.

6. **Save order templates** for your recurring shapes — game day, private
   event, seasonal. Creating from a template takes one call instead of ten
   fields.

---

## Running an event

### 1. Raise the requisition

*Orders → New order*, or from a template, or in plain English:

```
POST /v1/vms/orders/ai-parse
{ "naturalLanguagePrompt": "Find me 10 bartenders for Saturday night" }
```

The parser returns a draft you can edit before submitting. If the AI provider
is unavailable it falls back to keyword extraction rather than failing.

Creating an order emails venue managers (`order_submitted`).

### 2. Collect and compare bids

Ask the system who to route to:

```
POST /v1/vms/orders/{id}/match
```

You get up to a ranked list with a fit score, a recommended rate, and the
reasoning behind each — including risk factors like "quoted rate exceeds target
budget ceiling". Record each vendor's response as a bid; every bid emails
managers (`bid_received`).

### 3. Confirm

Accepting a bid recomputes fulfilled headcount and moves the order to `booked`
or `confirmed` depending on whether the requested count is met. Managers get
`order_confirmed`.

### 4. Assign named workers — do not skip this

```
POST /v1/vms/orders/{id}/assignments
{ "staffMemberId": "..." }
```

Assignment is what makes the rest of the system work:

- Shift reminders go to assigned workers 24 hours ahead.
- No-show detection can name who failed to appear.
- The availability calendar can show conflicts.

If the worker is inside an unavailable window or already booked that day, the
call is refused with the reason. Re-submit with `"force": true` to override —
the override and its reason are stored on the assignment.

An order you confirm but never assign is still tracked: the shortfall is
recorded against the **vendor**, with no worker named.

### 5. On the day

Workers clock in at the kiosk with their PIN or badge. Managers can punch on
someone's behalf. The system records device, GPS and time, and flags:

- `off_site_punch` — more than 500 m from the venue.
- `meal_break_penalty` — 5+ hours worked with under 30 minutes of break.
- `overtime` / `double_time` — past 8 and 12 billable hours.

Five failed credential attempts lock that worker out for 15 minutes. The counter
lives in the database, so it holds across restarts and multiple servers.

### 6. Close out

Review flagged records under *Time & Attendance* and approve them. Then export:

- **ADP:** `GET /v1/vms/attendance/payroll/adp` → CSV with REG/OT/DT earnings
  codes and a separate MEAL_PENALTY line.
- **Gusto:** `GET /v1/vms/attendance/payroll/gusto` → JSON with period-bounded
  gross pay.

---

## What runs on its own

| Job | Frequency | What it does |
| --- | --- | --- |
| No-show sweep | Every 30 min | Flags assigned workers who never punched, and confirmed headcount that was never assigned. Emails managers. |
| Fulfillment escalation | Hourly | Emails managers about orders starting within 48 hours that are still short. |
| Certification expiry | Daily, 07:00 | Emails managers about certifications lapsing within 30 days. |
| Shift reminders | Daily, 08:00 | Emails assigned workers about tomorrow's shifts. |

All four are idempotent. To force a run: `POST /v1/vms/maintenance/run-sweeps`.

Anyone can opt out per event type under *Notifications → Preferences*. Opt-outs
are recorded in the delivery log as `suppressed` rather than vanishing, so
"why didn't I get told?" is answerable.

---

## FAQ

**A vendor's on-time rate shows as blank rather than a number.**
That vendor has no measurable history yet. The scorecard returns `null` and
`hasData: false` instead of inventing a figure. It fills in once punches exist.

**I recorded a no-show but the scorecard didn't change.**
Check that the shift had *assignments*. Absences are attributed to assigned
workers; if nobody was assigned, the shortfall is attributed to the vendor
through the confirmed bid instead — which does count, but only if a bid was
confirmed.

**Why can't I delete a vendor?**
Deletion is refused while the vendor has active or confirmed fulfillments, so
history is not lost. Use *Deactivate* — it keeps every record and can be undone.

**Why was my order status change rejected?**
Transitions are constrained. `completed` and `cancelled` are terminal. The error
message lists the moves allowed from the current state.

**A worker can't clock in.**
In order of likelihood: no PIN or badge on file; wrong PIN; locked out after
five failures (wait 15 minutes or have a manager punch them in); or they already
have an open punch that was never closed.

**Inventory says `demo_mode`.**
`YELLOW_DOG_API_URL` and `YELLOW_DOG_API_KEY` are not set, so the run used the
baseline catalogue and did not contact Yellow Dog. It is labelled rather than
reported as a successful sync.

**Emails aren't arriving.**
Check `RESEND_API_KEY` is set, then the delivery log
(`GET /v1/vms/notifications/log`) — it records `sent`, `failed` (with the
provider's error) and `suppressed` (opt-out) for every attempt.

**Can I get the audit trail for an auditor?**
`GET /v1/vms/audit-logs/export?startDate=…&endDate=…&format=csv`. Entries cannot
be edited or deleted — a database trigger rejects both.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `403` on every VMS call | Not a manager role | Grant `manager`, `admin` or `owner` on the venue |
| `403` "Worker locked out" | 5 failed punch attempts | Wait 15 minutes, or punch as a manager |
| `400` "already has an active clock-in" | Previous punch never closed | Clock out the open record, then retry |
| `400` "Break minutes cannot exceed total shift duration" | Break longer than the shift | Correct the break, or fix the clock-in time first |
| `400` on assignment | Availability or double-booking conflict | Pick another worker, or re-submit with `force: true` |
| `500` "Unable to record the audit entry" | Audit write failed; the operation was rolled back | Check database health — this is deliberate, not a partial write |
| Punches never flagged off-site | Facility has no coordinates | Set `latitude`/`longitude` on the facility |
| Payroll export missing rows | Only `approved` and `clocked_out` records export; unstaffed shortfalls never do | Approve the outstanding records |

---

## Admin runbook

### Deploy

```bash
npm run typecheck          # app + API, both must pass
npm test                   # full suite
npm run release -w @venue-wrangler/api   # asserts DB target, then migrate deploy
```

Migrations are additive and forward-only. Never edit an applied migration — add
a new one; Prisma checksums each file and will refuse to deploy on drift.

### Environment

| Variable | Required | Effect if absent |
| --- | --- | --- |
| `DATABASE_URL` | Yes | API will not start |
| `RESEND_API_KEY` | For email | Notifications log as `failed` |
| `EMAIL_FROM` | Recommended | Falls back to a default sender |
| `GEMINI_API_KEY` | For AI features | Matching, parsing and forecasting use deterministic fallbacks |
| `GEMINI_VMS_MODEL` | No | Defaults to `gemini-flash-latest` |
| `YELLOW_DOG_API_URL` / `_API_KEY` | For live inventory | Sync runs in `demo_mode` |
| `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | For SMS | SMS logs as `suppressed` |

Secrets live in the platform's secret store, never in the repository.

### Tenant isolation

Every VMS table has RLS enabled and forced, with a `stadium_api` policy keyed on
`app_private.scope_matches(organizationId, facilityId)`. Two child tables
(`VmsVendorService`, `VmsOrderFulfillment`) scope through their parent.

Adding a VMS table means all four of: the model, the migration with
`ENABLE`/`FORCE ROW LEVEL SECURITY` + policy + `GRANT ... TO stadium_api`,
registration in `FACILITY_SCOPED_MODELS`, and a passing
`tenant-scope.spec.ts`. That spec fails loudly if you forget the third.

### Backup and recovery

The database is the only stateful component; VMS holds no local files. Restore
is a standard point-in-time restore. After restoring, re-run
`POST /v1/vms/maintenance/run-sweeps` so detection catches up on anything the
gap missed — the sweeps are idempotent, so this is always safe.

### Monitoring

Watch for:

- `VmsSchedulerService` errors — a sweep failed for a facility.
- `Failed to record audit log` — audit writes failing; operations are being
  rolled back.
- Rows in `VmsNotificationLog` with `status = 'failed'` — email delivery is
  degraded.
- `VmsInventorySyncLog` rows with `status = 'failed'` — the Yellow Dog endpoint
  is rejecting or unreachable.

### Known limits

- Load has not been measured at the 100/500 concurrent-user targets.
- Payroll export is on demand; there is no scheduled push into ADP or Gusto.
- Yellow Dog sync is one venue per credential pair; multi-account is not built.
- There is no mobile kiosk UI yet — the PIN/badge contract is server-side only.
