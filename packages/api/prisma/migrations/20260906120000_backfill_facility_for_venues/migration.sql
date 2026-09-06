-- Pair every legacy Venue with a hierarchical Facility that shares its id.
-- Stadium/VMS rows foreign-key to Facility; Auth still keys off Venue.
-- Safe to re-run: only inserts when Facility.id is missing.

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
  v."code",
  v."name",
  v."timezone",
  v."address",
  v."latitude",
  v."longitude",
  v."stadiumCapacity",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Venue" v
LEFT JOIN "Facility" f ON f."id" = v."id"
WHERE f."id" IS NULL
  AND v."organizationId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
