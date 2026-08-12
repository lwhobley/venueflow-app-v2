-- READ-ONLY preflight for the hierarchy migration approval gate.
-- Run with the migration-owner connection and save the result as a release
-- artifact. Every anomaly query must return zero rows or have a signed mapping.

SELECT 'Organization' AS entity, count(*) AS row_count FROM "Organization"
UNION ALL SELECT 'Venue', count(*) FROM "Venue"
UNION ALL SELECT 'Profile', count(*) FROM "Profile"
UNION ALL SELECT 'FnbOperationUnit', count(*) FROM "FnbOperationUnit"
UNION ALL SELECT 'VenueEvent', count(*) FROM "VenueEvent"
UNION ALL SELECT 'EventIssue', count(*) FROM "EventIssue";

-- Facilities with missing/invalid organization ancestry.
SELECT v."id", v."code", v."organizationId"
FROM "Venue" v
LEFT JOIN "Organization" organization ON organization."id" = v."organizationId"
WHERE organization."id" IS NULL;

-- Codes that would collide after becoming organization-scoped facility codes.
SELECT "organizationId", lower(trim("code")) AS normalized_code, count(*)
FROM "Venue"
GROUP BY "organizationId", lower(trim("code"))
HAVING count(*) > 1;

-- Zone normalization inventory. Blank values intentionally map to UNASSIGNED.
SELECT u."venueId",
       COALESCE(NULLIF(lower(trim(u."stadiumZone")), ''), '<unassigned>') AS normalized_zone,
       count(*) AS unit_count,
       array_agg(DISTINCT u."stadiumZone" ORDER BY u."stadiumZone") AS source_values
FROM "FnbOperationUnit" u
GROUP BY u."venueId", COALESCE(NULLIF(lower(trim(u."stadiumZone")), ''), '<unassigned>')
ORDER BY u."venueId", normalized_zone;

-- Outlet codes must remain unique inside each facility.
SELECT "venueId", lower(trim("code")) AS normalized_code, count(*)
FROM "FnbOperationUnit"
GROUP BY "venueId", lower(trim("code"))
HAVING count(*) > 1;

-- Profiles that cannot become a login-backed organization membership.
SELECT p."id", p."email", p."venueId", p."role", p."membershipStatus"
FROM "Profile" p
WHERE p."userId" IS NULL
  AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active');

-- Active profiles whose facility no longer exists.
SELECT p."id", p."userId", p."venueId"
FROM "Profile" p
LEFT JOIN "Venue" v ON v."id" = p."venueId"
WHERE p."venueId" IS NOT NULL
  AND v."id" IS NULL
  AND (p."membershipStatus" IS NULL OR p."membershipStatus" = 'active');

-- Existing event issue organization must agree with its facility organization.
SELECT issue."id", issue."organizationId" AS issue_organization, venue."organizationId" AS facility_organization
FROM "EventIssue" issue
JOIN "Venue" venue ON venue."id" = issue."venueId"
WHERE issue."organizationId" <> venue."organizationId";

-- Existing issue outlet must belong to the same facility as the issue.
SELECT issue."id", issue."venueId" AS issue_facility, outlet."venueId" AS outlet_facility
FROM "EventIssue" issue
JOIN "FnbOperationUnit" outlet ON outlet."id" = issue."outletId"
WHERE issue."outletId" IS NOT NULL
  AND issue."venueId" <> outlet."venueId";

-- Confirm the intended runtime role never carries RLS bypass privileges.
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres', 'stadium_api', 'stadium_api_runtime', 'anon', 'authenticated', 'service_role')
ORDER BY rolname;
