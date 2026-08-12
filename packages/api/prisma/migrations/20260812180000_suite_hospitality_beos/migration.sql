-- VIP Suite Catering & BEO Execution Module Migration

CREATE TYPE "SuiteBeoStatus" AS ENUM ('draft', 'confirmed_beo', 'prep_initiated', 'en_route', 'delivered', 'closed_invoiced');
CREATE TYPE "ReplenishmentPriority" AS ENUM ('normal', 'high', 'urgent');
CREATE TYPE "ReplenishmentStatus" AS ENUM ('pending', 'acknowledged', 'fulfilled', 'cancelled');

CREATE TABLE "SuiteBeoOrder" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "subVenueId" TEXT NOT NULL,
  "eventId" TEXT,
  "beoNumber" TEXT NOT NULL,
  "hostName" TEXT NOT NULL,
  "hostPhone" TEXT,
  "hostEmail" TEXT,
  "guestCount" INTEGER,
  "deliveryWindowStart" TIMESTAMP(3) NOT NULL,
  "deliveryWindowEnd" TIMESTAMP(3) NOT NULL,
  "specialInstructions" TEXT,
  "cateringLineItems" JSONB NOT NULL,
  "parReplenishmentTriggers" JSONB,
  "status" "SuiteBeoStatus" NOT NULL DEFAULT 'draft',
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "deliveredAt" TIMESTAMP(3),
  "deliveredBy" TEXT,
  "deliverySignatureUrl" TEXT,
  "deliveryPhotoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuiteBeoOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuiteBeoStatusLog" (
  "id" TEXT NOT NULL,
  "beoOrderId" TEXT NOT NULL,
  "fromStatus" "SuiteBeoStatus",
  "toStatus" "SuiteBeoStatus" NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "notes" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuiteBeoStatusLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuiteBeoReplenishmentRequest" (
  "id" TEXT NOT NULL,
  "beoOrderId" TEXT NOT NULL,
  "subVenueId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "itemSummary" TEXT NOT NULL,
  "priority" "ReplenishmentPriority" NOT NULL DEFAULT 'normal',
  "status" "ReplenishmentStatus" NOT NULL DEFAULT 'pending',
  "requestedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilledAt" TIMESTAMP(3),
  CONSTRAINT "SuiteBeoReplenishmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseWebhookLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "targetSystem" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "responseCode" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnterpriseWebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SuiteBeoOrder_beoNumber_key" ON "SuiteBeoOrder"("beoNumber");
CREATE INDEX "SuiteBeoOrder_organizationId_facilityId_zoneId_status_idx" ON "SuiteBeoOrder"("organizationId", "facilityId", "zoneId", "status");
CREATE INDEX "SuiteBeoOrder_subVenueId_deliveryWindowStart_idx" ON "SuiteBeoOrder"("subVenueId", "deliveryWindowStart");
CREATE INDEX "SuiteBeoOrder_eventId_status_idx" ON "SuiteBeoOrder"("eventId", "status");
CREATE INDEX "SuiteBeoOrder_deliveryWindowStart_deliveryWindowEnd_idx" ON "SuiteBeoOrder"("deliveryWindowStart", "deliveryWindowEnd");
CREATE INDEX "SuiteBeoStatusLog_beoOrderId_timestamp_idx" ON "SuiteBeoStatusLog"("beoOrderId", "timestamp");
CREATE INDEX "SuiteBeoReplenishmentRequest_beoOrderId_createdAt_idx" ON "SuiteBeoReplenishmentRequest"("beoOrderId", "createdAt");
CREATE INDEX "SuiteBeoReplenishmentRequest_zoneId_status_priority_idx" ON "SuiteBeoReplenishmentRequest"("zoneId", "status", "priority");
CREATE INDEX "EnterpriseWebhookLog_organizationId_eventType_createdAt_idx" ON "EnterpriseWebhookLog"("organizationId", "eventType", "createdAt");

ALTER TABLE "SuiteBeoOrder" ADD CONSTRAINT "SuiteBeoOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SuiteBeoOrder" ADD CONSTRAINT "SuiteBeoOrder_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuiteBeoOrder" ADD CONSTRAINT "SuiteBeoOrder_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SuiteBeoOrder" ADD CONSTRAINT "SuiteBeoOrder_organizationId_facilityId_zoneId_subVenueId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId", "subVenueId") REFERENCES "SubVenue"("organizationId", "facilityId", "zoneId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SuiteBeoStatusLog" ADD CONSTRAINT "SuiteBeoStatusLog_beoOrderId_fkey" FOREIGN KEY ("beoOrderId") REFERENCES "SuiteBeoOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuiteBeoReplenishmentRequest" ADD CONSTRAINT "SuiteBeoReplenishmentRequest_beoOrderId_fkey" FOREIGN KEY ("beoOrderId") REFERENCES "SuiteBeoOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security Policies
ALTER TABLE "SuiteBeoOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SuiteBeoOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY suite_beo_order_read_scope ON "SuiteBeoOrder" FOR SELECT TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY suite_beo_order_write_scope ON "SuiteBeoOrder" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
