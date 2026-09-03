-- RLS cutover: workforce join-request bootstrap SECURITY DEFINER.
--
-- Context (report VW-SWEEP-029): submitJoinRequest / approveJoinRequest /
-- rejectJoinRequest / cancelJoinRequest (workforce.controller.ts) all funnel
-- through request_join_workplace / approve_join_request / reject_join_request
-- / cancel_join_request (20260614000000_workforce_signup,
-- 20260804150000_harden_workforce_join_membership). These are exactly the
-- same bootstrap deadlock class as the auth lookups fixed in
-- 20260903140000: the requesting user has NO active Profile at the target
-- venue yet — that is the entire point of a join request — and
-- approve_join_request updates that user's Profile row from venueId = NULL
-- to the target venue. Profile's stadium_api policy (profile_scope,
-- venue_matches) evaluates against the ROW's CURRENT venueId, which is NULL
-- before approval; NULL never matches app_private.current_venue_id(), so the
-- USING clause hides the row from EVERY caller under stadium_api regardless
-- of who they are — not just the requester, but the approving manager too.
-- WorkplaceJoinRequestEvent (an audit trail with no venueId column at all,
-- and no other write path in the app — verified by grep) has RLS enabled
-- with zero policies, so it is unconditionally deny-all today.
--
-- These four functions already contain solid, narrow, already-tested
-- authorization logic: an advisory lock keyed to the requesting user
-- (request_join_workplace), explicit manager-role checks scoped to the
-- request's own venueId (approve/reject), an explicit actor-match check
-- (cancel — only the requester may cancel their own request), and FOR UPDATE
-- row locking throughout. This migration does not touch any of that logic —
-- it only adds SECURITY DEFINER so they run with their OWNER's privileges
-- (stadium_migrator, once Phase 0 of docs/rls-cutover-runbook.md reassigns
-- table/function ownership), which PostgreSQL already exempts from RLS on
-- these non-FORCE-RLS tables — the same mechanism the auth bootstrap
-- functions rely on. search_path was already pinned to a fixed, non-caller-
-- controlled value (`public, pg_temp` — see 20260805120000), so this is safe
-- against search-path injection without further changes.
--
-- Safe on any database, cutover or not: SECURITY DEFINER doesn't require the
-- CALLER to be privileged, so these behave identically under today's bypass
-- role. No application code changes — the controller already calls these by
-- name via $queryRaw.

ALTER FUNCTION public.request_join_workplace(TEXT, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.approve_join_request(TEXT, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.reject_join_request(TEXT, TEXT, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.cancel_join_request(TEXT, TEXT) SECURITY DEFINER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    GRANT EXECUTE ON FUNCTION public.request_join_workplace(TEXT, TEXT) TO stadium_api;
    GRANT EXECUTE ON FUNCTION public.approve_join_request(TEXT, TEXT) TO stadium_api;
    GRANT EXECUTE ON FUNCTION public.reject_join_request(TEXT, TEXT, TEXT) TO stadium_api;
    GRANT EXECUTE ON FUNCTION public.cancel_join_request(TEXT, TEXT) TO stadium_api;
  END IF;
END
$$;
