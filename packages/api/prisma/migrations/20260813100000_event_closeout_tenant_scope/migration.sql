-- Canonical event closeout and tenant/idempotency hardening for pilot operations.
ALTER TABLE "VenueEvent" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "VenueEvent" e SET "organizationId" = v."organizationId"
FROM "Venue" v WHERE v."id" = e."venueId" AND e."organizationId" IS NULL;
ALTER TABLE "VenueEvent" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "VenueEvent" ADD CONSTRAINT "VenueEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "VenueEvent_organizationId_venueId_operationalState_startsAt_idx"
  ON "VenueEvent"("organizationId", "venueId", "operationalState", "startsAt");

ALTER TABLE "EventFnbReadiness" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
UPDATE "EventFnbReadiness" r SET "organizationId" = v."organizationId"
FROM "Venue" v WHERE v."id" = r."venueId" AND r."organizationId" IS NULL;
ALTER TABLE "EventFnbReadiness" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "EventFnbReadiness" ADD CONSTRAINT "EventFnbReadiness_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "EventFnbReadiness_organizationId_venueId_eventId_status_idx"
  ON "EventFnbReadiness"("organizationId", "venueId", "eventId", "status");

ALTER TABLE "EventIssue" ADD COLUMN IF NOT EXISTS "clientMutationId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "EventIssue_organizationId_clientMutationId_key"
  ON "EventIssue"("organizationId", "clientMutationId") WHERE "clientMutationId" IS NOT NULL;

CREATE TYPE "EventCloseoutStatus" AS ENUM ('draft', 'finalized', 'adjusted');
CREATE TABLE "EventCloseout" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" "EventCloseoutStatus" NOT NULL DEFAULT 'draft',
  "actualAttendance" INTEGER,
  "actualSalesCents" INTEGER,
  "forecastSalesCents" INTEGER,
  "laborHours" DOUBLE PRECISION,
  "laborCostCents" INTEGER,
  "inventoryVarianceCents" INTEGER,
  "outletResults" JSONB,
  "inventoryResults" JSONB,
  "laborResults" JSONB,
  "notes" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "finalizedBy" TEXT,
  "adjustmentReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventCloseout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventCloseout_eventId_key" ON "EventCloseout"("eventId");
CREATE INDEX "EventCloseout_organizationId_venueId_status_idx" ON "EventCloseout"("organizationId", "venueId", "status");
CREATE INDEX "EventCloseout_venueId_updatedAt_idx" ON "EventCloseout"("venueId", "updatedAt");
ALTER TABLE "EventCloseout" ADD CONSTRAINT "EventCloseout_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventCloseout" ADD CONSTRAINT "EventCloseout_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCloseout" ADD CONSTRAINT "EventCloseout_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The API role is the only database path. Policies still fail closed if a
-- connection is ever exposed to Supabase's Data API.
ALTER TABLE "VenueEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EventFnbReadiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventFnbReadiness" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EventCloseout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventCloseout" FORCE ROW LEVEL SECURITY;

CREATE POLICY venue_event_scope ON "VenueEvent" FOR ALL TO stadium_api
  USING (app_private.scope_matches("organizationId", "venueId", NULL))
  WITH CHECK (app_private.scope_matches("organizationId", "venueId", NULL));
CREATE POLICY event_readiness_scope ON "EventFnbReadiness" FOR ALL TO stadium_api
  USING (app_private.scope_matches("organizationId", "venueId", "zoneId"))
  WITH CHECK (app_private.scope_matches("organizationId", "venueId", "zoneId"));
CREATE POLICY event_closeout_scope ON "EventCloseout" FOR ALL TO stadium_api
  USING (app_private.scope_matches("organizationId", "venueId", NULL))
  WITH CHECK (app_private.scope_matches("organizationId", "venueId", NULL));
