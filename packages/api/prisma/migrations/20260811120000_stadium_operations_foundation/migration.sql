-- Stadium operations foundation.
-- This migration is intentionally additive so a clean Supabase project can be
-- built from the full Prisma history without coupling the app to restaurant
-- terminology, while existing deployments retain backwards-compatible data.

CREATE TYPE "StadiumEventType" AS ENUM ('game', 'concert', 'tournament', 'festival', 'community', 'corporate', 'other');
CREATE TYPE "StadiumEventStatus" AS ENUM ('draft', 'planning', 'ready', 'live', 'completed', 'cancelled');
CREATE TYPE "FnbOperationType" AS ENUM ('concession_stand', 'grab_and_go', 'portable_cart', 'kiosk', 'food_vendor', 'commissary', 'production_kitchen', 'premium_suite', 'premium_club', 'loge_hospitality', 'in_seat_service', 'catering', 'banquet', 'bar', 'beer_cart', 'beverage', 'mobile_pickup', 'retail_fnb', 'partner_pop_up', 'back_of_house', 'other');
CREATE TYPE "FnbUnitStatus" AS ENUM ('open', 'restricted', 'closed', 'incident');
CREATE TYPE "EventFnbReadinessStatus" AS ENUM ('not_started', 'in_progress', 'ready', 'blocked');
CREATE TYPE "FnbPartnerType" AS ENUM ('local_concept', 'restaurant_concept', 'pop_up', 'licensed_brand', 'food_vendor', 'beverage_vendor', 'distributor', 'other');
CREATE TYPE "FnbPartnerStatus" AS ENUM ('onboarding', 'approved', 'active', 'paused', 'noncompliant', 'terminated');

ALTER TABLE "Venue"
  ADD COLUMN "stadiumCapacity" INTEGER,
  ADD COLUMN "homeTeam" TEXT;

ALTER TABLE "VenueEvent"
  ADD COLUMN "eventCode" TEXT,
  ADD COLUMN "eventType" "StadiumEventType" NOT NULL DEFAULT 'other',
  ADD COLUMN "status" "StadiumEventStatus" NOT NULL DEFAULT 'planning',
  ADD COLUMN "gatesOpenAt" TIMESTAMP(3),
  ADD COLUMN "ticketsScanned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "opponentOrHeadliner" TEXT;

CREATE TABLE "FnbOperationUnit" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "FnbOperationType" NOT NULL,
  "capacity" INTEGER,
  "level" TEXT,
  "status" "FnbUnitStatus" NOT NULL DEFAULT 'open',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FnbOperationUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventFnbReadiness" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "status" "EventFnbReadinessStatus" NOT NULL DEFAULT 'not_started',
  "notes" TEXT,
  "checkedBy" TEXT,
  "checkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventFnbReadiness_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FnbPartner" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "FnbPartnerType" NOT NULL,
  "status" "FnbPartnerStatus" NOT NULL DEFAULT 'onboarding',
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "revenueShareBps" INTEGER,
  "complianceExpiresAt" TIMESTAMP(3),
  "brandStandardsNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FnbPartner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueEvent_venueId_eventCode_key" ON "VenueEvent"("venueId", "eventCode");
CREATE INDEX "VenueEvent_venueId_status_startsAt_idx" ON "VenueEvent"("venueId", "status", "startsAt");
CREATE UNIQUE INDEX "FnbOperationUnit_venueId_code_key" ON "FnbOperationUnit"("venueId", "code");
CREATE INDEX "FnbOperationUnit_venueId_type_idx" ON "FnbOperationUnit"("venueId", "type");
CREATE INDEX "FnbOperationUnit_venueId_status_idx" ON "FnbOperationUnit"("venueId", "status");
CREATE UNIQUE INDEX "EventFnbReadiness_eventId_zoneId_key" ON "EventFnbReadiness"("eventId", "zoneId");
CREATE INDEX "EventFnbReadiness_venueId_eventId_status_idx" ON "EventFnbReadiness"("venueId", "eventId", "status");
CREATE INDEX "EventFnbReadiness_zoneId_status_idx" ON "EventFnbReadiness"("zoneId", "status");
CREATE UNIQUE INDEX "FnbPartner_venueId_name_key" ON "FnbPartner"("venueId", "name");
CREATE INDEX "FnbPartner_venueId_type_idx" ON "FnbPartner"("venueId", "type");
CREATE INDEX "FnbPartner_venueId_status_idx" ON "FnbPartner"("venueId", "status");
CREATE INDEX "FnbPartner_venueId_complianceExpiresAt_idx" ON "FnbPartner"("venueId", "complianceExpiresAt");

ALTER TABLE "FnbOperationUnit"
  ADD CONSTRAINT "FnbOperationUnit_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventFnbReadiness"
  ADD CONSTRAINT "EventFnbReadiness_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventFnbReadiness_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "VenueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventFnbReadiness_zoneId_fkey"
  FOREIGN KEY ("zoneId") REFERENCES "FnbOperationUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FnbPartner"
  ADD CONSTRAINT "FnbPartner_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These tables are server-mediated through NestJS and are not Supabase Data
-- API surfaces. RLS is defense in depth; the API roles receive no grants.
ALTER TABLE "FnbOperationUnit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventFnbReadiness" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FnbPartner" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "FnbOperationUnit" FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON TABLE "EventFnbReadiness" FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON TABLE "FnbPartner" FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
