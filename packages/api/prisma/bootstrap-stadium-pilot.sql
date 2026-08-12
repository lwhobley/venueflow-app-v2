-- Idempotent first-tenant bootstrap for a new Stadium Wrangler database.
--
-- This creates the minimum Organization -> Facility -> Zone hierarchy needed
-- by the mobile app and assigns every unscoped all-access platform admin to
-- that tenant. It intentionally does not create operational demo records.

BEGIN;

INSERT INTO "Organization" ("id", "name", "code", "createdAt", "updatedAt")
VALUES (
  'org_stadium_wrangler',
  'Stadium Wrangler',
  'STADIUM_WRANGLER',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Venue" (
  "id",
  "organizationId",
  "name",
  "latitude",
  "longitude",
  "geofenceRadiusM",
  "timezone",
  "code",
  "venueType",
  "stadiumCapacity",
  "subscriptionStatus",
  "createdAt",
  "updatedAt"
)
VALUES (
  'venue_stadium_wrangler_pilot',
  'org_stadium_wrangler',
  'Stadium Wrangler Pilot Venue',
  0,
  0,
  250,
  'America/Chicago',
  'STADIUM_WRANGLER_PILOT',
  'stadium',
  18000,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET
  "organizationId" = EXCLUDED."organizationId",
  "name" = EXCLUDED."name",
  "venueType" = EXCLUDED."venueType",
  "stadiumCapacity" = EXCLUDED."stadiumCapacity",
  "subscriptionStatus" = EXCLUDED."subscriptionStatus",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Legacy Venue and hierarchical Facility deliberately share an ID. This is
-- the compatibility convention established by the hierarchy migration.
INSERT INTO "Facility" (
  "id",
  "organizationId",
  "code",
  "name",
  "timezone",
  "capacity",
  "active",
  "createdAt",
  "updatedAt"
)
VALUES (
  'venue_stadium_wrangler_pilot',
  'org_stadium_wrangler',
  'STADIUM_WRANGLER_PILOT',
  'Stadium Wrangler Pilot Venue',
  'America/Chicago',
  18000,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("organizationId", "code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "timezone" = EXCLUDED."timezone",
  "capacity" = EXCLUDED."capacity",
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "FacilityZone" (
  "id",
  "organizationId",
  "facilityId",
  "code",
  "name",
  "zoneType",
  "sortOrder",
  "active",
  "createdAt",
  "updatedAt"
)
VALUES (
  'zone_stadium_wrangler_main',
  'org_stadium_wrangler',
  'venue_stadium_wrangler_pilot',
  'MAIN',
  'Main Concourse',
  'concourse',
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("organizationId", "facilityId", "code") DO UPDATE
SET "name" = EXCLUDED."name", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Profile"
SET
  "venueId" = 'venue_stadium_wrangler_pilot',
  "membershipStatus" = 'active',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "venueId" IS NULL
  AND "role" = 'platform_admin'
  AND "allAccess" = true;

INSERT INTO "OrganizationMembership" (
  "id",
  "organizationId",
  "userId",
  "role",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'membership_stadium_' || "User"."id",
  'org_stadium_wrangler',
  "User"."id",
  'platform_admin',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
JOIN "Profile" ON "Profile"."userId" = "User"."id"
WHERE
  "Profile"."venueId" = 'venue_stadium_wrangler_pilot'
  AND "Profile"."role" = 'platform_admin'
  AND "Profile"."allAccess" = true
ON CONFLICT ("organizationId", "userId") DO UPDATE
SET "role" = 'platform_admin', "status" = 'active', "updatedAt" = CURRENT_TIMESTAMP;

-- A null facility/zone assignment grants organization-wide access.
INSERT INTO "ScopeAssignment" (
  "id",
  "organizationId",
  "membershipId",
  "facilityId",
  "zoneId",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  'scope_stadium_' || "OrganizationMembership"."id",
  "OrganizationMembership"."organizationId",
  "OrganizationMembership"."id",
  NULL,
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "OrganizationMembership"
WHERE
  "organizationId" = 'org_stadium_wrangler'
  AND "role" = 'platform_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM "ScopeAssignment"
    WHERE
      "ScopeAssignment"."membershipId" = "OrganizationMembership"."id"
      AND "ScopeAssignment"."facilityId" IS NULL
      AND "ScopeAssignment"."zoneId" IS NULL
  );

COMMIT;
