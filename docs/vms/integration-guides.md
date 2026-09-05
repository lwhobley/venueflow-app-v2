# VMS integration guides

Setup and verification for the three external systems the VMS talks to.

---

## Yellow Dog — inventory

### What is implemented

Two-way sync against a single endpoint:

- **Outbound:** the catalogue (or the items you pass) is `POST`ed to
  `{YELLOW_DOG_API_URL}/v1/inventory/sync` with a bearer token.
- **Inbound:** the response body is parsed and adopted as the current stock
  snapshot.
- **Failure handling:** 5-second timeout, one retry on a transport error, no
  retry on a non-2xx (that is a decision by the remote, not a blip).
- **Status:** derived from the call, never from configuration — `success`,
  `failed`, or `demo_mode` when credentials are absent.

### Configure

```bash
YELLOW_DOG_API_URL=https://your-tenant.yellowdogsoftware.example
YELLOW_DOG_API_KEY=<api key>
```

Restart the API, then:

```
POST /v1/vms/integrations/sync
{ "system": "yellow_dog", "syncType": "shift_supplies" }
```

Expect `"status": "success"` and a message naming the number of imported line
items. Then `GET /v1/vms/inventory/status` to see the snapshot and the last ten
sync log entries.

### Expected response shape

Either a bare array or `{ "items": [...] }`. Each entry needs at minimum `sku`
and `name`; anything else falls back to zero:

```json
{
  "items": [
    {
      "sku": "YD-UNI-STAD-01",
      "name": "Stadium Staff Polo (Black)",
      "category": "uniform",
      "allocatedQuantity": 140,
      "consumedQuantity": 132,
      "remainingStock": 420,
      "unitCostCents": 1850
    }
  ]
}
```

`category` accepts `uniform`, `equipment`, `ppe`, `cutlery`, `disposable`;
anything else becomes `equipment`. `remainingStock` also accepts
`quantityOnHand`, and `unitCostCents` also accepts `unitCost`. Rows without a
`sku` and `name` are dropped rather than imported as phantoms.

### Verify

| Check | How |
| --- | --- |
| Credentials work | Sync returns `success`, not `failed` |
| Import works | The message reports imported line items, and `inventory/status` reflects the remote's numbers |
| Failures are visible | Unset the API key, sync, confirm `demo_mode` and that nothing claims success |
| Errors are recorded | Point the URL at an unreachable host; the log row is `failed` with the transport error |

### Not implemented

Incremental/delta sync (every run is a full push), scheduled background sync
(trigger it or call the endpoint), multiple Yellow Dog accounts per venue, and
credential storage beyond environment variables. The endpoint path is our
convention — confirm it against your Yellow Dog contract before go-live.

---

## ADP Workforce Now — payroll

### What is implemented

On-demand CSV export shaped for Workforce Now import.

```
GET /v1/vms/attendance/payroll/adp
Accept: text/csv
```

### Format

One row per earnings code per shift:

| Column | Notes |
| --- | --- |
| Co Code | Company code, defaults to `VNW` |
| Batch ID | `BATCH-YYYY-MM-DD` from the shift date |
| File Number | Last 6 of the worker ID, uppercased |
| Employee Name | `Last, First`, quoted |
| Earnings Code | `REG`, `OT`, `DT` or `MEAL_PENALTY` |
| Hours | 2 decimal places |
| Hourly Rate | `$0.00` |
| Total Pay | `$0.00` |
| Shift Date | `YYYY-MM-DD` |

Splits are: up to 8 hours `REG`, 8–12 `OT` at 1.5×, past 12 `DT` at 2×. A missed
statutory meal break adds a one-hour `MEAL_PENALTY` row at base rate.

Only `approved` and `clocked_out` records export. Unstaffed shortfalls — which
have no worker — are excluded, so payroll never sees a phantom employee.

### Set up

1. In ADP, confirm your company code and swap it in if it is not `VNW`.
2. Confirm your File Number convention matches the last-6 derivation, or map it
   on import.
3. Confirm `REG`/`OT`/`DT` exist in your earnings-code table, and add
   `MEAL_PENALTY` (or map it to your equivalent premium code).

### Verify

Run five shifts including one over 8 hours and one with a short break, export,
and check: the long shift produces both a `REG` and an `OT` row; the short-break
shift produces a `MEAL_PENALTY` row; hours reconcile against
`GET /v1/vms/attendance/reports` for the same period.

### Not implemented

No API push — export and upload. No scheduled delivery, and no read-back from
ADP into the VMS.

---

## Gusto — payroll

### What is implemented

On-demand JSON export over a trailing 14-day period.

```
GET /v1/vms/attendance/payroll/gusto
```

```json
{
  "records": [
    {
      "employeeId": "ckstaff123",
      "employeeName": "Rosa Klein",
      "regularHours": 8,
      "overtimeHours": 1.5,
      "doubleTimeHours": 0,
      "hourlyRate": 32,
      "grossPay": 328,
      "periodStart": "2026-08-21",
      "periodEnd": "2026-09-04"
    }
  ],
  "totalHours": 9.5,
  "totalGrossPayCents": 32800
}
```

Same 8/12-hour split and multipliers as ADP. `employeeId` is the VMS staff ID —
map it to your Gusto employee ID on import.

### Verify

Complete five shifts, export, and reconcile `totalHours` against the attendance
report for the same window. Confirm each `grossPay` equals
regular + 1.5× overtime + 2× double-time at that worker's rate.

### Not implemented

No API push and no scheduled sync — same shape as ADP. Gusto's own API would
also need an employee-ID mapping table, which does not exist yet.

---

## Reconciliation

The VMS applies each vendor's `billingRateMultiplier` when a punch opens, so
`billedRateCents` is the marked-up rate and `totalBilledCents` is what the
vendor should invoice.

To reconcile against an invoice, pull `GET /v1/vms/attendance/reports` for the
period and compare `totalBilledCents` per vendor with the invoice total.

There is no automated invoice-matching or variance-flagging step — that
comparison is manual today.

---

## Email — Resend

```bash
RESEND_API_KEY=<key>
EMAIL_FROM="Your Venue <no-reply@yourvenue.com>"
```

Every VMS notification writes a row to `VmsNotificationLog` whether it succeeds,
fails or is suppressed by an opt-out. Check delivery with
`GET /v1/vms/notifications/log?status=failed`.

Broadcasts to multiple managers go out over BCC so recipients never see each
other's addresses.

## SMS — not configured

SMS is scoped to critical alerts only (`no_show_alert`,
`fulfillment_failure`) and requires per-recipient opt-in. With no provider
configured, eligible messages are logged as `suppressed` with the reason rather
than reported as sent. Wiring a provider means setting `TWILIO_AUTH_TOKEN` and
`TWILIO_FROM_NUMBER` and implementing the send call in
`VmsNotificationsService`; the preference, eligibility and logging paths are
already in place.
