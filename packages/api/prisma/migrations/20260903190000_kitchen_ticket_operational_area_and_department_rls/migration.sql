-- Kitchen ticket operational area + department-aware RLS.
--
-- Closes review findings F-01/R2-01 (department boundary was derived from
-- client-controlled free text with a permissive default) and F-02 (no
-- department dimension anywhere in RLS, so the application layer had no
-- backstop).
--
-- Three parts:
--   1. Persist the ticket's operational area, resolved server-side, and
--      backfill existing rows.
--   2. Materialize the department -> area matrix into DepartmentAreaRule so
--      the database can answer "may this user work this area?" without
--      duplicating the matrix in SQL forever. The application seeds the same
--      rows from BASELINE_DEPARTMENT_AREAS (access-control.helper.ts) via
--      DepartmentsService.ensureDefaultDepartments; this block only covers
--      departments that already existed when the migration ran.
--   3. Add app_private.department_area_allows() and AND it into the kitchen
--      ticket policies, so a department boundary is enforced at the database
--      even if the application check regresses.
--
-- Inert until the stadium_api role exists (see docs/rls-cutover-runbook.md):
-- every policy block is guarded, matching the established pattern.

-- ---------------------------------------------------------------------------
-- 1. Ticket operational area
-- ---------------------------------------------------------------------------

ALTER TABLE "KitchenFulfillmentTicket"
  ADD COLUMN "operationalAreaType" "OperationalAreaType";

-- Backfill. Existing rows predate the concept, so their true area is not
-- recoverable; this reproduces the legacy keyword inference that was live
-- until now, with one correction: a ticket linked to a SuiteBeoOrder is suite
-- work, not catering (the legacy rule forced every BEO ticket to `catering`,
-- which locked the owning Suites department out of its own tickets).
--
-- The trailing `distro` default matches the legacy fallback, so no existing
-- row becomes MORE visible than it is today; suites/clubs/concessions rows
-- become less visible, which is the intended direction. Operators should spot
-- check any long-lived open tickets after deploy — new rows are resolved
-- properly by KitchenDistroFulfillmentService.resolveOperationalArea().
UPDATE "KitchenFulfillmentTicket" t
SET "operationalAreaType" = CASE
  WHEN t."beoId" IS NOT NULL
       AND EXISTS (SELECT 1 FROM "SuiteBeoOrder" s WHERE s."id" = t."beoId")
    THEN 'suite'::"OperationalAreaType"
  WHEN t."beoId" IS NOT NULL
    OR lower(coalesce(t."serviceAreaName", '')) LIKE '%catering%'
    OR lower(coalesce(t."serviceAreaName", '')) LIKE '%banquet%'
    OR lower(coalesce(t."notes", ''))           LIKE '%catering%'
    THEN 'catering'::"OperationalAreaType"
  WHEN lower(coalesce(t."serviceAreaName", '')) LIKE '%concession%'
    OR lower(coalesce(t."serviceAreaName", '')) LIKE '%hawker%'
    OR lower(coalesce(t."notes", ''))           LIKE '%concession%'
    THEN 'concession'::"OperationalAreaType"
  WHEN lower(coalesce(t."serviceAreaName", '')) LIKE '%suite%'
    OR lower(coalesce(t."notes", ''))           LIKE '%suite%'
    THEN 'suite'::"OperationalAreaType"
  WHEN lower(coalesce(t."serviceAreaName", '')) LIKE '%club%'
    OR lower(coalesce(t."serviceAreaName", '')) LIKE '%lounge%'
    OR lower(coalesce(t."notes", ''))           LIKE '%club%'
    THEN 'club'::"OperationalAreaType"
  WHEN lower(coalesce(t."serviceAreaName", '')) LIKE '%kitchen%'
    OR lower(coalesce(t."serviceAreaName", '')) LIKE '%culinary%'
    THEN 'culinary'::"OperationalAreaType"
  ELSE 'distro'::"OperationalAreaType"
END
WHERE t."operationalAreaType" IS NULL;

ALTER TABLE "KitchenFulfillmentTicket"
  ALTER COLUMN "operationalAreaType" SET NOT NULL;

CREATE INDEX "KitchenFulfillmentTicket_facilityId_operationalAreaType_status_idx"
  ON "KitchenFulfillmentTicket"("facilityId", "operationalAreaType", "status");

-- ---------------------------------------------------------------------------
-- 2. Seed DepartmentAreaRule for pre-existing departments
-- ---------------------------------------------------------------------------
-- Mirrors BASELINE_DEPARTMENT_AREAS in packages/api/src/auth/access-control.helper.ts.
-- Keep the two in sync; access-control.helper.spec.ts holds a drift guard.
-- Department-wide grants: zoneId/subVenueId/outletId stay NULL, meaning
-- "any location within the facility".
INSERT INTO "DepartmentAreaRule" (
  "id", "organizationId", "facilityId", "departmentId", "areaType", "actionScope", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  d."organizationId",
  d."facilityId",
  d."id",
  m.area::"OperationalAreaType",
  'read_write',
  NOW(),
  NOW()
FROM "Department" d
JOIN (
  VALUES
    ('suites',      'suite'),          ('suites',      'shared'),
    ('clubs',       'club'),           ('clubs',       'shared'),
    ('catering',    'catering'),       ('catering',    'kitchen'),
    ('catering',    'distro'),         ('catering',    'shared'),
    ('concessions', 'concession'),     ('concessions', 'shared'),
    ('culinary',    'culinary'),       ('culinary',    'kitchen'),
    ('culinary',    'distro'),         ('culinary',    'suite'),
    ('culinary',    'club'),           ('culinary',    'catering'),
    ('culinary',    'shared'),
    ('maintenance', 'maintenance'),    ('maintenance', 'shared'),
    ('maintenance', 'other'),
    ('engineering', 'engineering'),    ('engineering', 'shared'),
    ('engineering', 'other'),
    ('security',    'security'),       ('security',    'shared'),
    ('security',    'other'),
    ('custodial',   'custodial'),      ('custodial',   'shared'),
    ('custodial',   'other'),
    ('it',          'maintenance'),    ('it',          'engineering'),
    ('it',          'shared'),         ('it',          'other'),
    ('operations',  'suite'),          ('operations',  'club'),
    ('operations',  'catering'),       ('operations',  'concession'),
    ('operations',  'culinary'),       ('operations',  'kitchen'),
    ('operations',  'distro'),         ('operations',  'maintenance'),
    ('operations',  'engineering'),    ('operations',  'security'),
    ('operations',  'custodial'),      ('operations',  'administrative'),
    ('operations',  'shared'),         ('operations',  'other')
) AS m(code, area) ON lower(d."code") = m.code
WHERE NOT EXISTS (
  SELECT 1 FROM "DepartmentAreaRule" r
  WHERE r."organizationId" = d."organizationId"
    AND r."facilityId"     = d."facilityId"
    AND r."departmentId"   = d."id"
    AND r."areaType"       = m.area::"OperationalAreaType"
    AND r."zoneId" IS NULL AND r."subVenueId" IS NULL AND r."outletId" IS NULL
);

-- One department-wide rule per (department, area). Also makes the seed above
-- and the application-side seeding safely idempotent under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentAreaRule_department_area_facility_wide_key"
  ON "DepartmentAreaRule"("organizationId", "facilityId", "departmentId", "areaType")
  WHERE "zoneId" IS NULL AND "subVenueId" IS NULL AND "outletId" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Department-aware RLS
-- ---------------------------------------------------------------------------

-- Answers "may the current user work this operational area at this facility?"
-- Mirrors evaluateAccessRules()'s department/override logic:
--   * broad admin (allAccess profile, or an admin-tier organization role)
--   * an active DepartmentMembership whose department grants the area
--   * an active, unexpired UserAreaOverride for the area
-- SECURITY DEFINER with a pinned empty search_path and fully qualified names,
-- matching app_private's existing helpers.
CREATE OR REPLACE FUNCTION app_private.department_area_allows(
  p_organization_id text,
  p_facility_id text,
  p_area "OperationalAreaType"
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    -- Broad administrative access: venue-wide profile flag or admin org role.
    EXISTS (
      SELECT 1
      FROM public."Profile" p
      WHERE p."userId" = app_private.current_user_id()
        AND p."venueId" = p_facility_id
        AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active')
        AND p."allAccess" = true
    )
    OR EXISTS (
      SELECT 1
      FROM public."OrganizationMembership" m
      WHERE m."organizationId" = p_organization_id
        AND m."userId" = app_private.current_user_id()
        AND m."status" = 'active'
        AND m."role" IN ('platform_admin', 'organization_admin', 'owner', 'admin')
    )
    -- Department membership granting this area.
    OR EXISTS (
      SELECT 1
      FROM public."DepartmentMembership" dm
      JOIN public."DepartmentAreaRule" dar
        ON dar."organizationId" = dm."organizationId"
       AND dar."facilityId"     = dm."facilityId"
       AND dar."departmentId"   = dm."departmentId"
      WHERE dm."userId" = app_private.current_user_id()
        AND dm."organizationId" = p_organization_id
        AND dm."facilityId" = p_facility_id
        AND dm."isActive" = true
        AND dar."areaType" = p_area
    )
    -- Time-boxed override for this specific area.
    OR EXISTS (
      SELECT 1
      FROM public."UserAreaOverride" o
      WHERE o."userId" = app_private.current_user_id()
        AND o."organizationId" = p_organization_id
        AND o."facilityId" = p_facility_id
        AND o."active" = true
        AND o."areaType" = p_area
        AND o."startsAt" <= NOW()
        AND o."expiresAt" >= NOW()
    );
$$;

REVOKE ALL ON FUNCTION app_private.department_area_allows(text, text, "OperationalAreaType") FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    GRANT EXECUTE ON FUNCTION app_private.department_area_allows(text, text, "OperationalAreaType") TO stadium_api;

    -- Tickets: tenant/zone scope AND department-area entitlement.
    DROP POLICY IF EXISTS kitchen_fulfillment_ticket_read_scope ON "KitchenFulfillmentTicket";
    CREATE POLICY kitchen_fulfillment_ticket_read_scope ON "KitchenFulfillmentTicket"
      FOR SELECT TO stadium_api
      USING (
        (SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))
        AND (SELECT app_private.department_area_allows("organizationId", "facilityId", "operationalAreaType"))
      );

    DROP POLICY IF EXISTS kitchen_fulfillment_ticket_write_scope ON "KitchenFulfillmentTicket";
    CREATE POLICY kitchen_fulfillment_ticket_write_scope ON "KitchenFulfillmentTicket"
      FOR ALL TO stadium_api
      USING (
        (SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))
        AND (SELECT app_private.department_area_allows("organizationId", "facilityId", "operationalAreaType"))
      )
      WITH CHECK (
        (SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))
        AND (SELECT app_private.department_area_allows("organizationId", "facilityId", "operationalAreaType"))
      );

    -- History rows carry no area of their own; they inherit the parent
    -- ticket's, so a user who cannot see a ticket cannot see its history.
    DROP POLICY IF EXISTS kitchen_fulfillment_history_read_scope ON "KitchenFulfillmentStatusHistory";
    CREATE POLICY kitchen_fulfillment_history_read_scope ON "KitchenFulfillmentStatusHistory"
      FOR SELECT TO stadium_api
      USING (
        (SELECT app_private.scope_matches("organizationId", "facilityId", NULL))
        AND EXISTS (
          SELECT 1 FROM "KitchenFulfillmentTicket" t
          WHERE t."id" = "KitchenFulfillmentStatusHistory"."ticketId"
            AND app_private.department_area_allows(t."organizationId", t."facilityId", t."operationalAreaType")
        )
      );

    DROP POLICY IF EXISTS kitchen_fulfillment_history_write_scope ON "KitchenFulfillmentStatusHistory";
    CREATE POLICY kitchen_fulfillment_history_write_scope ON "KitchenFulfillmentStatusHistory"
      FOR ALL TO stadium_api
      USING (
        (SELECT app_private.scope_matches("organizationId", "facilityId", NULL))
        AND EXISTS (
          SELECT 1 FROM "KitchenFulfillmentTicket" t
          WHERE t."id" = "KitchenFulfillmentStatusHistory"."ticketId"
            AND app_private.department_area_allows(t."organizationId", t."facilityId", t."operationalAreaType")
        )
      )
      WITH CHECK (
        (SELECT app_private.scope_matches("organizationId", "facilityId", NULL))
        AND EXISTS (
          SELECT 1 FROM "KitchenFulfillmentTicket" t
          WHERE t."id" = "KitchenFulfillmentStatusHistory"."ticketId"
            AND app_private.department_area_allows(t."organizationId", t."facilityId", t."operationalAreaType")
        )
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Part 4: make the SECURITY DEFINER authorization helpers readable.
--
-- Every app_private authorization helper (scope_matches, venue_matches,
-- can_operate_scope, can_manage_memberships, department_area_allows,
-- auth_lookup_session, auth_lookup_profiles) is SECURITY DEFINER and therefore
-- executes as its owner, the schema-owning migration role. FORCE ROW LEVEL
-- SECURITY makes RLS apply to the table owner too, so with FORCE on the tables
-- those helpers read, every helper query returned zero rows and every helper
-- returned false -- i.e. the whole policy layer was silently deny-everything,
-- including for correctly scoped users. (Verified empirically: as the owner
-- role, SELECT count(*) FROM "OrganizationMembership" returned 0.)
--
-- Dropping FORCE on exactly these authorization-source tables does not widen
-- the real trust boundary. The runtime API connects as stadium_api, which is
-- NOBYPASSRLS and is NOT the table owner, so ENABLE alone keeps it fully
-- policed. FORCE only ever constrained the migration role, which holds DDL and
-- could disable RLS at will, so it bought no protection against the actual
-- threat while breaking authorization outright.
--
-- ENABLE ROW LEVEL SECURITY stays on all of them. Only owner-side FORCE is
-- dropped, and only for tables an authorization helper must read.
-- ---------------------------------------------------------------------------
ALTER TABLE "OrganizationMembership" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "ScopeAssignment"        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "DepartmentMembership"   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "DepartmentAreaRule"     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "UserAreaOverride"       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Profile"                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Session"                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Venue"                  NO FORCE ROW LEVEL SECURITY;
