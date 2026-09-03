-- Complete stadium_api RLS policy coverage for venue-scoped tenant tables.
--
-- Context: migration 20260805120000 ENABLEd RLS on every public table, and
-- 20260903120000 added stadium_api policies for the hierarchy tables plus a
-- representative set of venue-scoped tables. That left 64 venue-scoped tenant
-- tables with RLS enabled but NO stadium_api policy. Under the NOBYPASSRLS
-- stadium_api runtime role those tables deny ALL access (fail-closed), which
-- would break ~73% of the tenant data surface at cutover. This migration adds a
-- uniform tenant-isolation policy to each so legitimate venue members retain
-- access while cross-tenant access stays denied.
--
-- Safe to apply under the current (bypass) role: guarded on the stadium_api
-- role existing, and purely additive (the tables already deny-all for
-- stadium_api). Every listed table carries a "venueId" column (verified against
-- VENUE_SCOPED_MODELS in packages/api/src/prisma/tenant-scope.ts). The policy
-- reuses app_private.venue_matches(), which also requires an active Profile
-- membership for the venue.
--
-- NOTE (report VW-SWEEP-021): a few of these tables back PRE-membership /
-- self-service flows (Invite, WorkplaceJoinRequest, Subscription, PushToken).
-- venue_matches() denies access to a user who has no active Profile at the
-- venue yet, so those bootstrap paths must run through a reviewed
-- SECURITY DEFINER function (not BYPASSRLS) before the runtime role is switched
-- to stadium_api. This migration is a security backstop, not a substitute for
-- that review.

DO $$
DECLARE
  t text;
  venue_scoped text[] := ARRAY[
    'AiBudgetReservation',
    'AiUsageEvent',
    'AuditLog',
    'Availability',
    'BarInventoryMovement',
    'BlackoutDate',
    'ChatImage',
    'ChecklistCompletion',
    'ChecklistTemplateItem',
    'Conversation',
    'ConversationRead',
    'CrmActivityLog',
    'CrmBeo',
    'CrmContract',
    'CrmNote',
    'EmailTemplate',
    'EventAuditLog',
    'EventExecutionIncident',
    'EventExecutionTask',
    'EventExecutionTimelineItem',
    'EventExecutionVendor',
    'EventExecutionWorkspace',
    'EventIssue',
    'FloorChair',
    'FloorPlan',
    'FnbOperationUnit',
    'FnbPartner',
    'Guest',
    'Invite',
    'Invoice',
    'LogbookEntry',
    'ManagerGoal',
    'Message',
    'NotificationEvent',
    'NotificationRead',
    'PaymentMethod',
    'PayrollExport',
    'PosAggregatorChannel',
    'PosCheck',
    'PosConnection',
    'PosLaborPunch',
    'PrepBoardItem',
    'PushToken',
    'ReservationConnection',
    'ReservationHold',
    'ReservationSetting',
    'ReservationSyncEvent',
    'ScheduleEmailEvent',
    'ScheduleMemoryNote',
    'ScheduleShift',
    'ScheduleTemplate',
    'ShiftSwap',
    'StaffOnboardingTask',
    'StaffRequest',
    'Subscription',
    'SubscriptionEvent',
    'TableAssignment',
    'TableState',
    'TableStateHistory',
    'Team',
    'VenueDocument',
    'VenueRole',
    'Waitlist',
    'WorkplaceJoinRequest'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    RAISE NOTICE 'stadium_api role absent; skipping tenant RLS policy coverage (applied at cutover).';
    RETURN;
  END IF;

  FOREACH t IN ARRAY venue_scoped LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION 'Expected venue-scoped table %.% not found', 'public', t;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO stadium_api '
      'USING (app_private.venue_matches("venueId")) '
      'WITH CHECK (app_private.venue_matches("venueId"))',
      t || '_tenant_scope', t
    );
  END LOOP;
END
$$;
