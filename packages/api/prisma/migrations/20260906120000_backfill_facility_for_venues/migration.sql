-- Backfill the Facility paired with every existing Venue.
--
-- Auth and the mobile app key off Venue; the stadium/VMS tables foreign-key to
-- Facility, and every call site passes `scope.venueId` straight into a
-- `facilityId` column. Venues created before the pairing was enforced on write
-- have no Facility row, so the first stadium/VMS write for those tenants fails
-- with a foreign-key violation. This gives each of them the paired row.
--
-- Idempotent: only venues without a same-id Facility are inserted, and the
-- code collision guard keeps the Facility_organizationId_code unique index
-- satisfied when an unrelated facility in the same org already holds the
-- venue's code.
INSERT INTO "Facility" (
  "id",
  "organizationId",
  "code",
  "name",
  "timezone",
  "address",
  "latitude",
  "longitude",
  "capacity",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  v."id",
  v."organizationId",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "Facility" f
      WHERE f."organizationId" = v."organizationId" AND f."code" = v."code"
    ) THEN 'venue-' || v."id"
    ELSE v."code"
  END,
  v."name",
  v."timezone",
  v."address",
  v."latitude",
  v."longitude",
  v."stadiumCapacity",
  TRUE,
  v."createdAt",
  NOW()
FROM "Venue" v
WHERE NOT EXISTS (SELECT 1 FROM "Facility" f WHERE f."id" = v."id");
