# Stadium F&B controlled-pilot runbook

## 1. Before the pilot

1. Deploy the migration set, including `20260811160000_stadium_pilot_controls`, `20260812120000_hierarchical_facility_scope`, and `20260813100000_event_closeout_tenant_scope`.
2. Deploy the API revision with `TENANT_ISOLATION_ENFORCED=true`, `EXPECTED_SUPABASE_PROJECT_REF` set to the target project, and all database/S3/JWT secrets bound through Secret Manager.
3. Create a venue through the normal venue setup flow. It creates an organization root and assigns the venue to it.
4. Create departments and F&B operation units in F&B Ops. Give each outlet a stadium zone, department, code, and activation status.
5. Create an event as `draft`, supply event date/gates/expected attendance, then use **Generate F&B plan**. Treat plan numbers as manual planning recommendations until POS, recipe, inventory, and payroll imports are connected.
6. Verify that the event, at least one outlet, and one manager account are visible only from the intended venue account.

## 2. Event-state controls

Use the pilot lifecycle in this order:

`draft → planning → approved → pre_open → live → closing → closed → archived`

- A manager changes state through `PATCH /api/v1/stadium/events/:id/state` with `{ "state": "..." }`.
- After approval, any rollback or unsupported override must supply `{ "reason": "..." }`.
- Opening issues is blocked after `closed` or `archived`. Do not change closed operational data directly; record an authorized adjustment with a reason and audit entry.
- The legacy event-status endpoint remains only for compatibility and is routed through the same lifecycle checks.

## 3. Event-day operation

1. Set the event to `pre_open` after the director approves the plan.
2. Update each outlet's readiness under `PATCH /api/v1/stadium/events/:eventId/zones/:zoneId/readiness`.
3. Report an issue from a mobile client or operator workflow:

```json
POST /api/v1/stadium/events/:eventId/issues
{
  "outletId": "optional-outlet-id",
  "issueType": "stockout",
  "severity": "high",
  "title": "West Market water low",
  "description": "On-hand water will not cover the next service window."
}
```

4. Acknowledge with `PATCH /api/v1/stadium/issues/:id/acknowledge` and resolve with `PATCH /api/v1/stadium/issues/:id/resolve`, providing `resolutionNotes`.
5. Review issues through `GET /api/v1/stadium/events/:eventId/issues` and their immutable audit trail through `GET /api/v1/stadium/events/:eventId/audit`. High and critical issues should be treated as command-center priorities.

If connectivity drops while reporting an issue or updating readiness, the mobile client stores the write locally, shows it as pending, and retries when the app becomes active. Issue writes include a client mutation id so a retry cannot create a duplicate.

## 4. Closeout

1. Move the event to `closing` when service ends; resolve or explicitly document all remaining issues.
2. Complete manual inventory counts/transfers and enter actual sales/labor through the current inventory/POS/manual workflows. Do not rely on the event-plan response as actual financial data.
3. Open **Post-event → Forecast vs actual** in the event command center and save a draft closeout. Confirm attendance, sales, labor, inventory variance, and notes.
4. Move to `closed` only after the director approves operational closeout, then finalize the closeout record. Any later edit requires an adjustment reason and is audit logged. Archive only after review.
5. Preserve the EventAuditLog as the official record of event creation, lifecycle changes, readiness changes, issues, and closeout activity. It is database-immutable.

## 6. Integration and NFL game-day checks

1. Open **F&B Operations → Integrations** and confirm provider status, recent POS activity, inventory coverage, and CSV/manual fallback availability.
2. For a game event, open **NFL game-day brief** from the event command center. Review phase timing, outlet activation, open issues, and alcohol/food-safety/halftime controls.
3. Replace estimated halftime timing and weather assumptions with the official game operations run of show and venue safety procedures.

Generated plans are persisted as event plan snapshots and can be treated as the approved planning baseline. Actual sales, labor, and inventory remain in closeout until authenticated provider feeds are connected.

## 5. Pilot limitations and safety controls

- The shared offline queue currently covers event issues and outlet readiness; inventory transfers, 86s, and counts still require their existing manual fallback if venue connectivity is unreliable.
- Do not expose Supabase table access directly to the mobile app. The Cloud Run API is the approved data path.
- Do not connect a third-party POS, payroll, weather, or ticketing provider without authenticated integration setup. Use CSV/manual entry until then.
