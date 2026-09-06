-- CreateEnum
CREATE TYPE "EventBeoReportTrigger" AS ENUM ('manual', 'scheduled');

-- CreateTable
CREATE TABLE "EventBeoReport" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "trigger" "EventBeoReportTrigger" NOT NULL DEFAULT 'manual',
  "generatedBy" TEXT NOT NULL,
  "generatedByName" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suiteBeoCount" INTEGER NOT NULL DEFAULT 0,
  "suiteGuestCount" INTEGER NOT NULL DEFAULT 0,
  "suiteRevenueCents" INTEGER NOT NULL DEFAULT 0,
  "departmentCount" INTEGER NOT NULL DEFAULT 0,
  "lineItemCount" INTEGER NOT NULL DEFAULT 0,
  "dataGaps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "report" JSONB NOT NULL,
  CONSTRAINT "EventBeoReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventBeoReport_eventId_version_key" ON "EventBeoReport"("eventId", "version");
CREATE INDEX "EventBeoReport_organizationId_venueId_publishedAt_idx" ON "EventBeoReport"("organizationId", "venueId", "publishedAt");
CREATE INDEX "EventBeoReport_eventId_publishedAt_idx" ON "EventBeoReport"("eventId", "publishedAt");

-- AddForeignKey
ALTER TABLE "EventBeoReport" ADD CONSTRAINT "EventBeoReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventBeoReport" ADD CONSTRAINT "EventBeoReport_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventBeoReport" ADD CONSTRAINT "EventBeoReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (RLS)
ALTER TABLE "EventBeoReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventBeoReport" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    EXECUTE 'CREATE POLICY event_beo_report_scope ON "EventBeoReport" FOR ALL TO stadium_api USING (app_private.scope_matches("organizationId", "venueId", NULL)) WITH CHECK (app_private.scope_matches("organizationId", "venueId", NULL))';
  END IF;
END
$$;

-- A published report is an immutable record of what was handed to hosts and
-- department heads. Republishing writes the next version instead of editing one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stadium_api') THEN
    EXECUTE 'REVOKE UPDATE ON "EventBeoReport" FROM stadium_api';
  END IF;
END
$$;
