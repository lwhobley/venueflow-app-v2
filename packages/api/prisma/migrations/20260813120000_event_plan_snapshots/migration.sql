CREATE TABLE "EventPlanSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "generatedBy" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attendance" INTEGER,
  "estimatedSalesCents" INTEGER,
  "plan" JSONB NOT NULL,
  "dataGaps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "EventPlanSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventPlanSnapshot_eventId_key" ON "EventPlanSnapshot"("eventId");
CREATE INDEX "EventPlanSnapshot_organizationId_venueId_generatedAt_idx" ON "EventPlanSnapshot"("organizationId", "venueId", "generatedAt");
ALTER TABLE "EventPlanSnapshot" ADD CONSTRAINT "EventPlanSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventPlanSnapshot" ADD CONSTRAINT "EventPlanSnapshot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPlanSnapshot" ADD CONSTRAINT "EventPlanSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPlanSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventPlanSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY event_plan_snapshot_scope ON "EventPlanSnapshot" FOR ALL TO stadium_api
  USING (app_private.scope_matches("organizationId", "venueId", NULL))
  WITH CHECK (app_private.scope_matches("organizationId", "venueId", NULL));
