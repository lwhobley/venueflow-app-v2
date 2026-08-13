-- Add currentVersion to EventCloseout
ALTER TABLE "EventCloseout" ADD COLUMN IF NOT EXISTS "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- Create EventCloseoutRevision table
CREATE TABLE IF NOT EXISTS "EventCloseoutRevision" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "closeoutId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "parentRevisionId" TEXT,
  "revisionHash" TEXT NOT NULL,
  "actualAttendance" INTEGER,
  "actualSalesCents" INTEGER,
  "forecastSalesCents" INTEGER,
  "laborHours" DOUBLE PRECISION,
  "laborCostCents" INTEGER,
  "inventoryVarianceCents" INTEGER,
  "outletResults" JSONB,
  "inventoryResults" JSONB,
  "laborResults" JSONB,
  "adjustmentReason" TEXT,
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventCloseoutRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventCloseoutRevision_closeoutId_version_key"
  ON "EventCloseoutRevision"("closeoutId", "version");
CREATE INDEX IF NOT EXISTS "EventCloseoutRevision_organizationId_venueId_closeoutId_idx"
  ON "EventCloseoutRevision"("organizationId", "venueId", "closeoutId");

ALTER TABLE "EventCloseoutRevision" ADD CONSTRAINT "EventCloseoutRevision_closeoutId_fkey"
  FOREIGN KEY ("closeoutId") REFERENCES "EventCloseout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventCloseoutRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventCloseoutRevision" FORCE ROW LEVEL SECURITY;

CREATE POLICY event_closeout_revision_scope ON "EventCloseoutRevision" FOR ALL TO stadium_api
  USING (app_private.scope_matches("organizationId", "venueId", NULL))
  WITH CHECK (app_private.scope_matches("organizationId", "venueId", NULL));
