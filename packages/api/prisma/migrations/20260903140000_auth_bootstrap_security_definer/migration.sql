-- RLS cutover: auth bootstrap SECURITY DEFINER functions.
--
-- Context (report VW-SWEEP-023): AuthGuard's very first two database calls —
-- looking up the Session row by id, then the requester's Profile — run BEFORE
-- any tenant context exists: they are what DISCOVERS the venueId, so no
-- app.venue_id GUC can be bound yet. "Session" and "User" carry RLS (enabled
-- by 20260805120000) with ZERO stadium_api policies (they are deliberately
-- absent from VENUE_SCOPED_MODELS/FACILITY_SCOPED_MODELS — see
-- tenant-scope.ts — because they are global, not tenant-owned). Under
-- PostgreSQL, RLS enabled + no matching policy denies ALL rows to a
-- non-superuser/non-BYPASSRLS role. And Profile's own policy (profile_scope,
-- 20260903120000) requires app.venue_id to already equal the row's venueId —
-- which is exactly what this lookup exists to determine.
--
-- Net effect, verified locally against a real NOBYPASSRLS stadium_api role:
-- EVERY authenticated request would return 0 rows on its first query and
-- fail with 401, for 100% of traffic — not just the narrower pre-membership
-- flows (Invite/WorkplaceJoinRequest/etc.) called out in the cutover runbook.
--
-- Fix: two narrow, parameterized SECURITY DEFINER functions performing
-- exactly AuthGuard's two lookups (nothing dynamic, no caller-supplied SQL).
-- A SECURITY DEFINER function runs with its OWNER's privileges. Session/User/
-- Profile have RLS ENABLEd but not FORCEd, so PostgreSQL already exempts the
-- table OWNER from RLS on them — meaning if these functions are created by
-- whichever role owns these tables (stadium_migrator, once Phase 0 of
-- docs/rls-cutover-runbook.md runs migrations under that role), they read
-- correctly with NO GUC required and WITHOUT granting BYPASSRLS to any LOGIN
-- role. This keeps the elevated surface to exactly these two read-only,
-- parameter-bound functions instead of the runtime role itself.
--
-- All application business logic (venue fallback, membershipStatus filtering,
-- ordering, token-hash comparison) stays in AuthGuard's TypeScript — these
-- functions are dumb, auditable data accessors, not a reimplementation of
-- auth logic in SQL.
--
-- Safe on any database, cutover or not: SECURITY DEFINER doesn't require the
-- CALLER to be privileged, so these work identically under today's bypass
-- role too. Purely additive; nothing calls them until the API code is updated
-- separately to use them (see auth.guard.ts).

CREATE OR REPLACE FUNCTION app_private.auth_lookup_session(p_session_id text)
RETURNS TABLE ("userId" text, "expiresAt" timestamptz, "tokenHash" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s."userId", s."expiresAt", s."tokenHash"
  FROM public."Session" s
  WHERE s.id = p_session_id;
$$;

-- Also returns the joined Venue fields AuthGuard's profileSelect needs
-- (name, subscriptionStatus, organizationId). Venue carries its own
-- stadium_api policy requiring app.venue_id/app.organizationId to already be
-- bound (venue_matches, 20260903120000) — exactly the chicken-and-egg this
-- bootstrap RPC exists to break — so a separate raw Venue read from AuthGuard
-- would hit the identical deadlock. One SECURITY DEFINER call covers both.
CREATE OR REPLACE FUNCTION app_private.auth_lookup_profiles(p_user_id text, p_venue_id text DEFAULT NULL)
RETURNS TABLE (
  "id" text,
  "email" text,
  "fullName" text,
  "role" "Role",
  "allAccess" boolean,
  "trialEndsAt" timestamptz,
  "venueId" text,
  "venueName" text,
  "venueSubscriptionStatus" text,
  "venueOrganizationId" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p."id", p."email", p."fullName", p."role", p."allAccess", p."trialEndsAt", p."venueId",
    v."name", v."subscriptionStatus", v."organizationId"
  FROM public."Profile" p
  LEFT JOIN public."Venue" v ON v."id" = p."venueId"
  WHERE p."userId" = p_user_id
    AND (p_venue_id IS NULL OR p."venueId" = p_venue_id)
    AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active')
  ORDER BY p."createdAt" ASC;
$$;

REVOKE ALL ON FUNCTION app_private.auth_lookup_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.auth_lookup_profiles(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    GRANT EXECUTE ON FUNCTION app_private.auth_lookup_session(text) TO stadium_api;
    GRANT EXECUTE ON FUNCTION app_private.auth_lookup_profiles(text, text) TO stadium_api;
  END IF;
END
$$;
