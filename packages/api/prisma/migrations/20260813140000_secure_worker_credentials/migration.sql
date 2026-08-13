-- Worker PINs and QR values are credentials, not roster attributes. Remove
-- predictable plaintext fields; existing credentials must be reissued through
-- the secured import flow after this migration.
ALTER TABLE "WorkerProfile" DROP CONSTRAINT IF EXISTS "WorkerProfile_organizationId_facilityId_pinCode_key";
DROP INDEX IF EXISTS "WorkerProfile_organizationId_facilityId_pinCode_key";
ALTER TABLE "WorkerProfile" DROP COLUMN IF EXISTS "pinCode";
ALTER TABLE "WorkerProfile" DROP COLUMN IF EXISTS "qrCodeIdentifier";

ALTER TABLE "WorkerProfile"
  ADD COLUMN "pinLookupTag" TEXT,
  ADD COLUMN "pinSalt" TEXT,
  ADD COLUMN "pinHash" TEXT,
  ADD COLUMN "qrLookupTag" TEXT,
  ADD COLUMN "qrSalt" TEXT,
  ADD COLUMN "qrHash" TEXT,
  ADD COLUMN "credentialsIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WorkerProfile_pinLookupTag_key"
  ON "WorkerProfile"("pinLookupTag") WHERE "pinLookupTag" IS NOT NULL;
CREATE UNIQUE INDEX "WorkerProfile_qrLookupTag_key"
  ON "WorkerProfile"("qrLookupTag") WHERE "qrLookupTag" IS NOT NULL;

ALTER TABLE "WorkerProfile" ALTER COLUMN "certFoodSafety" SET DEFAULT false;
ALTER TABLE "WorkerProfile" ALTER COLUMN "certAlcohol" SET DEFAULT false;

ALTER TABLE "ShiftPunch" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "ShiftPunch_facilityId_workerId_idempotencyKey_key"
  ON "ShiftPunch"("facilityId", "workerId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
