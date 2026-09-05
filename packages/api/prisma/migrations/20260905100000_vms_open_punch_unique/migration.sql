-- AlterTable
ALTER TABLE "VmsTimeAttendance" ADD COLUMN IF NOT EXISTS "clientMutationId" TEXT;

-- Enforce partial unique index: at most one open punch (clockOut is null) per facility and staff member
CREATE UNIQUE INDEX IF NOT EXISTS "VmsTimeAttendance_facility_staff_open_key"
  ON "VmsTimeAttendance"("facilityId", "staffMemberId")
  WHERE "clockOut" IS NULL AND "staffMemberId" IS NOT NULL;

-- Index for fast client mutation idempotency lookups
CREATE INDEX IF NOT EXISTS "VmsTimeAttendance_facility_mutation_idx"
  ON "VmsTimeAttendance"("facilityId", "clientMutationId");
