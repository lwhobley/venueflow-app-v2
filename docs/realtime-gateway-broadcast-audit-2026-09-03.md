# Realtime Gateway Broadcast Audit

**Date:** 2026-09-03
**Scope:** `SuiteHospitalityGateway` (`suite-hospitality.gateway.ts`) and its only consumer, the SSE endpoint in `stadium-realtime.controller.ts`, plus all 16 broadcast call sites.
**Question:** does any gateway broadcast reach subscribers outside the tenant, facility, or department boundary the REST layer enforces?

**Answer: yes — on all three axes.** Four distinct leaks, each confirmed empirically against the real gateway and the real controller (temporary probe spec, removed after the run).

---

## 1. Executive Outcome

**`NOT READY` — one Critical cross-tenant leak, one High department-boundary gap.**

The gateway is not a NestJS WebSocket gateway; it is a plain `EventEmitter` with an optional Redis pub/sub fan-out, consumed by a single SSE route. Authorization is applied when a stream **ticket is issued** and when the SSE route is **entered**, and both checks are facility-aware. But the channel a subscriber is attached to is **not**, so the checks do not constrain what actually arrives.

Two independent root causes:

1. **Non-unique channel names.** The channel key is `zone:${zoneId}`, with no facility or tenant component. Real zone ids are cuids and therefore unique, but three call sites pass **hardcoded sentinel strings** as the zoneId — `'global'` and `'zone-central'` — which collide across every facility and every tenant.
2. **No department dimension.** The channel key has no department or operational-area component at all, so the boundary that R2-01/F-02 established for kitchen tickets in REST and RLS does not exist in realtime.

A telling asymmetry: the gap-recovery path, `getEventsSince(facilityId, lastSeq, zoneId)`, **does** filter by `facilityId` (`suite-hospitality.gateway.ts:164`). The live path does not. Replayed history is correctly scoped while live events are not — strong evidence this is an oversight in the live path rather than an intended design.

---

## 2. Findings

| ID | Severity | Finding |
|---|---|---|
| **RT-01** | **Critical** | Cross-tenant leak via the `'global'` sentinel zoneId |
| **RT-02** | **Critical** | Cross-tenant leak via the hardcoded `'zone-central'` zoneId |
| **RT-03** | **High** | Every kitchen/distro ticket without a zone falls into the shared `'global'` channel |
| **RT-04** | **High** | No department boundary in realtime — facility subscribers receive every department's tickets |
| **RT-05** | Low | `emitLocal` emits to a bare `global` channel that nothing subscribes to |

### RT-01 — Cross-tenant leak via the `'global'` sentinel (Critical)

`event-menu.service.ts:75` and `:92` pass the literal string `'global'` as the **zoneId**:

```ts
await this.wsGateway.broadcastBeoUpdate(dto.facilityId, 'global', { ... });
```

That reaches `emitLocal(facilityId, 'global', payload)`, which emits on `zone:global` — a channel name identical for every tenant. A subscriber from an unrelated tenant that requests `?zoneId=global` attaches to the same channel.

**Confirmed.** A `concourse_supervisor` at `facility-B` subscribed with `zoneId=global` received a `facility-A` BEO verbatim:

```json
{ "type": "suite_beo_updated",
  "data": { "data": { "beoNumber": "BEO-SECRET-A",
                      "guestName": "Tenant A VIP",
                      "totalCents": 250000 } } }
```

The attacker needs no special privilege — only an ordinary facility-wide `ScopeAssignment` in **their own** tenant. `assertZoneAssignment` (`stadium-realtime.controller.ts:146`) matches `{ OR: [{ zoneId: null }, { zoneId }] }`, and a facility-wide assignment has `zoneId: null`, so it satisfies the check for *any* requested zone id, including `'global'`.

Note this also defeats the stream ticket's facility binding. `verifyAndConsumeTicket` correctly rejects a ticket whose `facilityId` does not match the route (`:74`), but that binding is irrelevant once the subscriber is attached to a channel that is not facility-scoped.

### RT-02 — Cross-tenant leak via `'zone-central'` (Critical)

`concourse-inventory.service.ts:241` hardcodes a zone name rather than using a real zone id:

```ts
await this.wsGateway.broadcastReplenishment(dto.facilityId, 'zone-central', { ... });
```

Same mechanism as RT-01, different constant. **Confirmed:** a `facility-B` subscriber on `zoneId=zone-central` received `facility-A`'s replenishment payload (item name and outlet name).

### RT-03 — Zone-less distro tickets fall into the shared channel (High)

All nine `broadcastDistroPickupUpdate` call sites in `kitchen-distro-fulfillment.service.ts` pass `ticket.zoneId || ''`, and the gateway converts that to `'global'`:

```ts
zoneId: zoneId || 'global',                       // :243
this.publishCrossReplica(facilityId, zoneId || 'global', payload);  // :253
```

`KitchenFulfillmentTicket.zoneId` is nullable, so **every ticket without a zone** — which is the ordinary case for kitchen and distro work — is broadcast on the cross-tenant `zone:global` channel. **Confirmed:** a `facility-B` subscriber on `zoneId=global` received a `facility-A` distro ticket.

This is the highest-volume of the three cross-tenant paths, but rated High rather than Critical only because the payload is operational (item, quantity, status) rather than guest or financial data.

### RT-04 — No department boundary in realtime (High)

The channel key has no department or operational-area component, and no broadcast is filtered by one. A subscriber with **no** `zoneId` attaches to `facility:${facilityId}` and receives every event for that facility.

**Confirmed:** a culinary-only `concourse_supervisor` at `facility-A`, subscribed with no zoneId, received a concession ticket in full:

```json
{ "type": "distro_pickup_updated",
  "data": { "data": { "id": "ticket-concession-1",
                      "itemName": "Nachos",
                      "operationalAreaType": "concession" } } }
```

The REST layer denies this exact read (`assertTicketAccess` / `listTickets`), and so does the RLS policy added in migration `20260903190000`. **The realtime channel bypasses both.** Any department boundary in this product is currently only as strong as the client's willingness not to open the SSE stream.

### RT-05 — Dead `global` channel (Low)

`emitLocal` emits a third time on a bare `'global'` channel (`:173`). No subscriber uses it — the controller only ever builds `zone:${zoneId}` or `facility:${facilityId}`, so `'global'` is unreachable today. It is a landmine rather than a live defect: any future `gateway.on('global', ...)` would receive every event from every tenant.

---

## 3. What is correctly scoped

Stated so the report is not read as blanket condemnation:

- **Gap-recovery replay is facility-filtered.** `getEventsSince` rejects buffer entries whose `facilityId` differs (`:164`). Verified: replay for `facility-B` of a `facility-A` event returned zero entries.
- **Ticket issuance authorization is real.** Cross-facility ticket issuance requires `canAccessCrossFacilityRealtime` (`platform_admin` / `organization_admin` only), and zone-scoped tickets require assigned-scope authorization plus a matching `ScopeAssignment`.
- **The ticket→stream zone binding is enforced.** `ticketPayload.zoneId !== zoneId` is rejected (`:82`), closing the widening attack the comment there describes.
- **Ticket lifetime is bounded** — 60s expiry, single use, swept from the in-process map and TTL'd in Redis.

The authorization logic is sound. It is applied to the wrong thing: who may *open* a stream, rather than what that stream *carries*.

---

## 4. Recommended remediation

The root fix is one change: **make the channel name carry the full boundary, and stop using sentinel strings as zone ids.**

1. **Namespace every channel by tenant and facility.** Replace `zone:${zoneId}` / `facility:${facilityId}` with `${organizationId}:${facilityId}:zone:${zoneId}` and `${organizationId}:${facilityId}`. This alone closes RT-01, RT-02, RT-03 and RT-05 regardless of what any call site passes as a zone id, because a colliding sentinel can no longer collide across tenants. It requires threading `organizationId` into the gateway's broadcast signatures — the callers all have it.
2. **Remove the sentinel zone ids.** `event-menu.service.ts` should broadcast facility-wide (no zone) rather than to `'global'`; `concourse-inventory.service.ts` should pass the real zone id instead of `'zone-central'`. With (1) in place these are hygiene rather than security fixes, but the sentinels will otherwise keep re-creating the same class of bug.
3. **Add the department dimension (RT-04).** Either key kitchen/distro broadcasts by operational area — `...:area:${operationalAreaType}` — and have the SSE route subscribe only to the areas the caller's departments grant (the same `BASELINE_DEPARTMENT_AREAS` / `DepartmentAreaRule` source of truth the REST and RLS layers now use), or filter per-event in the SSE handler before `subscriber.next`. Channel-keying is preferable: it cannot be forgotten by a future broadcast call site.
4. **Delete the bare `global` emit** (`:173`).
5. **Make these probes permanent tests.** All four leak probes and the replay control are small and fast; they belong in `suite-hospitality.gateway.spec.ts` as negative assertions so a future call site cannot silently reintroduce a shared channel.

**Cross-replica note:** the Redis pub/sub path (`:55–80`) re-derives the channel from the message's `facilityId` / `zoneId` and calls the same `emitLocal`, so it inherits every one of these findings and is fixed by the same change. No separate work is needed, but the fix must be verified with Redis configured, not only in-process.

---

## 5. Gate

**`NOT READY`.** RT-01 and RT-02 are confirmed cross-tenant data leaks reachable by an ordinary authenticated user with no special role, and RT-04 nullifies the department boundary that the last two remediation rounds were specifically built to establish. These should be fixed before any multi-tenant environment carries real venue data.

Evidence for every finding in this document came from executing the real gateway and the real controller, not from reading them. The probe spec was temporary and has been removed; recommendation (5) above is to reinstate it as permanent coverage.
