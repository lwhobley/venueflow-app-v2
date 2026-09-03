-- Upgrade app_private tenant helper functions and apply hierarchical RLS policies.
-- Safe to apply with current database roles; prepares for NOBYPASSRLS stadium_api cutover.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_organization_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_facility_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.facility_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_venue_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.venue_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_private.current_zone_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.zone_id', true), '')
$$;

-- Verified check: actor is an active organization administrator, platform admin, or owner.
CREATE OR REPLACE FUNCTION app_private.can_manage_memberships()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."OrganizationMembership" membership
    WHERE membership."organizationId" = app_private.current_organization_id()
      AND membership."userId" = app_private.current_user_id()
      AND membership."status" = 'active'
      AND membership."role" IN ('platform_admin', 'organization_admin', 'owner', 'admin')
  );
$$;

-- Verified check: actor holds an active operational management role.
CREATE OR REPLACE FUNCTION app_private.can_operate_scope()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."OrganizationMembership" membership
    WHERE membership."organizationId" = app_private.current_organization_id()
      AND membership."userId" = app_private.current_user_id()
      AND membership."status" = 'active'
      AND membership."role" IN (
        'platform_admin', 'organization_admin', 'owner', 'admin', 'fnb_director',
        'event_manager', 'outlet_manager', 'executive_chef', 'warehouse_manager',
        'premium_manager', 'manager'
      )
  );
$$;

-- Verified check: hierarchical scope matches via active membership and ScopeAssignment.
CREATE OR REPLACE FUNCTION app_private.scope_matches(
  row_organization_id text,
  row_facility_id text DEFAULT NULL,
  row_zone_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    row_organization_id = app_private.current_organization_id()
    AND (
      row_facility_id IS NULL
      OR app_private.current_facility_id() IS NULL
      OR row_facility_id = app_private.current_facility_id()
      OR row_facility_id = app_private.current_venue_id()
    )
    AND (
      row_zone_id IS NULL
      OR app_private.current_zone_id() IS NULL
      OR row_zone_id = app_private.current_zone_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public."OrganizationMembership" membership
      JOIN public."ScopeAssignment" assignment
        ON assignment."organizationId" = membership."organizationId"
       AND assignment."membershipId" = membership."id"
       AND assignment."active" = true
      WHERE membership."organizationId" = row_organization_id
        AND membership."userId" = app_private.current_user_id()
        AND membership."status" = 'active'
        AND (
          row_facility_id IS NULL
          OR assignment."facilityId" IS NULL
          OR assignment."facilityId" = row_facility_id
        )
        AND (
          row_zone_id IS NULL
          OR assignment."zoneId" IS NULL
          OR assignment."zoneId" = row_zone_id
        )
    );
$$;

-- Verified check: legacy venue scope matches via active Profile.
CREATE OR REPLACE FUNCTION app_private.venue_matches(row_venue_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    row_venue_id = app_private.current_venue_id()
    AND EXISTS (
      SELECT 1
      FROM public."Profile" profile
      WHERE profile."venueId" = row_venue_id
        AND profile."userId" = app_private.current_user_id()
        AND (profile."membershipStatus" IS NULL OR profile."membershipStatus" = 'active')
    );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- Policies for Hierarchical Tables (Organization, Facility, Zone, ScopeAssignment, OrganizationMembership)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    GRANT USAGE ON SCHEMA app_private TO stadium_api;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO stadium_api;

    -- Organization policies
    ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS organization_read_scope ON "Organization";
    CREATE POLICY organization_read_scope ON "Organization"
      FOR SELECT TO stadium_api
      USING (app_private.scope_matches("id", NULL, NULL));

    DROP POLICY IF EXISTS organization_write_scope ON "Organization";
    CREATE POLICY organization_write_scope ON "Organization"
      FOR ALL TO stadium_api
      USING (app_private.scope_matches("id", NULL, NULL) AND app_private.can_manage_memberships())
      WITH CHECK (app_private.scope_matches("id", NULL, NULL) AND app_private.can_manage_memberships());

    -- Facility policies
    ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS facility_read_scope ON "Facility";
    CREATE POLICY facility_read_scope ON "Facility"
      FOR SELECT TO stadium_api
      USING (app_private.scope_matches("organizationId", "id", NULL));

    DROP POLICY IF EXISTS facility_write_scope ON "Facility";
    CREATE POLICY facility_write_scope ON "Facility"
      FOR ALL TO stadium_api
      USING (app_private.scope_matches("organizationId", "id", NULL) AND app_private.can_manage_memberships())
      WITH CHECK (app_private.scope_matches("organizationId", "id", NULL) AND app_private.can_manage_memberships());

    -- Zone policies. The zone table was renamed "Zone" -> "FacilityZone" in
    -- migration 20260812120000_hierarchical_facility_scope, which already
    -- ENABLEs + FORCEs RLS and defines facility_zone_read_scope /
    -- facility_zone_write_scope on "FacilityZone". These statements referenced
    -- the pre-rename name and therefore failed with `relation "Zone" does not
    -- exist` on any database that never carried the legacy table (i.e. every
    -- clean deploy), blocking the whole migration. Guard on the legacy table's
    -- existence so this is a no-op on current schemas and still applies on any
    -- environment that predates the rename, without altering FacilityZone's
    -- existing authorization (see venue-wrangler-sweep report VW-SWEEP-019).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Zone'
    ) THEN
      ALTER TABLE "Zone" ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS zone_read_scope ON "Zone";
      CREATE POLICY zone_read_scope ON "Zone"
        FOR SELECT TO stadium_api
        USING (app_private.scope_matches("organizationId", "facilityId", "id"));

      DROP POLICY IF EXISTS zone_write_scope ON "Zone";
      CREATE POLICY zone_write_scope ON "Zone"
        FOR ALL TO stadium_api
        USING (app_private.scope_matches("organizationId", "facilityId", "id") AND app_private.can_operate_scope())
        WITH CHECK (app_private.scope_matches("organizationId", "facilityId", "id") AND app_private.can_operate_scope());
    END IF;

    -- Venue policies
    ALTER TABLE "Venue" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS venue_read_scope ON "Venue";
    CREATE POLICY venue_read_scope ON "Venue"
      FOR SELECT TO stadium_api
      USING (app_private.venue_matches("id"));

    DROP POLICY IF EXISTS venue_write_scope ON "Venue";
    CREATE POLICY venue_write_scope ON "Venue"
      FOR ALL TO stadium_api
      USING (app_private.venue_matches("id"))
      WITH CHECK (app_private.venue_matches("id"));

    -- OrganizationMembership policies
    ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS membership_read_scope ON "OrganizationMembership";
    CREATE POLICY membership_read_scope ON "OrganizationMembership"
      FOR SELECT TO stadium_api
      USING ("userId" = app_private.current_user_id() OR ("organizationId" = app_private.current_organization_id() AND app_private.can_manage_memberships()));

    DROP POLICY IF EXISTS membership_write_scope ON "OrganizationMembership";
    CREATE POLICY membership_write_scope ON "OrganizationMembership"
      FOR ALL TO stadium_api
      USING ("organizationId" = app_private.current_organization_id() AND app_private.can_manage_memberships())
      WITH CHECK ("organizationId" = app_private.current_organization_id() AND app_private.can_manage_memberships());

    -- ScopeAssignment policies
    ALTER TABLE "ScopeAssignment" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS scope_assignment_read_scope ON "ScopeAssignment";
    CREATE POLICY scope_assignment_read_scope ON "ScopeAssignment"
      FOR SELECT TO stadium_api
      USING (
        EXISTS (
          SELECT 1 FROM "OrganizationMembership" m
          WHERE m."id" = "ScopeAssignment"."membershipId" AND m."userId" = app_private.current_user_id() AND m."status" = 'active'
        )
        OR ("organizationId" = app_private.current_organization_id() AND app_private.can_manage_memberships())
      );

    DROP POLICY IF EXISTS scope_assignment_write_scope ON "ScopeAssignment";
    CREATE POLICY scope_assignment_write_scope ON "ScopeAssignment"
      FOR ALL TO stadium_api
      USING ("organizationId" = app_private.current_organization_id() AND app_private.can_manage_memberships())
      WITH CHECK ("organizationId" = app_private.current_organization_id() AND app_private.can_manage_memberships());

    -- ConcourseOutlet policies. No "ConcourseOutlet" relation exists in the
    -- current schema; concourse outlets are the "Outlet" table, which already
    -- carries stadium_api ENABLE/FORCE RLS + scope policies from migration
    -- 20260812120000_hierarchical_facility_scope. This stale name failed with
    -- `relation "ConcourseOutlet" does not exist` on every clean deploy. Guard
    -- on existence so it is a no-op on current schemas without weakening the
    -- already-protected Outlet table (see report VW-SWEEP-019).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ConcourseOutlet'
    ) THEN
      ALTER TABLE "ConcourseOutlet" ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS concourse_outlet_scope ON "ConcourseOutlet";
      CREATE POLICY concourse_outlet_scope ON "ConcourseOutlet"
        FOR ALL TO stadium_api
        USING (app_private.scope_matches("organizationId", "facilityId", "zoneId"))
        WITH CHECK (app_private.scope_matches("organizationId", "facilityId", "zoneId"));
    END IF;

    -- StandSheet policies
    ALTER TABLE "StandSheet" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS stand_sheet_scope ON "StandSheet";
    CREATE POLICY stand_sheet_scope ON "StandSheet"
      FOR ALL TO stadium_api
      USING (app_private.scope_matches("organizationId", "facilityId", NULL))
      WITH CHECK (app_private.scope_matches("organizationId", "facilityId", NULL));

    -- ShiftPunch policies
    ALTER TABLE "ShiftPunch" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS shift_punch_scope ON "ShiftPunch";
    CREATE POLICY shift_punch_scope ON "ShiftPunch"
      FOR ALL TO stadium_api
      USING (app_private.scope_matches("organizationId", "facilityId", "zoneId"))
      WITH CHECK (app_private.scope_matches("organizationId", "facilityId", "zoneId"));

    -- WorkerProfile policies
    ALTER TABLE "WorkerProfile" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS worker_profile_scope ON "WorkerProfile";
    CREATE POLICY worker_profile_scope ON "WorkerProfile"
      FOR ALL TO stadium_api
      USING (app_private.scope_matches("organizationId", "facilityId", NULL))
      WITH CHECK (app_private.scope_matches("organizationId", "facilityId", NULL));

    -- SuiteBeoOrder policies
    ALTER TABLE "SuiteBeoOrder" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS suite_beo_order_scope ON "SuiteBeoOrder";
    CREATE POLICY suite_beo_order_scope ON "SuiteBeoOrder"
      FOR ALL TO stadium_api
      USING (app_private.scope_matches("organizationId", "facilityId", NULL))
      WITH CHECK (app_private.scope_matches("organizationId", "facilityId", NULL));

    -- Profile policies
    ALTER TABLE "Profile" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS profile_scope ON "Profile";
    CREATE POLICY profile_scope ON "Profile"
      FOR ALL TO stadium_api
      USING (app_private.venue_matches("venueId"))
      WITH CHECK (app_private.venue_matches("venueId"));

    -- TimeEntry policies
    ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS time_entry_scope ON "TimeEntry";
    CREATE POLICY time_entry_scope ON "TimeEntry"
      FOR ALL TO stadium_api
      USING (app_private.venue_matches("venueId"))
      WITH CHECK (app_private.venue_matches("venueId"));

    -- BarInventoryItem policies
    ALTER TABLE "BarInventoryItem" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS bar_inventory_scope ON "BarInventoryItem";
    CREATE POLICY bar_inventory_scope ON "BarInventoryItem"
      FOR ALL TO stadium_api
      USING (app_private.venue_matches("venueId"))
      WITH CHECK (app_private.venue_matches("venueId"));

    -- Table policies. No "Table" relation exists; the floor/dining domain uses
    -- "TableState", "TableAssignment", "TableStateHistory" and "FloorChair".
    -- This stale name failed with `relation "Table" does not exist` on every
    -- clean deploy. Guarded to a no-op here. NOTE (report VW-SWEEP-020): the
    -- real floor tables have RLS enabled but do NOT yet carry stadium_api
    -- policies, so they will fail-closed (return zero rows) under a NOBYPASSRLS
    -- runtime role — a follow-up migration must add their policies before the
    -- role cutover, or the floor feature breaks for the stadium_api role.
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Table'
    ) THEN
      ALTER TABLE "Table" ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS table_scope ON "Table";
      CREATE POLICY table_scope ON "Table"
        FOR ALL TO stadium_api
        USING (app_private.venue_matches("venueId"))
        WITH CHECK (app_private.venue_matches("venueId"));
    END IF;

    -- Reservation policies
    ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS reservation_scope ON "Reservation";
    CREATE POLICY reservation_scope ON "Reservation"
      FOR ALL TO stadium_api
      USING (app_private.venue_matches("venueId"))
      WITH CHECK (app_private.venue_matches("venueId"));

    -- CrmLead policies
    ALTER TABLE "CrmLead" ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS crm_lead_scope ON "CrmLead";
    CREATE POLICY crm_lead_scope ON "CrmLead"
      FOR ALL TO stadium_api
      USING (app_private.venue_matches("venueId"))
      WITH CHECK (app_private.venue_matches("venueId"));
  END IF;
END
$$;
