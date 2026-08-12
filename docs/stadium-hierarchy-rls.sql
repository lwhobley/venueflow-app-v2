-- REVIEW ARTIFACT — DO NOT EXECUTE DIRECTLY.
-- This is the target RLS policy pattern for the hierarchical tables. The final
-- Prisma migration must be generated after the expand/backfill schema has been
-- reviewed and must run only after a dedicated `stadium_api` PostgreSQL login
-- role exists with NOBYPASSRLS. The migration owner remains separate.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION app_private.current_zone_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('app.zone_id', true), '')
$$;

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
  )
$$;

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
  )
$$;

CREATE OR REPLACE FUNCTION app_private.scope_matches(
  row_organization_id text,
  row_facility_id text,
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
    )
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO stadium_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO stadium_api;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_read_scope ON "Organization"
  FOR SELECT TO stadium_api
  USING ((SELECT app_private.scope_matches("id", NULL, NULL)));
CREATE POLICY organization_write_scope ON "Organization"
  FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("id", NULL, NULL)) AND (SELECT app_private.can_manage_memberships()))
  WITH CHECK ((SELECT app_private.scope_matches("id", NULL, NULL)) AND (SELECT app_private.can_manage_memberships()));

ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;
CREATE POLICY facility_read_scope ON "Facility"
  FOR SELECT TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "id", NULL)));
CREATE POLICY facility_write_scope ON "Facility"
  FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "id", NULL)) AND (SELECT app_private.can_manage_memberships()))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", "id", NULL)) AND (SELECT app_private.can_manage_memberships()));

ALTER TABLE "FacilityZone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacilityZone" FORCE ROW LEVEL SECURITY;
CREATE POLICY facility_zone_read_scope ON "FacilityZone"
  FOR SELECT TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "id")));
CREATE POLICY facility_zone_write_scope ON "FacilityZone"
  FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "id")) AND (SELECT app_private.can_manage_memberships()))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "id")) AND (SELECT app_private.can_manage_memberships()));

ALTER TABLE "SubVenue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubVenue" FORCE ROW LEVEL SECURITY;
CREATE POLICY sub_venue_read_scope ON "SubVenue"
  FOR SELECT TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY sub_venue_write_scope ON "SubVenue"
  FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_manage_memberships()))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_manage_memberships()));

ALTER TABLE "Outlet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Outlet" FORCE ROW LEVEL SECURITY;
CREATE POLICY outlet_read_scope ON "Outlet"
  FOR SELECT TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY outlet_write_scope ON "Outlet"
  FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope()))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope()));

ALTER TABLE "Terminal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Terminal" FORCE ROW LEVEL SECURITY;
CREATE POLICY terminal_read_scope ON "Terminal"
  FOR SELECT TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY terminal_write_scope ON "Terminal"
  FOR ALL TO stadium_api
  USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope()))
  WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope()));

ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read_scope ON "OrganizationMembership"
  FOR SELECT TO stadium_api
  USING (
    "userId" = (SELECT app_private.current_user_id())
    OR (
      "organizationId" = (SELECT app_private.current_organization_id())
      AND (SELECT app_private.can_manage_memberships())
    )
  );
CREATE POLICY membership_write_scope ON "OrganizationMembership"
  FOR ALL TO stadium_api
  USING (
    "organizationId" = (SELECT app_private.current_organization_id())
    AND (SELECT app_private.can_manage_memberships())
  )
  WITH CHECK (
    "organizationId" = (SELECT app_private.current_organization_id())
    AND (SELECT app_private.can_manage_memberships())
  );

ALTER TABLE "ScopeAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScopeAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY scope_assignment_read_scope ON "ScopeAssignment"
  FOR SELECT TO stadium_api
  USING (
    EXISTS (
      SELECT 1
      FROM "OrganizationMembership" membership
      WHERE membership."id" = "ScopeAssignment"."membershipId"
        AND membership."userId" = (SELECT app_private.current_user_id())
        AND membership."status" = 'active'
    )
    OR (
      "organizationId" = (SELECT app_private.current_organization_id())
      AND (SELECT app_private.can_manage_memberships())
    )
  );
CREATE POLICY scope_assignment_write_scope ON "ScopeAssignment"
  FOR ALL TO stadium_api
  USING (
    "organizationId" = (SELECT app_private.current_organization_id())
    AND (SELECT app_private.can_manage_memberships())
  )
  WITH CHECK (
    "organizationId" = (SELECT app_private.current_organization_id())
    AND (SELECT app_private.can_manage_memberships())
  );

-- Continue this same pattern when organizationId/facilityId/zoneId are added
-- to VenueEvent, EventIssue, inventory, transfers, checklists, counts, and all
-- other tenant-owned operational tables. `anon` and `authenticated` remain
-- revoked because the mobile app continues to use the NestJS REST API.
