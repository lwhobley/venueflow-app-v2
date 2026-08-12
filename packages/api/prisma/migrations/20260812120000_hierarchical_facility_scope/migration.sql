-- Stadium Wrangler hierarchy, membership scopes, and RLS foundation.
-- Additive migration: legacy Venue/Profile/FnbOperationUnit rows remain intact
-- for dual-read/dual-write rollout and rollback.

CREATE TYPE "FacilityZoneType" AS ENUM ('concourse', 'premium', 'service', 'back_of_house', 'exterior', 'other');
CREATE TYPE "SubVenueType" AS ENUM ('club', 'suite_group', 'loge', 'field_level', 'floor_level', 'commissary', 'banquet_space', 'other');
CREATE TYPE "TerminalType" AS ENUM ('pos', 'self_service', 'mobile_pickup', 'handheld', 'kitchen_display', 'other');

CREATE TABLE "Facility" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT,
  "address" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "capacity" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FacilityZone" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "zoneType" "FacilityZoneType" NOT NULL DEFAULT 'concourse',
  "level" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacilityZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubVenue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subVenueType" "SubVenueType" NOT NULL,
  "capacity" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubVenue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Outlet" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "subVenueId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "department" "FnbDepartment" NOT NULL,
  "outletType" "FnbOperationType" NOT NULL,
  "status" "FnbUnitStatus" NOT NULL DEFAULT 'open',
  "capacity" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Terminal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "terminalType" "TerminalType" NOT NULL DEFAULT 'pos',
  "externalRef" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScopeAssignment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "facilityId" TEXT,
  "zoneId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScopeAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScopeAssignment_zone_requires_facility_check" CHECK ("zoneId" IS NULL OR "facilityId" IS NOT NULL)
);

CREATE UNIQUE INDEX "Facility_organizationId_id_key" ON "Facility"("organizationId", "id");
CREATE UNIQUE INDEX "Facility_organizationId_code_key" ON "Facility"("organizationId", "code");
CREATE INDEX "Facility_organizationId_active_idx" ON "Facility"("organizationId", "active");
CREATE UNIQUE INDEX "FacilityZone_organizationId_facilityId_id_key" ON "FacilityZone"("organizationId", "facilityId", "id");
CREATE UNIQUE INDEX "FacilityZone_organizationId_facilityId_code_key" ON "FacilityZone"("organizationId", "facilityId", "code");
CREATE INDEX "FacilityZone_organizationId_facilityId_active_sortOrder_idx" ON "FacilityZone"("organizationId", "facilityId", "active", "sortOrder");
CREATE UNIQUE INDEX "SubVenue_organizationId_facilityId_zoneId_id_key" ON "SubVenue"("organizationId", "facilityId", "zoneId", "id");
CREATE UNIQUE INDEX "SubVenue_organizationId_facilityId_code_key" ON "SubVenue"("organizationId", "facilityId", "code");
CREATE INDEX "SubVenue_organizationId_facilityId_zoneId_active_idx" ON "SubVenue"("organizationId", "facilityId", "zoneId", "active");
CREATE UNIQUE INDEX "Outlet_organizationId_facilityId_zoneId_id_key" ON "Outlet"("organizationId", "facilityId", "zoneId", "id");
CREATE UNIQUE INDEX "Outlet_organizationId_facilityId_code_key" ON "Outlet"("organizationId", "facilityId", "code");
CREATE INDEX "Outlet_organizationId_facilityId_zoneId_status_idx" ON "Outlet"("organizationId", "facilityId", "zoneId", "status");
CREATE INDEX "Outlet_subVenueId_idx" ON "Outlet"("subVenueId");
CREATE UNIQUE INDEX "Terminal_organizationId_facilityId_outletId_code_key" ON "Terminal"("organizationId", "facilityId", "outletId", "code");
CREATE INDEX "Terminal_organizationId_facilityId_zoneId_active_idx" ON "Terminal"("organizationId", "facilityId", "zoneId", "active");
CREATE INDEX "Terminal_outletId_idx" ON "Terminal"("outletId");
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_id_key" ON "OrganizationMembership"("organizationId", "id");
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");
CREATE INDEX "ScopeAssignment_membershipId_idx" ON "ScopeAssignment"("membershipId");
CREATE INDEX "ScopeAssignment_organizationId_facilityId_zoneId_active_idx" ON "ScopeAssignment"("organizationId", "facilityId", "zoneId", "active");
CREATE UNIQUE INDEX "ScopeAssignment_membership_org_scope_key" ON "ScopeAssignment"("membershipId") WHERE "facilityId" IS NULL AND "zoneId" IS NULL;
CREATE UNIQUE INDEX "ScopeAssignment_membership_facility_scope_key" ON "ScopeAssignment"("membershipId", "facilityId") WHERE "facilityId" IS NOT NULL AND "zoneId" IS NULL;
CREATE UNIQUE INDEX "ScopeAssignment_membership_zone_scope_key" ON "ScopeAssignment"("membershipId", "facilityId", "zoneId") WHERE "zoneId" IS NOT NULL;

ALTER TABLE "Facility" ADD CONSTRAINT "Facility_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacilityZone" ADD CONSTRAINT "FacilityZone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacilityZone" ADD CONSTRAINT "FacilityZone_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubVenue" ADD CONSTRAINT "SubVenue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubVenue" ADD CONSTRAINT "SubVenue_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubVenue" ADD CONSTRAINT "SubVenue_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_organizationId_facilityId_zoneId_subVenueId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId", "subVenueId") REFERENCES "SubVenue"("organizationId", "facilityId", "zoneId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_organizationId_facilityId_zoneId_outletId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId", "outletId") REFERENCES "Outlet"("organizationId", "facilityId", "zoneId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeAssignment" ADD CONSTRAINT "ScopeAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeAssignment" ADD CONSTRAINT "ScopeAssignment_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeAssignment" ADD CONSTRAINT "ScopeAssignment_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeAssignment" ADD CONSTRAINT "ScopeAssignment_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve Venue IDs as Facility IDs to keep the rollout additive and make
-- legacy tenant references deterministic.
INSERT INTO "Facility" ("id", "organizationId", "code", "name", "timezone", "address", "latitude", "longitude", "capacity", "createdAt", "updatedAt")
SELECT "id", "organizationId", "code", "name", "timezone", "address", "latitude", "longitude", "stadiumCapacity", "createdAt", "updatedAt"
FROM "Venue";

-- Every facility receives an explicit fallback zone. Blank legacy zone values
-- map here rather than being guessed into a real concourse.
INSERT INTO "FacilityZone" ("id", "organizationId", "facilityId", "code", "name", "zoneType", "createdAt", "updatedAt")
SELECT 'zone_' || substr(md5(f."id" || ':unassigned'), 1, 24), f."organizationId", f."id", 'UNASSIGNED', 'Unassigned', 'other', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Facility" f;

WITH normalized_zones AS (
  SELECT u."venueId" AS facility_id,
         v."organizationId" AS organization_id,
         lower(trim(u."stadiumZone")) AS normalized_name,
         min(trim(u."stadiumZone")) AS display_name
  FROM "FnbOperationUnit" u
  JOIN "Venue" v ON v."id" = u."venueId"
  WHERE NULLIF(trim(u."stadiumZone"), '') IS NOT NULL
  GROUP BY u."venueId", v."organizationId", lower(trim(u."stadiumZone"))
)
INSERT INTO "FacilityZone" ("id", "organizationId", "facilityId", "code", "name", "zoneType", "createdAt", "updatedAt")
SELECT 'zone_' || substr(md5(facility_id || ':' || normalized_name), 1, 24),
       organization_id,
       facility_id,
       'ZONE-' || upper(substr(md5(normalized_name), 1, 10)),
       display_name,
       'concourse',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM normalized_zones;

WITH unit_scope AS (
  SELECT u.*,
         v."organizationId" AS organization_id,
         CASE
           WHEN NULLIF(trim(u."stadiumZone"), '') IS NULL THEN 'zone_' || substr(md5(u."venueId" || ':unassigned'), 1, 24)
           ELSE 'zone_' || substr(md5(u."venueId" || ':' || lower(trim(u."stadiumZone"))), 1, 24)
         END AS zone_id
  FROM "FnbOperationUnit" u
  JOIN "Venue" v ON v."id" = u."venueId"
), sub_venue_units AS (
  SELECT *,
         CASE "type"
           WHEN 'premium_club' THEN 'club'::"SubVenueType"
           WHEN 'premium_suite' THEN 'suite_group'::"SubVenueType"
           WHEN 'loge_hospitality' THEN 'loge'::"SubVenueType"
           WHEN 'commissary' THEN 'commissary'::"SubVenueType"
           WHEN 'production_kitchen' THEN 'commissary'::"SubVenueType"
           WHEN 'catering' THEN 'banquet_space'::"SubVenueType"
           WHEN 'banquet' THEN 'banquet_space'::"SubVenueType"
           ELSE 'other'::"SubVenueType"
         END AS sub_venue_type
  FROM unit_scope
  WHERE "type" IN ('premium_club', 'premium_suite', 'loge_hospitality', 'commissary', 'production_kitchen', 'catering', 'banquet')
)
INSERT INTO "SubVenue" ("id", "organizationId", "facilityId", "zoneId", "code", "name", "subVenueType", "capacity", "createdAt", "updatedAt")
SELECT 'sub_' || substr(md5("id"), 1, 24), organization_id, "venueId", zone_id, 'SV-' || "code", "name", sub_venue_type, "capacity", "createdAt", "updatedAt"
FROM sub_venue_units;

WITH unit_scope AS (
  SELECT u.*,
         v."organizationId" AS organization_id,
         CASE
           WHEN NULLIF(trim(u."stadiumZone"), '') IS NULL THEN 'zone_' || substr(md5(u."venueId" || ':unassigned'), 1, 24)
           ELSE 'zone_' || substr(md5(u."venueId" || ':' || lower(trim(u."stadiumZone"))), 1, 24)
         END AS zone_id
  FROM "FnbOperationUnit" u
  JOIN "Venue" v ON v."id" = u."venueId"
)
INSERT INTO "Outlet" ("id", "organizationId", "facilityId", "zoneId", "subVenueId", "code", "name", "department", "outletType", "status", "capacity", "notes", "createdAt", "updatedAt")
SELECT "id", organization_id, "venueId", zone_id,
       CASE WHEN "type" IN ('premium_club', 'premium_suite', 'loge_hospitality', 'commissary', 'production_kitchen', 'catering', 'banquet') THEN 'sub_' || substr(md5("id"), 1, 24) END,
       "code", "name", "department", "type", "status", "capacity", "notes", "createdAt", "updatedAt"
FROM unit_scope;

-- Choose the strongest active legacy role when a user has multiple profiles in
-- one organization. Facility scopes are retained separately below.
WITH ranked_memberships AS (
  SELECT p."userId" AS user_id,
         v."organizationId" AS organization_id,
         p."role",
         row_number() OVER (
           PARTITION BY p."userId", v."organizationId"
           ORDER BY CASE p."role"
             WHEN 'platform_admin' THEN 100
             WHEN 'organization_admin' THEN 90
             WHEN 'owner' THEN 80
             WHEN 'admin' THEN 70
             WHEN 'fnb_director' THEN 60
             WHEN 'manager' THEN 50
             ELSE 10
           END DESC,
           p."createdAt" ASC
         ) AS role_rank
  FROM "Profile" p
  JOIN "Venue" v ON v."id" = p."venueId"
  WHERE p."userId" IS NOT NULL
    AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active')
)
INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT 'om_' || substr(md5(user_id || ':' || organization_id), 1, 24), organization_id, user_id, "role", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM ranked_memberships
WHERE role_rank = 1;

INSERT INTO "ScopeAssignment" ("id", "organizationId", "membershipId", "facilityId", "zoneId", "active", "createdAt", "updatedAt")
SELECT 'scope_' || substr(md5(p."userId" || ':' || p."venueId"), 1, 24),
       v."organizationId",
       'om_' || substr(md5(p."userId" || ':' || v."organizationId"), 1, 24),
       p."venueId",
       NULL,
       true,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "Profile" p
JOIN "Venue" v ON v."id" = p."venueId"
WHERE p."userId" IS NOT NULL
  AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active')
ON CONFLICT DO NOTHING;

-- A policy target group is created without LOGIN. The production login is
-- provisioned separately with a secret and granted membership in this group.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    CREATE ROLE stadium_api NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_private.current_user_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_private.current_organization_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_private.current_facility_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT NULLIF(current_setting('app.facility_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_private.current_zone_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT NULLIF(current_setting('app.zone_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_private.can_manage_memberships() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."OrganizationMembership" membership
    WHERE membership."organizationId" = app_private.current_organization_id()
      AND membership."userId" = app_private.current_user_id()
      AND membership."status" = 'active'
      AND membership."role" IN ('platform_admin', 'organization_admin', 'owner', 'admin')
  )
$$;
CREATE OR REPLACE FUNCTION app_private.can_operate_scope() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."OrganizationMembership" membership
    WHERE membership."organizationId" = app_private.current_organization_id()
      AND membership."userId" = app_private.current_user_id()
      AND membership."status" = 'active'
      AND membership."role" IN ('platform_admin', 'organization_admin', 'owner', 'admin', 'fnb_director', 'event_manager', 'outlet_manager', 'executive_chef', 'warehouse_manager', 'premium_manager', 'manager')
  )
$$;
CREATE OR REPLACE FUNCTION app_private.scope_matches(row_organization_id text, row_facility_id text, row_zone_id text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT row_organization_id = app_private.current_organization_id()
    AND (row_facility_id IS NULL OR app_private.current_facility_id() IS NULL OR row_facility_id = app_private.current_facility_id())
    AND (row_zone_id IS NULL OR app_private.current_zone_id() IS NULL OR row_zone_id = app_private.current_zone_id())
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
        AND (row_facility_id IS NULL OR assignment."facilityId" IS NULL OR assignment."facilityId" = row_facility_id)
        AND (row_zone_id IS NULL OR assignment."zoneId" IS NULL OR assignment."zoneId" = row_zone_id)
    )
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO stadium_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO stadium_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Organization", "Facility", "FacilityZone", "SubVenue", "Outlet", "Terminal", "OrganizationMembership", "ScopeAssignment" TO stadium_api;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Facility" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FacilityZone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FacilityZone" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SubVenue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubVenue" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Outlet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Outlet" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Terminal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Terminal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationMembership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ScopeAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScopeAssignment" FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_read_scope ON "Organization" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("id", NULL, NULL)));
CREATE POLICY organization_write_scope ON "Organization" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("id", NULL, NULL)) AND (SELECT app_private.can_manage_memberships())) WITH CHECK ((SELECT app_private.scope_matches("id", NULL, NULL)) AND (SELECT app_private.can_manage_memberships()));
CREATE POLICY facility_read_scope ON "Facility" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "id", NULL)));
CREATE POLICY facility_write_scope ON "Facility" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "id", NULL)) AND (SELECT app_private.can_manage_memberships())) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "id", NULL)) AND (SELECT app_private.can_manage_memberships()));
CREATE POLICY facility_zone_read_scope ON "FacilityZone" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "id")));
CREATE POLICY facility_zone_write_scope ON "FacilityZone" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "id")) AND (SELECT app_private.can_manage_memberships())) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "id")) AND (SELECT app_private.can_manage_memberships()));
CREATE POLICY sub_venue_read_scope ON "SubVenue" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY sub_venue_write_scope ON "SubVenue" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_manage_memberships())) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_manage_memberships()));
CREATE POLICY outlet_read_scope ON "Outlet" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY outlet_write_scope ON "Outlet" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope())) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope()));
CREATE POLICY terminal_read_scope ON "Terminal" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY terminal_write_scope ON "Terminal" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope())) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")) AND (SELECT app_private.can_operate_scope()));

CREATE POLICY membership_read_scope ON "OrganizationMembership" FOR SELECT TO stadium_api USING (
  "userId" = (SELECT app_private.current_user_id())
  OR ("organizationId" = (SELECT app_private.current_organization_id()) AND (SELECT app_private.can_manage_memberships()))
);
CREATE POLICY membership_write_scope ON "OrganizationMembership" FOR ALL TO stadium_api USING (
  "organizationId" = (SELECT app_private.current_organization_id()) AND (SELECT app_private.can_manage_memberships())
) WITH CHECK (
  "organizationId" = (SELECT app_private.current_organization_id()) AND (SELECT app_private.can_manage_memberships())
);
CREATE POLICY scope_assignment_read_scope ON "ScopeAssignment" FOR SELECT TO stadium_api USING (
  EXISTS (
    SELECT 1 FROM "OrganizationMembership" membership
    WHERE membership."id" = "ScopeAssignment"."membershipId"
      AND membership."userId" = (SELECT app_private.current_user_id())
      AND membership."status" = 'active'
  )
  OR ("organizationId" = (SELECT app_private.current_organization_id()) AND (SELECT app_private.can_manage_memberships()))
);
CREATE POLICY scope_assignment_write_scope ON "ScopeAssignment" FOR ALL TO stadium_api USING (
  "organizationId" = (SELECT app_private.current_organization_id()) AND (SELECT app_private.can_manage_memberships())
) WITH CHECK (
  "organizationId" = (SELECT app_private.current_organization_id()) AND (SELECT app_private.can_manage_memberships())
);

-- Supabase Data API remains fail-closed. Mobile traffic continues through the
-- NestJS API and never receives database or service-role credentials.
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "Facility", "FacilityZone", "SubVenue", "Outlet", "Terminal", "OrganizationMembership", "ScopeAssignment" FROM %I', api_role);
      EXECUTE format('REVOKE USAGE ON SCHEMA app_private FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
